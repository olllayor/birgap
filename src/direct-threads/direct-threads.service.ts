import { Injectable, NotFoundException } from '@nestjs/common';
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
      select: { id: true, username: true, phoneMasked: true },
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
        lastMessagePreview: null,
        lastMessageAt: lastMessage?.createdAt?.toISOString() ?? thread.updatedAt.toISOString(),
        unreadCount: unreadMap.get(thread.id) ?? 0,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      };
    });
  }
}
