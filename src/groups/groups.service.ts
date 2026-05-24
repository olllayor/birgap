import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('group-fanout') private readonly fanoutQueue: Queue,
  ) {}

  async createGroup(creatorUserId: string, dto: CreateGroupDto) {
    const memberIds = Array.from(new Set([creatorUserId, ...dto.members]));

    return this.prisma.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: {
          encryptedMetadata: dto.encryptedMetadata as any,
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
      return group;
    });
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

    return this.prisma.groupMember.createMany({
      data: newMemberIds.map((id) => ({
        groupId,
        userId: id,
        role: 'MEMBER',
      })),
    });
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

    return this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });
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

      return tx.message.create({
        data: {
          groupId,
          senderUserId,
          senderDeviceId: dto.senderDeviceId,
          idempotencyKey: dto.idempotencyKey,
          threadSequence: nextSequence,
        },
      });
    });

    await this.fanoutQueue.add('fanout', {
      messageId: result.id,
      groupId,
      senderUserId,
      senderDeviceId: dto.senderDeviceId,
      ciphertext: dto.ciphertext,
    });

    return { success: true, messageId: result.id, queued: true };
  }

  async findById(id: string) {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: {
        members: true,
        messages: { orderBy: { threadSequence: 'asc' } },
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
        messages: { orderBy: { threadSequence: 'asc' } },
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
