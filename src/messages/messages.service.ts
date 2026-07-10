import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { UnreadService } from '../unread/unread.service';
import { AuditLogService } from '../moderation/services/audit-log.service';
import { AckMessageDto } from './dto/ack-message.dto';
import { DeleteMessageDto, DeleteMessageScope } from './dto/delete-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { ForwardMessageDto, ForwardTargetDto } from './dto/forward-message.dto';
import { MarkAllReadDto } from './dto/mark-all-read.dto';
import { PinMessageDto } from './dto/pin-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MediaService } from './media.service';
import { canonicalDirectPair } from './thread.util';
import { retryOnUniqueViolation } from '../common/utils/prisma-retry.util';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly unreadService: UnreadService,
    private readonly config: ConfigService,
    private readonly push: PushService,
    private readonly mediaService: MediaService,
    private readonly auditLog: AuditLogService,
    @InjectQueue('group-fanout') private readonly fanoutQueue: Queue,
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

    // Saved Messages: recipient === sender creates/uses the self-thread
    // (userAId === userBId). No block check, no unread counting; envelopes
    // fan out to the sender's other devices only.
    const isSelfThread = senderUserId === dto.recipientUserId;

    // Blocking (either direction) forbids direct sends. One indexed query,
    // checked before opening the transaction.
    if (!isSelfThread) {
      const block = await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: senderUserId, blockedId: dto.recipientUserId },
            { blockerId: dto.recipientUserId, blockedId: senderUserId },
          ],
        },
        select: { id: true },
      });
      if (block) {
        throw new ForbiddenException('Cannot send message: this user is blocked');
      }
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
          throw new ForbiddenException(
            `Sender device ${dto.senderDeviceId} is not active for this user`,
          );
        }

        // Self-thread: "recipients" are the sender's other devices. A
        // single-device user has none to require, but the DTO demands at least
        // one envelope — the sender's own device is allowed for that case.
        const recipientDevices = isSelfThread
          ? allDevices.filter((d) => d.userId === senderUserId && d.id !== dto.senderDeviceId)
          : allDevices.filter((d) => d.userId === dto.recipientUserId);
        if (!isSelfThread && recipientDevices.length === 0) {
          throw new NotFoundException('Recipient has no active devices');
        }

        const senderSyncDeviceIds = new Set(
          allDevices.filter((d) => d.userId === senderUserId && d.id !== dto.senderDeviceId).map((d) => d.id),
        );
        const recipientDeviceIds = new Set(recipientDevices.map((device) => device.id));
        const allowedDeviceIds = new Set([
          ...recipientDeviceIds,
          ...senderSyncDeviceIds,
          ...(isSelfThread ? [dto.senderDeviceId] : []),
        ]);
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
            contentType: dto.contentType ?? 'TEXT',
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

      // Saved Messages never count as unread — it's the user's own notepad.
      if (created.threadId && !isSelfThread) {
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

  async forward(userId: string, dto: ForwardMessageDto) {
    await this.assertActiveDevice(userId, dto.senderDeviceId);

    const sourceMessage = await this.assertMessageAccess(userId, dto.sourceMessageId);
    const sourceContentType = sourceMessage.contentType;

    if (sourceMessage.deletedAt) {
      throw new ForbiddenException('Cannot forward a deleted message');
    }

    const sourceMedia = await this.prisma.messageMedia.findMany({
      where: { messageId: dto.sourceMessageId },
      orderBy: { createdAt: 'asc' },
    });

    const results: Array<{
      targetType: 'direct' | 'group';
      targetId: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }> = [];

    for (let i = 0; i < dto.targets.length; i++) {
      const target = dto.targets[i];
      const perTargetKey = `${dto.idempotencyKey}:${i}`;

      try {
        if (target.type === 'direct') {
          this.validateDirectTarget(target);
          const messageId = await this.forwardToDirect(
            userId,
            dto.senderDeviceId,
            perTargetKey,
            target,
            sourceMedia,
            sourceContentType,
          );
          results.push({ targetType: 'direct', targetId: target.recipientUserId!, success: true, messageId });
        } else {
          this.validateGroupTarget(target);
          const messageId = await this.forwardToGroup(
            userId,
            dto.senderDeviceId,
            perTargetKey,
            target,
            sourceMedia,
            sourceContentType,
          );
          results.push({ targetType: 'group', targetId: target.groupId!, success: true, messageId });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          targetType: target.type,
          targetId: target.type === 'direct' ? target.recipientUserId ?? '' : target.groupId ?? '',
          success: false,
          error: errorMsg,
        });
      }
    }

    return { results };
  }

  private validateDirectTarget(target: ForwardTargetDto) {
    if (!target.recipientUserId) {
      throw new BadRequestException('recipientUserId is required for direct targets');
    }
    if (!target.envelopes || target.envelopes.length === 0) {
      throw new BadRequestException('envelopes are required for direct targets');
    }
  }

  private validateGroupTarget(target: ForwardTargetDto) {
    if (!target.groupId) {
      throw new BadRequestException('groupId is required for group targets');
    }
    if (target.ciphertext === undefined || target.ciphertext === null) {
      throw new BadRequestException('ciphertext is required for group targets');
    }
  }

  private async forwardToDirect(
    senderUserId: string,
    senderDeviceId: string,
    idempotencyKey: string,
    target: ForwardTargetDto,
    sourceMedia: import('@prisma/client').MessageMedia[],
    contentType: import('@prisma/client').MessageContentType,
  ): Promise<string> {
    const existing = await this.prisma.message.findUnique({
      where: {
        senderDeviceId_idempotencyKey: {
          senderDeviceId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      return existing.id;
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const allDevices = await tx.device.findMany({
          where: {
            active: true,
            OR: [
              { id: senderDeviceId },
              { userId: target.recipientUserId },
              { userId: senderUserId, id: { not: senderDeviceId } },
            ],
          },
          select: { id: true, userId: true },
        });

        const senderDevice = allDevices.find((d) => d.id === senderDeviceId);
        if (!senderDevice || senderDevice.userId !== senderUserId) {
          throw new ForbiddenException('Sender device is not active for this user');
        }
        if (senderUserId === target.recipientUserId) {
          throw new BadRequestException('Recipient must be another user');
        }

        const recipientDevices = allDevices.filter((d) => d.userId === target.recipientUserId);
        if (recipientDevices.length === 0) {
          throw new NotFoundException('Recipient has no active devices');
        }

        const senderSyncDeviceIds = new Set(
          allDevices.filter((d) => d.userId === senderUserId && d.id !== senderDeviceId).map((d) => d.id),
        );
        const recipientDeviceIds = new Set(recipientDevices.map((device) => device.id));
        const allowedDeviceIds = new Set([...recipientDeviceIds, ...senderSyncDeviceIds]);
        const envelopeDeviceIds = new Set(target.envelopes!.map((e) => e.recipientDeviceId));

        for (const deviceId of recipientDeviceIds) {
          if (!envelopeDeviceIds.has(deviceId)) {
            throw new BadRequestException('Missing envelope for active recipient device');
          }
        }

        for (const envelope of target.envelopes!) {
          if (!allowedDeviceIds.has(envelope.recipientDeviceId)) {
            throw new BadRequestException('Envelope recipient device is not part of this direct message');
          }
        }

        const [userAId, userBId] = canonicalDirectPair(senderUserId, target.recipientUserId!);
        const thread = await tx.directThread.upsert({
          where: { userAId_userBId: { userAId, userBId } },
          update: {},
          create: { userAId, userBId },
        });
        const sequencedThread = await tx.directThread.update({
          where: { id: thread.id },
          data: { latestSequence: { increment: 1 } },
        });

        const message = await tx.message.create({
          data: {
            threadId: thread.id,
            senderUserId,
            senderDeviceId,
            idempotencyKey,
            threadSequence: sequencedThread.latestSequence,
            forwarded: true,
            contentType,
            envelopes: {
              create: target.envelopes!.map((envelope) => {
                const isRecipientDevice = recipientDeviceIds.has(envelope.recipientDeviceId);
                return {
                  recipientUserId: isRecipientDevice ? target.recipientUserId! : senderUserId,
                  recipientDeviceId: envelope.recipientDeviceId,
                  ciphertext: envelope.ciphertext as Prisma.InputJsonValue,
                };
              }),
            },
          },
          include: { envelopes: true, media: { orderBy: { createdAt: 'asc' } } },
        });

        if (sourceMedia.length > 0) {
          await this.mediaService.cloneMediaForForward(tx, senderUserId, message.id, sourceMedia);
        }

        return message;
      });

      this.events.emit('message.created', this.serializeMessage(created));

      if (created.threadId) {
        this.unreadService
          .enqueueRecalc({
            userId: target.recipientUserId!,
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

      return created.id;
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const duplicate = await this.prisma.message.findUnique({
          where: {
            senderDeviceId_idempotencyKey: {
              senderDeviceId,
              idempotencyKey,
            },
          },
        });
        if (duplicate) {
          return duplicate.id;
        }
      }
      throw error;
    }
  }

  private async forwardToGroup(
    senderUserId: string,
    senderDeviceId: string,
    idempotencyKey: string,
    target: ForwardTargetDto,
    sourceMedia: import('@prisma/client').MessageMedia[],
    contentType: import('@prisma/client').MessageContentType,
  ): Promise<string> {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: target.groupId!, userId: senderUserId } },
    });
    if (!member) {
      throw new ForbiddenException('You are not a member of this group');
    }

    const existing = await this.prisma.message.findUnique({
      where: {
        senderDeviceId_idempotencyKey: {
          senderDeviceId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      return existing.id;
    }

    // Retry on @@unique([groupId, threadSequence]) conflicts: concurrent group
    // writes can read the same max sequence and collide (there was no retry here,
    // so a forward simply 500'd and was lost).
    const message = await retryOnUniqueViolation(() => this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.message.findUnique({
        where: {
          senderDeviceId_idempotencyKey: {
            senderDeviceId,
            idempotencyKey,
          },
        },
      });
      if (existingTx) {
        return existingTx;
      }

      const lastMessage = await tx.message.findFirst({
        where: { groupId: target.groupId },
        orderBy: { threadSequence: 'desc' },
        select: { threadSequence: true },
      });
      const nextSequence = (lastMessage?.threadSequence ?? 0) + 1;

      const created = await tx.message.create({
        data: {
          groupId: target.groupId,
          senderUserId,
          senderDeviceId,
          idempotencyKey,
          threadSequence: nextSequence,
          forwarded: true,
          contentType,
        },
      });

      if (sourceMedia.length > 0) {
        await this.mediaService.cloneMediaForForward(tx, senderUserId, created.id, sourceMedia);
      }

      return created;
    }), 'threadSequence');

    await this.fanoutQueue.add('fanout', {
      messageId: message.id,
      groupId: target.groupId,
      senderUserId,
      senderDeviceId,
      ciphertext: target.ciphertext,
      threadSequence: message.threadSequence,
      replyToMessageId: null,
      contentType,
      createdAt: message.createdAt.toISOString(),
      mediaIds: sourceMedia.map((m) => m.id),
      forwarded: true,
    });

    return message.id;
  }

  async getPending(userId: string, deviceId: string, after?: string, limit = 50) {
    await this.assertActiveDevice(userId, deviceId);

    // envelopeSequence is a Postgres autoincrement: the value is assigned at
    // INSERT but only becomes visible at COMMIT. So a higher sequence can commit
    // before a lower one, and a client that advanced its `after` watermark past
    // the higher value would skip the lower one forever once it commits — a
    // permanently lost message under concurrent sends to the same device.
    //
    // Guard against that WITHOUT a schema change: an envelope that was skipped
    // this way is still PENDING (it can't have been delivered/acked, since the
    // client never saw it). So always re-include PENDING envelopes regardless of
    // the watermark; only DELIVERED envelopes are gated by `after` (the client
    // already has those). Once a re-surfaced envelope is acked it flips to
    // DELIVERED/READ and drops out.
    const envelopes = await this.prisma.messageEnvelope.findMany({
      where: {
        recipientDeviceId: deviceId,
        OR: [
          { status: 'PENDING' },
          {
            status: 'DELIVERED',
            ...(after && { envelopeSequence: { gt: BigInt(after) } }),
          },
        ],
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
            contentType: true,
            replyToMessageId: true,
            forwarded: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      deviceId,
      envelopes: envelopes.map((e) => ({
        ...e,
        envelopeSequence: e.envelopeSequence.toString(),
      })),
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
      // Reading on one device marks the message read across all of this user's
      // devices. Fill deliveredAt only where it is still null — the previous code
      // wrote this device's deliveredAt onto every sibling envelope, clobbering
      // their real per-device delivery timestamps.
      await this.prisma.messageEnvelope.updateMany({
        where: { messageId, recipientUserId: userId, deliveredAt: null },
        data: { deliveredAt: now },
      });
      await this.prisma.messageEnvelope.updateMany({
        where: {
          messageId,
          recipientUserId: userId,
          status: { not: 'READ' },
        },
        data: { status: 'READ', readAt: now },
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

    return {
      messageId: updated.messageId,
      recipientDeviceId: updated.recipientDeviceId,
      status: updated.status,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
      readAt: updated.readAt?.toISOString() ?? null,
      envelopeSequence: updated.envelopeSequence.toString(),
    };
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

    const messageInclude = {
      message: {
        select: {
          id: true,
          threadId: true,
          groupId: true,
          senderUserId: true,
          senderDeviceId: true,
          threadSequence: true,
          contentType: true,
          replyToMessageId: true,
          forwarded: true,
          createdAt: true,
          deletedAt: true,
          editedAt: true,
        },
      },
    } as const;

    // Bulk status writes (markAllRead, edit fan-out) stamp many envelopes with the
    // exact same updatedAt. Paging with a strict `updatedAt > since` cursor would
    // skip every same-timestamp row that fell past the page boundary. Order by
    // (updatedAt, id) for determinism, then never split a same-timestamp group
    // across a page: after slicing, pull the rest of the boundary timestamp's rows
    // so the client's next `since = boundaryTs` (strict gt) can't drop anything.
    const envelopes = await this.prisma.messageEnvelope.findMany({
      where: {
        recipientDeviceId: deviceId,
        updatedAt: { gt: sinceDate },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      include: messageInclude,
    });

    const hasMore = envelopes.length > take;
    const slicedEnvelopes = hasMore ? envelopes.slice(0, take) : envelopes;

    if (hasMore && slicedEnvelopes.length > 0) {
      const boundary = slicedEnvelopes[slicedEnvelopes.length - 1];
      const boundaryRemainder = await this.prisma.messageEnvelope.findMany({
        where: {
          recipientDeviceId: deviceId,
          updatedAt: boundary.updatedAt,
          id: { gt: boundary.id },
        },
        orderBy: { id: 'asc' },
        include: messageInclude,
      });
      slicedEnvelopes.push(...boundaryRemainder);
    }

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

    // Silent push wakeup for offline clients. threadId enables the per-user
    // thread mute filter in PushService (direct threads only; null for groups).
    this.push
      .sendEditWakeup(
        updated.envelopes.map((e) => ({
          recipientDeviceId: e.recipientDeviceId,
          recipientUserId: e.recipientUserId,
        })),
        updated.threadId,
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
        await this.auditLog.write(
          {
            actorUserId: userId,
            action: 'MESSAGE_TOMBSTONE',
            targetType: 'MESSAGE',
            targetId: messageId,
            reason: 'group_admin_delete',
            metadata: { scope: 'group' },
          },
          tx,
        );
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
      deletedByUserId: userId,
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

    // Silent push wakeup for offline clients. threadId enables the per-user
    // thread mute filter in PushService (direct threads only; null for groups).
    const deleteEnvelopes = updated.envelopes.map((e) => ({
      recipientDeviceId: e.recipientDeviceId,
      recipientUserId: e.recipientUserId,
    }));
    this.push
      .sendDeleteWakeup(deleteEnvelopes, updated.threadId)
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

  async pinMessage(userId: string, messageId: string, dto: PinMessageDto) {
    await this.assertActiveDevice(userId, dto.deviceId);
    const message = await this.assertMessageAccess(userId, messageId);
    if (message.deletedAt) {
      throw new BadRequestException('Cannot pin a deleted message');
    }

    const threadType = message.threadId ? 'direct' : 'group';
    const threadId = (message.threadId ?? message.groupId) as string;

    // Idempotent: pinning an already-pinned message is a no-op that returns the
    // existing pin rather than surfacing a unique-constraint error.
    const pin = await this.prisma.pinnedMessage.upsert({
      where: { threadType_threadId_messageId: { threadType, threadId, messageId } },
      update: {},
      create: { threadType, threadId, messageId, pinnedByUserId: userId },
    });

    this.emitPinChange('pinned', userId, message, threadType, threadId, pin.pinnedAt);
    return this.serializePin(pin);
  }

  async unpinMessage(userId: string, messageId: string, dto: PinMessageDto) {
    await this.assertActiveDevice(userId, dto.deviceId);
    const message = await this.assertMessageAccess(userId, messageId);

    const threadType = message.threadId ? 'direct' : 'group';
    const threadId = (message.threadId ?? message.groupId) as string;

    const deleted = await this.prisma.pinnedMessage.deleteMany({
      where: { threadType, threadId, messageId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Message is not pinned');
    }

    this.emitPinChange('unpinned', userId, message, threadType, threadId, new Date());
    return { success: true };
  }

  async listPinned(
    userId: string,
    threadType: 'direct' | 'group',
    threadId: string,
    deviceId: string,
  ) {
    await this.assertActiveDevice(userId, deviceId);
    await this.assertThreadAccess(userId, threadType, threadId);

    const pins = await this.prisma.pinnedMessage.findMany({
      where: { threadType, threadId },
      orderBy: { pinnedAt: 'desc' },
    });

    return { threadType, threadId, pins: pins.map((p) => this.serializePin(p)) };
  }

  private serializePin(pin: {
    id: string;
    threadType: string;
    threadId: string;
    messageId: string;
    pinnedByUserId: string;
    pinnedAt: Date;
  }) {
    return {
      id: pin.id,
      threadType: pin.threadType,
      threadId: pin.threadId,
      messageId: pin.messageId,
      pinnedByUserId: pin.pinnedByUserId,
      pinnedAt: pin.pinnedAt.toISOString(),
    };
  }

  // Relays a pin/unpin to the other participants, mirroring the message.deleted
  // convention: direct threads carry an explicit targetUserIds list (actor
  // excluded), groups fan out to members via the gateway.
  private emitPinChange(
    action: 'pinned' | 'unpinned',
    actorUserId: string,
    message: { id: string; threadId: string | null; groupId: string | null; thread?: { userAId: string; userBId: string } | null },
    threadType: 'direct' | 'group',
    threadId: string,
    at: Date,
  ) {
    const base = {
      action,
      messageId: message.id,
      threadType,
      threadId,
      groupId: message.groupId ?? null,
      pinnedByUserId: actorUserId,
      at: at.toISOString(),
    };

    if (threadType === 'direct') {
      const targetUserIds = [message.thread?.userAId, message.thread?.userBId].filter(
        (id): id is string => !!id && id !== actorUserId,
      );
      this.events.emit('message.pin', { ...base, targetUserIds });
    } else {
      this.events.emit('message.pin.group', base);
    }
  }

  private async assertThreadAccess(
    userId: string,
    threadType: 'direct' | 'group',
    threadId: string,
  ) {
    if (threadType === 'direct') {
      const thread = await this.prisma.directThread.findUnique({
        where: { id: threadId },
        select: { userAId: true, userBId: true },
      });
      if (!thread) {
        throw new NotFoundException('Thread not found');
      }
      if (thread.userAId !== userId && thread.userBId !== userId) {
        throw new ForbiddenException('Not a participant in this thread');
      }
    } else {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: threadId, userId } },
      });
      if (!member) {
        throw new ForbiddenException('Not a member of this group');
      }
    }
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
        contentType: true,
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
    contentType?: string;
    replyToMessageId?: string | null;
    forwarded?: boolean;
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
      contentType: message.contentType ?? 'TEXT',
      replyToMessageId: message.replyToMessageId ?? null,
      forwarded: message.forwarded ?? false,
      createdAt: message.createdAt,
      envelopes: message.envelopes.map((e: any) => ({
        ...e,
        envelopeSequence: e.envelopeSequence?.toString() ?? e.envelopeSequence,
      })),
      media: message.media ?? [],
    };
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
