import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DirectThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const thread = await this.prisma.directThread.findUnique({
      where: { id },
    });
    if (!thread) {
      throw new NotFoundException('DirectThread not found');
    }
    return thread;
  }

  async findByIdWithDetails(id: string, userId: string) {
    const thread = await this.prisma.directThread.findUnique({
      where: { id },
      include: {
        userA: {
          select: {
            id: true,
            username: true,
            profileAvatarUrl: true,
            encryptedProfile: true,
            profileKeyHash: true,
            createdAt: true,
          },
        },
        userB: {
          select: {
            id: true,
            username: true,
            profileAvatarUrl: true,
            encryptedProfile: true,
            profileKeyHash: true,
            createdAt: true,
          },
        },
      },
    });
    if (!thread) {
      throw new NotFoundException('DirectThread not found');
    }
    if (thread.userAId !== userId && thread.userBId !== userId) {
      throw new ForbiddenException('Cannot query a thread you are not part of');
    }
    return thread;
  }

  async getMessages(
    threadId: string,
    userId: string,
    opts: { limit?: number; beforeSequence?: number; afterSequence?: number },
  ) {
    const thread = await this.prisma.directThread.findUnique({
      where: { id: threadId },
      select: { userAId: true, userBId: true },
    });
    if (!thread) {
      throw new NotFoundException('DirectThread not found');
    }
    if (thread.userAId !== userId && thread.userBId !== userId) {
      throw new ForbiddenException('Cannot query a thread you are not part of');
    }

    const take = Math.min(opts.limit ?? 50, 100);
    const messages = await this.prisma.message.findMany({
      where: {
        threadId,
        ...(opts.beforeSequence !== undefined && { threadSequence: { lt: opts.beforeSequence } }),
        ...(opts.afterSequence !== undefined && { threadSequence: { gt: opts.afterSequence } }),
      },
      orderBy: { threadSequence: 'desc' },
      take,
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
    });

    const reversed = messages.reverse();

    const mediaRecords = await this.prisma.messageMedia.findMany({
      where: { messageId: { in: reversed.map((m) => m.id) } },
      orderBy: { createdAt: 'asc' },
    });
    const mediaByMessage = new Map<string, typeof mediaRecords>();
    for (const m of mediaRecords) {
      if (!m.messageId) continue;
      const list = mediaByMessage.get(m.messageId) ?? [];
      list.push(m);
      mediaByMessage.set(m.messageId, list);
    }

    const replyIds = reversed
      .map((m) => m.replyToMessageId)
      .filter((id): id is string => id !== null);
    const replyMessages = replyIds.length
      ? await this.prisma.message.findMany({
          where: { id: { in: replyIds } },
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
        })
      : [];
    const replyMap = new Map(replyMessages.map((r) => [r.id, r]));

    return reversed.map((msg) => ({
      ...msg,
      media: mediaByMessage.get(msg.id) ?? [],
      replyTo: msg.replyToMessageId ? replyMap.get(msg.replyToMessageId) ?? null : null,
    }));
  }

  async findByUser(userId: string) {
    return this.prisma.directThread.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findByUserWithDetails(userId: string) {
    const threads = await this.prisma.directThread.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { threadSequence: 'desc' },
          take: 1,
          select: {
            id: true,
            senderUserId: true,
            threadSequence: true,
            contentType: true,
            createdAt: true,
          },
        },
      },
    });

    const unreadCounts = await this.prisma.unreadCounter.findMany({
      where: {
        userId,
        threadType: 'direct',
        threadId: { in: threads.map((t) => t.id) },
      },
    });

    const unreadMap = new Map(unreadCounts.map((u) => [u.threadId, u.count]));

    const otherUserIds = threads.map((t) =>
      t.userAId === userId ? t.userBId : t.userAId,
    );

    const otherUsers = await this.prisma.user.findMany({
      where: { id: { in: otherUserIds } },
      select: { id: true, username: true, phoneMasked: true, profileAvatarUrl: true },
    });

    const userMap = new Map(otherUsers.map((u) => [u.id, u]));

    return threads.map((thread) => {
      const otherUserId = thread.userAId === userId ? thread.userBId : thread.userAId;
      const otherUser = userMap.get(otherUserId);
      const lastMessage = thread.messages[0];

      return {
        id: thread.id,
        otherUserId,
        otherUserName: otherUser?.username ?? otherUser?.phoneMasked ?? 'Unknown',
        otherUserAvatarUrl: otherUser?.profileAvatarUrl ?? null,
        lastMessagePreview: null,
        lastMessageAt: lastMessage?.createdAt?.toISOString() ?? thread.updatedAt.toISOString(),
        unreadCount: unreadMap.get(thread.id) ?? 0,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      };
    });
  }
}
