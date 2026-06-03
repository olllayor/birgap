import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { UnreadService } from '../unread/unread.service';
import { AckMessageDto } from './dto/ack-message.dto';
import { DeleteMessageDto, DeleteMessageScope } from './dto/delete-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkAllReadDto } from './dto/mark-all-read.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MediaService } from './media.service';
import { canonicalDirectPair } from './thread.util';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly unreadService: UnreadService,
    private readonly config: ConfigService,
    private readonly push: PushService,
    private readonly mediaService: MediaService,
  ) {}

  async send(senderUserId: string, dto: SendMessageDto) {
    const existing = await this.prisma.message.findUnique({
      where: {
        senderDeviceId_idempotencyKey: {
          senderDeviceId: dto.senderDeviceId,
          idempotencyKey: dto.idempotencyKey,
        },
      },
      include: { envelopes: true, media: { orderBy: { createdAt: 'asc' } } },
    });

    if (existing) {
      return this.serializeMessage(existing);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const allDevices = await tx.device.findMany({
          where: {
            active: true,
            OR: [
              { id: dto.senderDeviceId },
              { userId: dto.recipientUserId },
              { userId: senderUserId, id: { not: dto.senderDeviceId } },
            ],
          },
          select: { id: true, userId: true },
        });

        const senderDevice = allDevices.find((d) => d.id === dto.senderDeviceId);
        if (!senderDevice || senderDevice.userId !== senderUserId) {
          throw new ForbiddenException('Sender device is not active for this user');
        }
        if (senderUserId === dto.recipientUserId) {
          throw new BadRequestException('Recipient must be another user');
        }

        const recipientDevices = allDevices.filter((d) => d.userId === dto.recipientUserId);
        if (recipientDevices.length === 0) {
          throw new NotFoundException('Recipient has no active devices');
        }

        const senderSyncDeviceIds = new Set(
          allDevices.filter((d) => d.userId === senderUserId && d.id !== dto.senderDeviceId).map((d) => d.id),
        );
        const recipientDeviceIds = new Set(recipientDevices.map((device) => device.id));
        const allowedDeviceIds = new Set([...recipientDeviceIds, ...senderSyncDeviceIds]);
        const envelopeDeviceIds = new Set(dto.envelopes.map((envelope) => envelope.recipientDeviceId));

        for (const deviceId of recipientDeviceIds) {
          if (!envelopeDeviceIds.has(deviceId)) {
            throw new BadRequestException('Missing envelope for active recipient device');
          }
        }

        for (const envelope of dto.envelopes) {
          if (!allowedDeviceIds.has(envelope.recipientDeviceId)) {
            throw new BadRequestException('Envelope recipient device is not part of this direct message');
          }
        }

        const [userAId, userBId] = canonicalDirectPair(senderUserId, dto.recipientUserId);
        const thread = await tx.directThread.upsert({
          where: { userAId_userBId: { userAId, userBId } },
          update: {},
          create: { userAId, userBId },
        });
        const sequencedThread = await tx.directThread.update({
          where: { id: thread.id },
          data: { latestSequence: { increment: 1 } },
        });

        let replyToMessageId: string | null = null;
        if (dto.replyToMessageId) {
          const replyTarget = await tx.message.findUnique({
            where: { id: dto.replyToMessageId },
            select: { id: true, threadId: true, replyToMessageId: true },
          });
          if (!replyTarget) {
            throw new NotFoundException('Reply target message not found');
          }
          if (replyTarget.threadId !== thread.id) {
            throw new BadRequestException('Reply target is not in the same thread');
          }
          if (replyTarget.replyToMessageId) {
            throw new BadRequestException('Cannot reply to a message that is itself a reply');
          }
          replyToMessageId = replyTarget.id;
        }

        if (dto.mediaIds?.length) {
          await this.mediaService.assertAttachmentsOwned(senderUserId, dto.mediaIds, tx);
        }

        const message = await tx.message.create({
          data: {
            threadId: thread.id,
            senderUserId,
            senderDeviceId: dto.senderDeviceId,
            idempotencyKey: dto.idempotencyKey,
            threadSequence: sequencedThread.latestSequence,
            replyToMessageId,
            envelopes: {
              create: dto.envelopes.map((envelope) => {
                const isRecipientDevice = recipientDeviceIds.has(envelope.recipientDeviceId);
                return {
                  recipientUserId: isRecipientDevice ? dto.recipientUserId : senderUserId,
                  recipientDeviceId: envelope.recipientDeviceId,
                  ciphertext: envelope.ciphertext as Prisma.InputJsonValue,
                };
              }),
            },
          },
          include: { envelopes: true, media: { orderBy: { createdAt: 'asc' } } },
        });

        if (dto.mediaIds?.length) {
          await tx.messageMedia.updateMany({
            where: { id: { in: dto.mediaIds }, userId: senderUserId, messageId: null },
            data: { messageId: message.id },
          });
        }

        return message;
      });

      this.events.emit('message.created', this.serializeMessage(created));

      if (created.threadId) {
        this.unreadService
          .enqueueRecalc({
            userId: dto.recipientUserId,
            threadId: created.threadId,
            threadType: 'direct',
            reason: 'new_message',
          })
          .catch((error) => {
            this.events.emit('error', {
              message: 'Failed to enqueue unread recalc',
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      return this.serializeMessage(created);
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const duplicate = await this.prisma.message.findUnique({
          where: {
            senderDeviceId_idempotencyKey: {
              senderDeviceId: dto.senderDeviceId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          include: { envelopes: true, media: { orderBy: { createdAt: 'asc' } } },
        });
        if (duplicate) {
          return this.serializeMessage(duplicate);
        }
      }
      throw error;
    }
  }

  async getPending(userId: string, deviceId: string, after?: string, limit = 50) {
    await this.assertActiveDevice(userId, deviceId);

    const envelopes = await this.prisma.messageEnvelope.findMany({
      where: {
        recipientDeviceId: deviceId,
        status: { in: ['PENDING', 'DELIVERED'] },
        ...(after && { envelopeSequence: { gt: BigInt(after) } }),
      },
      orderBy: { envelopeSequence: 'asc' },
      take: limit,
      include: {
        message: {
          select: {
            id: true,
            threadId: true,
            groupId: true,
            senderUserId: true,
            senderDeviceId: true,
            threadSequence: true,
            replyToMessageId: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      deviceId,
      envelopes,
      hasMore: envelopes.length === limit,
    };
  }

  async ack(userId: string, messageId: string, dto: AckMessageDto) {
    await this.assertActiveDevice(userId, dto.deviceId);

    const envelope = await this.prisma.messageEnvelope.findUnique({
      where: { messageId_recipientDeviceId: { messageId, recipientDeviceId: dto.deviceId } },
    });
    if (!envelope || envelope.recipientUserId !== userId) {
      throw new NotFoundException('Message envelope not found for device');
    }

    const now = new Date();

    if (dto.status === 'READ') {
      await this.prisma.messageEnvelope.updateMany({
        where: {
          messageId,
          recipientUserId: userId,
          status: { not: 'READ' },
        },
        data: { status: 'READ', readAt: now, deliveredAt: envelope.deliveredAt ?? now },
      });
    }

    const updated = await this.prisma.messageEnvelope.update({
      where: { messageId_recipientDeviceId: { messageId, recipientDeviceId: dto.deviceId } },
      data:
        dto.status === 'READ'
          ? { status: 'READ' as const, deliveredAt: envelope.deliveredAt ?? now, readAt: now }
          : { status: 'DELIVERED' as const, deliveredAt: envelope.deliveredAt ?? now },
      include: {
        message: {
          select: {
            senderUserId: true,
            senderDeviceId: true,
            threadId: true,
            groupId: true,
            threadSequence: true,
          },
        },
      },
    });

    this.events.emit('message.ack', {
      messageId,
      deviceId: dto.deviceId,
      userId,
      status: updated.status,
      threadId: updated.message.threadId,
      groupId: updated.message.groupId,
      threadSequence: updated.message.threadSequence,
      senderUserId: updated.message.senderUserId,
      senderDeviceId: updated.message.senderDeviceId,
    });

    if (dto.status === 'READ') {
      const threadId = updated.message.threadId ?? updated.message.groupId;
      const threadType = updated.message.threadId ? 'direct' : 'group';

      if (threadId) {
        this.unreadService
          .enqueueRecalc({
            userId,
            threadId,
            threadType,
            reason: 'ack_read',
          })
          .catch((error) => {
            this.events.emit('error', {
              message: 'Failed to enqueue unread recalc',
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }
    }

    return updated;
  }

  async markAllRead(userId: string, dto: MarkAllReadDto) {
    await this.assertActiveDevice(userId, dto.deviceId);

    await this.unreadService.markAllRead(userId, dto.threadId, dto.threadType);

    this.events.emit('messages.marked_all_read', {
      userId,
      threadId: dto.threadId,
      threadType: dto.threadType,
    });

    return { success: true };
  }

  async getUnreadCounts(userId: string) {
    return this.unreadService.getCounts(userId);
  }

  async sync(userId: string, deviceId: string, since: string, limit = 200) {
    await this.assertActiveDevice(userId, deviceId);

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      throw new BadRequestException('Invalid since timestamp');
    }

    const maxSyncWindowDays = 14;
    const windowStart = new Date(Date.now() - maxSyncWindowDays * 24 * 60 * 60 * 1000);
    if (sinceDate < windowStart) {
      return { requiresFullReload: true as const, envelopes: [], deletedMessages: [], hasMore: false };
    }

    const take = Math.min(limit, 500);

    const envelopes = await this.prisma.messageEnvelope.findMany({
      where: {
        recipientDeviceId: deviceId,
        updatedAt: { gt: sinceDate },
      },
      orderBy: { updatedAt: 'asc' },
      take: take + 1,
      include: {
        message: {
          select: {
            id: true,
            threadId: true,
            groupId: true,
            senderUserId: true,
            senderDeviceId: true,
            threadSequence: true,
            replyToMessageId: true,
            createdAt: true,
            deletedAt: true,
            editedAt: true,
          },
        },
      },
    });

    const hasMore = envelopes.length > take;
    const slicedEnvelopes = hasMore ? envelopes.slice(0, take) : envelopes;

    const deletedMessages = await this.prisma.message.findMany({
      where: {
        deletedAt: { gt: sinceDate },
        OR: [
          { thread: { OR: [{ userAId: userId }, { userBId: userId }] } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: {
        id: true,
        threadId: true,
        groupId: true,
        deletedAt: true,
      },
      orderBy: { deletedAt: 'asc' },
      take: 200,
    });

    return {
      requiresFullReload: false as const,
      envelopes: slicedEnvelopes.map((e) => ({
        id: e.id,
        messageId: e.messageId,
        recipientUserId: e.recipientUserId,
        recipientDeviceId: e.recipientDeviceId,
        ciphertext: e.ciphertext,
        status: e.status,
        envelopeVersion: e.envelopeVersion,
        updatedAt: e.updatedAt.toISOString(),
        isEdit: e.envelopeVersion > 1 || (e.message?.editedAt && e.updatedAt >= e.message.editedAt),
        message: e.message,
      })),
      deletedMessages: deletedMessages.map((m) => ({
        messageId: m.id,
        threadId: m.threadId,
        groupId: m.groupId,
        deletedAt: m.deletedAt!.toISOString(),
      })),
      hasMore,
    };
  }

  async edit(userId: string, messageId: string, dto: EditMessageDto) {
    await this.assertActiveDevice(userId, dto.senderDeviceId);

    const message = await this.assertMessageAccess(userId, messageId);

    if (message.senderUserId !== userId) {
      throw new ForbiddenException('Only the sender can edit a message');
    }

    if (message.deletedAt) {
      throw new ForbiddenException('Cannot edit a deleted message');
    }

    const limitEnabled = this.config.get<boolean>('ENABLE_MESSAGE_EDIT_DELETE_LIMIT', true);
    const limitHours = this.config.get<number>('MESSAGE_EDIT_DELETE_LIMIT_HOURS', 48);
    if (limitEnabled) {
      const ageMs = Date.now() - message.createdAt.getTime();
      const limitMs = limitHours * 60 * 60 * 1000;
      if (ageMs > limitMs) {
        throw new ForbiddenException(`Edit is only allowed within ${limitHours} hours`);
      }
    }

    // Atomic idempotency: only update if the key is different or null
    const updateResult = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        lastEditIdempotencyKey: { not: dto.idempotencyKey },
      },
      data: {
        editedAt: new Date(),
        lastEditIdempotencyKey: dto.idempotencyKey,
      },
    });

    if (updateResult.count === 0) {
      // Already processed with this exact key, or message doesn't exist
      const existing = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { envelopes: true },
      });
      if (!existing) {
        throw new NotFoundException('Message not found');
      }
      return this.serializeMessage(existing);
    }

    // Refresh envelope ciphertexts for the provided device set
    const targetDeviceIds = new Set(dto.envelopes.map((e) => e.recipientDeviceId));

    for (const envelope of dto.envelopes) {
      await this.prisma.messageEnvelope.updateMany({
        where: {
          messageId,
          recipientDeviceId: envelope.recipientDeviceId,
        },
        data: {
          ciphertext: envelope.ciphertext as Prisma.InputJsonValue,
          envelopeVersion: { increment: 1 },
        },
      });
    }

    const updated = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        envelopes: { where: { recipientDeviceId: { in: Array.from(targetDeviceIds) } } },
        thread: { select: { userAId: true, userBId: true } },
      },
    });

    if (!updated) {
      throw new NotFoundException('Message not found after edit');
    }

    const eventPayload = {
      messageId: updated.id,
      threadId: updated.threadId,
      groupId: updated.groupId,
      senderUserId: updated.senderUserId,
      senderDeviceId: updated.senderDeviceId,
      editedAt: updated.editedAt!.toISOString(),
      envelopes: updated.envelopes,
    };

    if (updated.groupId) {
      this.events.emit('message.edited.group', eventPayload);
    } else if (updated.threadId && updated.thread) {
      const targetUserIds = [updated.thread.userAId, updated.thread.userBId].filter((id) => id !== userId);
      this.events.emit('message.edited', {
        ...eventPayload,
        targetUserIds,
      });
    }

    // Silent push wakeup for offline clients
    this.push
      .sendEditWakeup(
        updated.envelopes.map((e) => ({
          recipientDeviceId: e.recipientDeviceId,
          recipientUserId: e.recipientUserId,
        })),
      )
      .catch((error) => {
        this.events.emit('error', {
          message: 'Failed to enqueue edit push wakeup',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return this.serializeMessage(updated);
  }

  async delete(userId: string, messageId: string, dto: DeleteMessageDto) {
    await this.assertActiveDevice(userId, dto.deviceId);

    const message = await this.assertMessageAccess(userId, messageId);

    if (dto.scope === DeleteMessageScope.FOR_ME) {
      await this.prisma.hiddenMessage.upsert({
        where: { userId_messageId: { userId, messageId } },
        update: {},
        create: { userId, messageId },
      });
      return { success: true, scope: DeleteMessageScope.FOR_ME };
    }

    // FOR_EVERYONE scope
    let deletedBy: 'SENDER' | 'ADMIN' = 'SENDER';

    if (message.senderUserId !== userId) {
      // Only group admins can delete another user's message
      if (!message.groupId) {
        throw new ForbiddenException('Only the sender can delete a direct message for everyone');
      }
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: message.groupId, userId } },
      });
      if (!member || member.role !== 'ADMIN') {
        throw new ForbiddenException('Only the sender or a group admin can delete this message');
      }
      deletedBy = 'ADMIN';
    }

    const limitEnabled = this.config.get<boolean>('ENABLE_MESSAGE_EDIT_DELETE_LIMIT', true);
    const limitHours = this.config.get<number>('MESSAGE_EDIT_DELETE_LIMIT_HOURS', 48);
    if (limitEnabled) {
      const ageMs = Date.now() - message.createdAt.getTime();
      const limitMs = limitHours * 60 * 60 * 1000;
      if (ageMs > limitMs) {
        throw new ForbiddenException(`Delete for everyone is only allowed within ${limitHours} hours`);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const tombstoned = await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date() },
        include: {
          thread: { select: { userAId: true, userBId: true } },
          envelopes: true,
        },
      });

      if (deletedBy === 'ADMIN') {
        await tx.messageAdminDeleteLog.create({
          data: {
            messageId,
            adminUserId: userId,
          },
        });
      }

      return tombstoned;
    });

    const eventPayload = {
      messageId: updated.id,
      threadId: updated.threadId,
      groupId: updated.groupId,
      senderUserId: updated.senderUserId,
      deletedAt: updated.deletedAt!.toISOString(),
      deletedBy,
    };

    if (updated.groupId) {
      this.events.emit('message.deleted.group', eventPayload);
    } else if (updated.threadId && updated.thread) {
      const targetUserIds = [updated.thread.userAId, updated.thread.userBId].filter((id) => id !== userId);
      this.events.emit('message.deleted', {
        ...eventPayload,
        targetUserIds,
      });
    }

    // Silent push wakeup for offline clients
    const deleteEnvelopes = updated.envelopes.map((e) => ({
      recipientDeviceId: e.recipientDeviceId,
      recipientUserId: e.recipientUserId,
    }));
    this.push
      .sendDeleteWakeup(deleteEnvelopes)
      .catch((error) => {
        this.events.emit('error', {
          message: 'Failed to enqueue delete push wakeup',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    // Enqueue R2 cleanup for any media attached to this message
    this.mediaService.cleanupMessageMedia(messageId).catch((error) => {
      this.events.emit('error', {
        message: 'Failed to enqueue media cleanup',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { success: true, scope: DeleteMessageScope.FOR_EVERYONE, deletedBy };
  }

  private async assertActiveDevice(userId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId, active: true },
    });
    if (!device) {
      throw new ForbiddenException('Device is not active for this user');
    }
  }

  private async assertMessageAccess(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        threadId: true,
        groupId: true,
        senderUserId: true,
        createdAt: true,
        deletedAt: true,
        thread: { select: { userAId: true, userBId: true } },
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.threadId) {
      const isParticipant =
        message.thread?.userAId === userId || message.thread?.userBId === userId;
      if (!isParticipant) {
        throw new ForbiddenException('Not a participant in this thread');
      }
    } else if (message.groupId) {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: message.groupId, userId } },
      });
      if (!member) {
        throw new ForbiddenException('Not a member of this group');
      }
    }

    return message;
  }

  private serializeMessage(message: {
    id: string;
    threadId: string | null;
    groupId?: string | null;
    senderUserId: string;
    senderDeviceId: string;
    threadSequence: number;
    replyToMessageId?: string | null;
    createdAt: Date;
    envelopes: unknown[];
    media?: unknown[];
  }) {
    return {
      id: message.id,
      threadId: message.threadId,
      groupId: message.groupId ?? null,
      senderUserId: message.senderUserId,
      senderDeviceId: message.senderDeviceId,
      threadSequence: message.threadSequence,
      replyToMessageId: message.replyToMessageId ?? null,
      createdAt: message.createdAt,
      envelopes: message.envelopes,
      media: message.media ?? [],
    };
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
