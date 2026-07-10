import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaType } from '../messages/enums/media-type.enum';

const MEDIA_CURSOR_PATTERN = /^(\d+):([0-9a-f-]{36})$/i;

// "Muted forever" sentinel. Stored as a far-future mutedUntil so the schema
// already supports timed mutes (an optional `until` param) without migration.
const MUTED_FOREVER = new Date('9999-12-31T00:00:00Z');

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

  async getThreadMedia(
    userId: string,
    threadId: string,
    opts: { type?: MediaType; cursor?: string; limit?: number },
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

    // Keyset cursor: `${threadSequence}:${mediaId}` of the last item on the
    // previous page. Ordering is (message.threadSequence desc, media.id desc)
    // so multiple media on one message paginate deterministically.
    let cursorSequence: number | undefined;
    let cursorMediaId: string | undefined;
    if (opts.cursor !== undefined) {
      const match = MEDIA_CURSOR_PATTERN.exec(opts.cursor);
      if (!match) {
        throw new BadRequestException('Invalid cursor');
      }
      cursorSequence = Number(match[1]);
      cursorMediaId = match[2].toLowerCase();
    }

    const take = Math.min(opts.limit ?? 30, 100);
    const items = await this.prisma.messageMedia.findMany({
      where: {
        uploadStatus: 'COMPLETE',
        ...(opts.type && { mediaType: opts.type }),
        message: { is: { threadId, deletedAt: null } },
        ...(cursorSequence !== undefined && {
          OR: [
            { message: { is: { threadId, threadSequence: { lt: cursorSequence } } } },
            {
              message: { is: { threadId, threadSequence: cursorSequence } },
              id: { lt: cursorMediaId },
            },
          ],
        }),
      },
      orderBy: [{ message: { threadSequence: 'desc' } }, { id: 'desc' }],
      take: take + 1,
      select: {
        id: true,
        messageId: true,
        mediaType: true,
        bucketKey: true,
        mimeType: true,
        sizeBytes: true,
        filename: true,
        thumbnailBucketKey: true,
        width: true,
        height: true,
        duration: true,
        createdAt: true,
        message: { select: { threadSequence: true } },
      },
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? `${last.message?.threadSequence}:${last.id}` : null;

    return {
      items: page.map(({ message, ...media }) => ({
        ...media,
        threadSequence: message?.threadSequence ?? null,
      })),
      nextCursor,
      hasMore,
    };
  }

  async updateThreadSettings(userId: string, threadId: string, opts: { muted: boolean }) {
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

    // Idempotent either way: muting twice keeps the far-future timestamp,
    // unmuting a thread that was never muted just upserts a null-mute row.
    const mutedUntil = opts.muted ? MUTED_FOREVER : null;
    await this.prisma.threadSetting.upsert({
      where: { userId_threadId: { userId, threadId } },
      create: { userId, threadId, mutedUntil },
      update: { mutedUntil },
    });

    return { threadId, isMuted: opts.muted };
  }

  // Saved Messages: the user's self-thread (userAId === userBId). Idempotent
  // upsert so the settings-hub "Saved" entry always resolves to a thread.
  async getOrCreateSavedThread(userId: string) {
    const thread = await this.prisma.directThread.upsert({
      where: { userAId_userBId: { userAId: userId, userBId: userId } },
      update: {},
      create: { userAId: userId, userBId: userId },
    });
    return {
      id: thread.id,
      isSelf: true,
      latestSequence: thread.latestSequence,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
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

    // One batched lookup for the caller's per-thread settings (no N+1).
    const settings = await this.prisma.threadSetting.findMany({
      where: { userId, threadId: { in: threads.map((t) => t.id) } },
      select: { threadId: true, mutedUntil: true },
    });
    const now = new Date();
    const mutedThreadIds = new Set(
      settings
        .filter((s) => s.mutedUntil !== null && s.mutedUntil > now)
        .map((s) => s.threadId),
    );

    const otherUserIds = threads.map((t) =>
      t.userAId === userId ? t.userBId : t.userAId,
    );

    const otherUsers = await this.prisma.user.findMany({
      where: { id: { in: otherUserIds } },
      select: {
        id: true,
        username: true,
        phoneMasked: true,
        profileAvatarUrl: true,
        encryptedProfile: true,
        profileKeyHash: true,
      },
    });

    const userMap = new Map(otherUsers.map((u) => [u.id, u]));

    return threads.map((thread) => {
      const otherUserId = thread.userAId === userId ? thread.userBId : thread.userAId;
      const otherUser = userMap.get(otherUserId);
      const lastMessage = thread.messages[0];

      return {
        id: thread.id,
        // Self-thread renders as "Saved Messages" client-side.
        isSelf: thread.userAId === thread.userBId,
        otherUserId,
        otherUserName: otherUser?.username ?? otherUser?.phoneMasked ?? 'Unknown',
        otherUserAvatarUrl: otherUser?.profileAvatarUrl ?? null,
        // E2EE display name material; client decrypts to show first/last name.
        otherUserEncryptedProfile: otherUser?.encryptedProfile ?? null,
        otherUserProfileKeyHash: otherUser?.profileKeyHash ?? null,
        lastMessagePreview: null,
        lastMessageAt: lastMessage?.createdAt?.toISOString() ?? thread.updatedAt.toISOString(),
        unreadCount: unreadMap.get(thread.id) ?? 0,
        isMuted: mutedThreadIds.has(thread.id),
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      };
    });
  }
}
