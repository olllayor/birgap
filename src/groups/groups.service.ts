import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { CreateGroupDto } from './dto/create-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { EditGroupMessageDto } from './dto/edit-group-message.dto';
import { MediaService } from '../messages/media.service';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly mediaService: MediaService,
    @InjectQueue('group-fanout') private readonly fanoutQueue: Queue,
    @InjectQueue('group-edit-fanout') private readonly editFanoutQueue: Queue,
  ) {}

  async createGroup(creatorUserId: string, dto: CreateGroupDto) {
    const memberIds = Array.from(new Set([creatorUserId, ...dto.members]));

    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.group.create({
        data: {
          encryptedMetadata: dto.encryptedMetadata as Prisma.InputJsonValue,
          members: {
            create: memberIds.map((userId) => ({
              userId,
              role: userId === creatorUserId ? 'ADMIN' : 'MEMBER',
            })),
          },
        },
        include: {
          members: true,
        },
      });
      return created;
    });

    this.redis.setGroupMemberIds(group.id, memberIds).catch(() => {});
    return group;
  }

  async addMembers(userId: string, groupId: string, memberIds: string[]) {
    await this.assertGroupAdmin(userId, groupId);

    // Filter out users that are already members to avoid Prisma errors on unique key violations
    const existingMembers = await this.prisma.groupMember.findMany({
      where: {
        groupId,
        userId: { in: memberIds },
      },
      select: { userId: true },
    });
    const existingSet = new Set(existingMembers.map((m) => m.userId));
    const newMemberIds = memberIds.filter((id) => !existingSet.has(id));

    if (newMemberIds.length === 0) {
      return { count: 0 };
    }

    const result = await this.prisma.groupMember.createMany({
      data: newMemberIds.map((id) => ({
        groupId,
        userId: id,
        role: 'MEMBER',
      })),
    });

    this.redis.invalidateGroupMemberIds(groupId).catch(() => {});
    return result;
  }

  async removeMember(userId: string, groupId: string, targetUserId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('Not a member of this group');
    }

    if (userId !== targetUserId) {
      if (member.role !== 'ADMIN') {
        throw new ForbiddenException('Only group admins can remove other members');
      }
    }

    const targetMember = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });
    if (!targetMember) {
      throw new NotFoundException('Target user is not a member of this group');
    }

    const result = await this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    this.redis.invalidateGroupMemberIds(groupId).catch(() => {});
    return result;
  }

  async queueGroupMessage(senderUserId: string, groupId: string, dto: SendGroupMessageDto) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: senderUserId } },
    });
    if (!member) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // Idempotency check
    const existing = await this.prisma.message.findUnique({
      where: {
        senderDeviceId_idempotencyKey: {
          senderDeviceId: dto.senderDeviceId,
          idempotencyKey: dto.idempotencyKey,
        },
      },
    });
    if (existing) {
      return { success: true, messageId: existing.id, queued: false };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.message.findUnique({
        where: {
          senderDeviceId_idempotencyKey: {
            senderDeviceId: dto.senderDeviceId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });
      if (existingTx) {
        return existingTx;
      }

      const lastMessage = await tx.message.findFirst({
        where: { groupId },
        orderBy: { threadSequence: 'desc' },
        select: { threadSequence: true },
      });
      const nextSequence = (lastMessage?.threadSequence ?? 0) + 1;

      let replyToMessageId: string | null = null;
      if (dto.replyToMessageId) {
        const replyTarget = await tx.message.findUnique({
          where: { id: dto.replyToMessageId },
          select: { id: true, groupId: true, replyToMessageId: true },
        });
        if (!replyTarget) {
          throw new NotFoundException('Reply target message not found');
        }
        if (replyTarget.groupId !== groupId) {
          throw new BadRequestException('Reply target is not in the same group');
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
          groupId,
          senderUserId,
          senderDeviceId: dto.senderDeviceId,
          idempotencyKey: dto.idempotencyKey,
          threadSequence: nextSequence,
          contentType: dto.contentType ?? 'TEXT',
          replyToMessageId,
        },
      });

      if (dto.mediaIds?.length) {
        await tx.messageMedia.updateMany({
          where: { id: { in: dto.mediaIds }, userId: senderUserId, messageId: null },
          data: { messageId: message.id },
        });
      }

      return message;
    });

    await this.fanoutQueue.add('fanout', {
      messageId: result.id,
      groupId,
      senderUserId,
      senderDeviceId: dto.senderDeviceId,
      ciphertext: dto.ciphertext,
      threadSequence: result.threadSequence,
      replyToMessageId: result.replyToMessageId,
      contentType: dto.contentType ?? 'TEXT',
      createdAt: result.createdAt.toISOString(),
      mediaIds: dto.mediaIds ?? [],
    });

    return { success: true, messageId: result.id, queued: true };
  }

  async editGroupMessage(senderUserId: string, groupId: string, messageId: string, dto: EditGroupMessageDto) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: senderUserId } },
    });
    if (!member) {
      throw new ForbiddenException('You are not a member of this group');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, groupId: true, senderUserId: true, createdAt: true, deletedAt: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.groupId !== groupId) {
      throw new BadRequestException('Message is not in this group');
    }
    if (message.senderUserId !== senderUserId) {
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
      const existing = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { envelopes: true },
      });
      if (!existing) {
        throw new NotFoundException('Message not found');
      }
      return { success: true, messageId: existing.id, queued: false };
    }

    const updated = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!updated) {
      throw new NotFoundException('Message not found after edit');
    }

    await this.editFanoutQueue.add('edit-fanout', {
      messageId: updated.id,
      groupId,
      senderUserId,
      senderDeviceId: dto.senderDeviceId,
      ciphertext: dto.ciphertext,
      editedAt: updated.editedAt!.toISOString(),
    });

    return { success: true, messageId: updated.id, queued: true };
  }

  async findById(id: string) {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: {
        members: true,
      },
    });
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    return group;
  }

  async findByUser(userId: string) {
    return this.prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async assertGroupMember(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('Not a member of this group');
    }
  }

  private async assertGroupAdmin(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('Not a member of this group');
    }
    if (member.role !== 'ADMIN') {
      throw new ForbiddenException('Only group admins can perform this action');
    }
  }
}
