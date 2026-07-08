import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaType } from '../messages/enums/media-type.enum';
import { DirectThreadsService } from './direct-threads.service';

describe('DirectThreadsService', () => {
  it('findById returns thread without messages', async () => {
    const prisma = {
      directThread: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'thread-1',
          userAId: 'user-1',
          userBId: 'user-2',
          latestSequence: 5,
        }),
      },
    };
    const service = new DirectThreadsService(prisma as unknown as PrismaService);

    const result = await service.findById('thread-1');
    expect(result).toMatchObject({ id: 'thread-1' });
    expect(prisma.directThread.findUnique).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
    });
  });

  it('findById throws when thread not found', async () => {
    const prisma = {
      directThread: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new DirectThreadsService(prisma as unknown as PrismaService);

    await expect(service.findById('thread-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByUser returns threads without messages', async () => {
    const prisma = {
      directThread: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'thread-1', userAId: 'user-1', userBId: 'user-2' },
        ]),
      },
    };
    const service = new DirectThreadsService(prisma as unknown as PrismaService);

    const result = await service.findByUser('user-1');
    expect(result).toHaveLength(1);
    expect(prisma.directThread.findMany).toHaveBeenCalledWith({
      where: { OR: [{ userAId: 'user-1' }, { userBId: 'user-1' }] },
      orderBy: { updatedAt: 'desc' },
    });
  });

  describe('updateThreadSettings', () => {
    const thread = { userAId: 'user-1', userBId: 'user-2' };
    const FAR_FUTURE = new Date('9999-12-31T00:00:00Z');

    it('throws NotFoundException when thread does not exist', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(null) },
        threadSetting: { upsert: jest.fn() },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      await expect(
        service.updateThreadSettings('user-1', 'thread-1', { muted: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.threadSetting.upsert).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when user is not a participant', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        threadSetting: { upsert: jest.fn() },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      await expect(
        service.updateThreadSettings('user-3', 'thread-1', { muted: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.threadSetting.upsert).not.toHaveBeenCalled();
    });

    it('muting upserts a far-future mutedUntil and reports isMuted true', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        threadSetting: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      const result = await service.updateThreadSettings('user-1', 'thread-1', { muted: true });

      expect(result).toEqual({ threadId: 'thread-1', isMuted: true });
      expect(prisma.threadSetting.upsert).toHaveBeenCalledWith({
        where: { userId_threadId: { userId: 'user-1', threadId: 'thread-1' } },
        create: { userId: 'user-1', threadId: 'thread-1', mutedUntil: FAR_FUTURE },
        update: { mutedUntil: FAR_FUTURE },
      });
    });

    it('unmuting upserts a null mutedUntil and reports isMuted false', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        threadSetting: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      const result = await service.updateThreadSettings('user-2', 'thread-1', { muted: false });

      expect(result).toEqual({ threadId: 'thread-1', isMuted: false });
      expect(prisma.threadSetting.upsert).toHaveBeenCalledWith({
        where: { userId_threadId: { userId: 'user-2', threadId: 'thread-1' } },
        create: { userId: 'user-2', threadId: 'thread-1', mutedUntil: null },
        update: { mutedUntil: null },
      });
    });
  });

  describe('findByUserWithDetails', () => {
    const buildPrisma = (settings: Array<{ threadId: string; mutedUntil: Date | null }>) => ({
      directThread: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'thread-1',
            userAId: 'user-1',
            userBId: 'user-2',
            createdAt: new Date('2026-07-01T00:00:00Z'),
            updatedAt: new Date('2026-07-02T00:00:00Z'),
            messages: [],
          },
          {
            id: 'thread-2',
            userAId: 'user-3',
            userBId: 'user-1',
            createdAt: new Date('2026-07-01T00:00:00Z'),
            updatedAt: new Date('2026-07-02T00:00:00Z'),
            messages: [],
          },
        ]),
      },
      unreadCounter: { findMany: jest.fn().mockResolvedValue([]) },
      threadSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    });

    it('marks threads with an active (future) mute as isMuted', async () => {
      const prisma = buildPrisma([
        { threadId: 'thread-1', mutedUntil: new Date('9999-12-31T00:00:00Z') },
      ]);
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      const result = await service.findByUserWithDetails('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'thread-1', isMuted: true });
      expect(result[1]).toMatchObject({ id: 'thread-2', isMuted: false });
      // Batched: one findMany across all thread ids for the calling user.
      expect(prisma.threadSetting.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.threadSetting.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', threadId: { in: ['thread-1', 'thread-2'] } },
        select: { threadId: true, mutedUntil: true },
      });
    });

    it('treats expired or cleared mutes as not muted', async () => {
      const prisma = buildPrisma([
        { threadId: 'thread-1', mutedUntil: new Date('2020-01-01T00:00:00Z') },
        { threadId: 'thread-2', mutedUntil: null },
      ]);
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      const result = await service.findByUserWithDetails('user-1');

      expect(result[0]).toMatchObject({ id: 'thread-1', isMuted: false });
      expect(result[1]).toMatchObject({ id: 'thread-2', isMuted: false });
    });
  });

  describe('getThreadMedia', () => {
    const thread = { userAId: 'user-1', userBId: 'user-2' };
    const mediaRow = (id: string, threadSequence: number) => ({
      id,
      messageId: `msg-${threadSequence}`,
      mediaType: 'IMAGE',
      bucketKey: `bucket/${id}`,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      filename: `${id}.jpg`,
      thumbnailBucketKey: null,
      width: 800,
      height: 600,
      duration: null,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      message: { threadSequence },
    });

    it('throws NotFoundException when thread does not exist', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(null) },
        messageMedia: { findMany: jest.fn() },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      await expect(
        service.getThreadMedia('user-1', 'thread-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.messageMedia.findMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when user is not a participant', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        messageMedia: { findMany: jest.fn() },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      await expect(
        service.getThreadMedia('user-3', 'thread-1', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.messageMedia.findMany).not.toHaveBeenCalled();
    });

    it('returns completed media newest first with no nextCursor when page is not full', async () => {
      const rows = [mediaRow('b2b2b2b2-0000-0000-0000-000000000002', 7), mediaRow('a1a1a1a1-0000-0000-0000-000000000001', 5)];
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        messageMedia: { findMany: jest.fn().mockResolvedValue(rows) },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      const result = await service.getThreadMedia('user-1', 'thread-1', { limit: 30 });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        id: 'b2b2b2b2-0000-0000-0000-000000000002',
        threadSequence: 7,
        mediaType: 'IMAGE',
      });
      expect(result.items[0]).not.toHaveProperty('message');

      const args = prisma.messageMedia.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        uploadStatus: 'COMPLETE',
        message: { is: { threadId: 'thread-1', deletedAt: null } },
      });
      expect(args.orderBy).toEqual([
        { message: { threadSequence: 'desc' } },
        { id: 'desc' },
      ]);
      expect(args.take).toBe(31);
    });

    it('applies mediaType filter when type is provided', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        messageMedia: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      await service.getThreadMedia('user-2', 'thread-1', { type: MediaType.VIDEO });

      const args = prisma.messageMedia.findMany.mock.calls[0][0];
      expect(args.where.mediaType).toBe(MediaType.VIDEO);
    });

    it('returns nextCursor and applies keyset cursor filter across pages', async () => {
      const rows = [
        mediaRow('c3c3c3c3-0000-0000-0000-000000000003', 9),
        mediaRow('b2b2b2b2-0000-0000-0000-000000000002', 8),
        mediaRow('a1a1a1a1-0000-0000-0000-000000000001', 7),
      ];
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        messageMedia: { findMany: jest.fn().mockResolvedValue(rows) },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      const page1 = await service.getThreadMedia('user-1', 'thread-1', { limit: 2 });

      expect(page1.hasMore).toBe(true);
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBe('8:b2b2b2b2-0000-0000-0000-000000000002');

      prisma.messageMedia.findMany.mockResolvedValue([rows[2]]);
      const page2 = await service.getThreadMedia('user-1', 'thread-1', {
        limit: 2,
        cursor: page1.nextCursor!,
      });

      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
      expect(page2.items).toHaveLength(1);

      const args = prisma.messageMedia.findMany.mock.calls[1][0];
      expect(args.where.OR).toEqual([
        { message: { is: { threadId: 'thread-1', threadSequence: { lt: 8 } } } },
        {
          message: { is: { threadId: 'thread-1', threadSequence: 8 } },
          id: { lt: 'b2b2b2b2-0000-0000-0000-000000000002' },
        },
      ]);
    });

    it('throws BadRequestException on malformed cursor', async () => {
      const prisma = {
        directThread: { findUnique: jest.fn().mockResolvedValue(thread) },
        messageMedia: { findMany: jest.fn() },
      };
      const service = new DirectThreadsService(prisma as unknown as PrismaService);

      await expect(
        service.getThreadMedia('user-1', 'thread-1', { cursor: 'not-a-cursor' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.messageMedia.findMany).not.toHaveBeenCalled();
    });
  });
});
