import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AllowedEmoji } from './dto/send-reaction.dto';

export interface ReactionCount {
  emoji: string;
  count: number;
  reacted: boolean;
}

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly redis: RedisService,
    @InjectQueue('reaction-fanout') private readonly fanoutQueue: Queue,
  ) {}

  async toggle(userId: string, messageId: string, emoji: AllowedEmoji) {
    const message = await this.assertMessageAccess(userId, messageId);

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageReaction.findUnique({
        where: { userId_messageId: { userId, messageId } },
      });

      if (existing && existing.emoji === emoji) {
        await tx.messageReaction.delete({ where: { id: existing.id } });
        return { action: 'removed' as const, emoji: existing.emoji, reactionId: existing.id };
      }

      const reaction = await tx.messageReaction.upsert({
        where: { userId_messageId: { userId, messageId } },
        update: { emoji },
        create: { messageId, userId, emoji },
      });

      return { action: 'added' as const, emoji: reaction.emoji, reactionId: reaction.id };
    });

    await this.invalidateCache(messageId);

    const eventType = result.action === 'removed' ? 'removed' : 'created';
    await this.emitReactionEvent(eventType, result.reactionId, messageId, message, userId, result.emoji);

    return { action: result.action, emoji: result.emoji };
  }

  async remove(userId: string, messageId: string) {
    const message = await this.assertMessageAccess(userId, messageId);

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageReaction.findUnique({
        where: { userId_messageId: { userId, messageId } },
      });

      if (!existing) {
        return null;
      }

      await tx.messageReaction.delete({ where: { id: existing.id } });
      return existing;
    });

    if (!result) {
      return { removed: false };
    }

    await this.invalidateCache(messageId);
    await this.emitReactionEvent('removed', result.id, messageId, message, userId, result.emoji);

    return { removed: true };
  }

  async getAggregated(userId: string, messageId: string): Promise<ReactionCount[]> {
    await this.assertMessageAccess(userId, messageId);

    const userReaction = await this.prisma.messageReaction.findUnique({
      where: { userId_messageId: { userId, messageId } },
      select: { emoji: true },
    });

    const cached = await this.getCachedReactions(messageId);
    if (cached) {
      return cached.map((r) => ({
        ...r,
        reacted: userReaction?.emoji === r.emoji,
      }));
    }

    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true },
    });

    const counts = new Map<string, number>();
    for (const r of reactions) {
      counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    }

    const result: ReactionCount[] = Array.from(counts.entries()).map(([emoji, count]) => ({
      emoji,
      count,
      reacted: userReaction?.emoji === emoji,
    }));

    await this.cacheReactions(messageId, result);

    return result;
  }

  private async assertMessageAccess(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        threadId: true,
        groupId: true,
        senderUserId: true,
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

  private async emitReactionEvent(
    type: 'created' | 'removed',
    reactionId: string,
    messageId: string,
    message: { threadId: string | null; groupId: string | null; thread?: { userAId: string; userBId: string } | null },
    userId: string,
    emoji: string,
  ) {
    const createdAt = new Date().toISOString();

    if (message.groupId) {
      await this.fanoutQueue.add('reaction-fanout', {
        reactionId,
        messageId,
        groupId: message.groupId,
        userId,
        emoji,
        createdAt,
        type,
      });
    } else if (message.threadId && message.thread) {
      const targetUserIds = [message.thread.userAId, message.thread.userBId].filter((id) => id !== userId);
      const eventName = type === 'created' ? 'reaction.created' : 'reaction.removed';
      this.events.emit(eventName, {
        reactionId,
        messageId,
        threadId: message.threadId,
        userId,
        emoji,
        createdAt,
        targetUserIds,
      });
    }
  }

  private async getCachedReactions(messageId: string): Promise<Array<{ emoji: string; count: number }> | null> {
    const raw = await this.redis.client.get(`message:${messageId}:reactions`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private async cacheReactions(messageId: string, data: ReactionCount[]) {
    const cacheData = data.map(({ emoji, count }) => ({ emoji, count }));
    await this.redis.client.set(`message:${messageId}:reactions`, JSON.stringify(cacheData), 'EX', 300);
  }

  private async invalidateCache(messageId: string) {
    await this.redis.client.del(`message:${messageId}:reactions`);
  }
}
