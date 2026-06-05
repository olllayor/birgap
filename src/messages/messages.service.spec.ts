import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UnreadService } from '../unread/unread.service';
import { MessagesService } from './messages.service';
import { MediaService } from './media.service';
import { DeleteMessageScope } from './dto/delete-message.dto';
import type { ForwardMessageDto } from './dto/forward-message.dto';

const mockUnreadService = {
  enqueueRecalc: jest.fn().mockResolvedValue(undefined),
  getCounts: jest.fn().mockResolvedValue([]),
} as unknown as UnreadService;

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultValue: unknown) => defaultValue),
} as unknown as ConfigService;

const mockPushService = {
  sendEditWakeup: jest.fn().mockResolvedValue(undefined),
  sendDeleteWakeup: jest.fn().mockResolvedValue(undefined),
} as unknown as import('../push/push.service').PushService;

const mockMediaService = {
  assertAttachmentsOwned: jest.fn().mockResolvedValue([]),
  cleanupMessageMedia: jest.fn().mockResolvedValue(undefined),
} as unknown as MediaService;

const mockFanoutQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
} as unknown as import('bullmq').Queue;

describe('MessagesService', () => {
  it('returns existing message for duplicate idempotency key', async () => {
    const existing = {
      id: 'message-1',
      threadId: 'thread-1',
      senderUserId: 'user-1',
      senderDeviceId: 'device-1',
      threadSequence: 7,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      envelopes: [{ id: 'envelope-1' }],
    };
    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue(existing),
      },
    };
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

    await expect(
      service.send('user-1', {
        senderDeviceId: 'device-1',
        recipientUserId: 'user-2',
        idempotencyKey: 'idem-12345',
        envelopes: [{ recipientDeviceId: 'device-2', ciphertext: { body: 'encrypted' } }],
      }),
    ).resolves.toMatchObject({
      id: 'message-1',
      threadSequence: 7,
    });
    expect(events.emit).not.toHaveBeenCalled();
  });

  describe('send', () => {
    const makeTx = () => ({
      device: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'device-1', userId: 'user-1' },
          { id: 'device-2', userId: 'user-2' },
        ]),
      },
      directThread: {
        upsert: jest.fn().mockResolvedValue({ id: 'thread-1' }),
        update: jest.fn().mockResolvedValue({ id: 'thread-1', latestSequence: 8 }),
      },
      message: {
        create: jest.fn().mockResolvedValue({
          id: 'message-1',
          threadId: 'thread-1',
          senderUserId: 'user-1',
          senderDeviceId: 'device-1',
          threadSequence: 8,
          createdAt: new Date(),
          envelopes: [{ id: 'envelope-1' }],
        }),
      },
    });

    const makePrisma = (tx: ReturnType<typeof makeTx>) => ({
      message: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: ReturnType<typeof makeTx>) => unknown) => callback(tx)),
    });

    it('creates message with single combined device query', async () => {
      const tx = makeTx();
      const prisma = makePrisma(tx);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      const result = await service.send('user-1', {
        senderDeviceId: 'device-1',
        recipientUserId: 'user-2',
        idempotencyKey: 'idem-1',
        envelopes: [{ recipientDeviceId: 'device-2', ciphertext: { body: 'enc' } }],
      });

      expect(result.id).toBe('message-1');
      expect(tx.device.findMany).toHaveBeenCalledWith({
        where: {
          active: true,
          OR: [
            { id: 'device-1' },
            { userId: 'user-2' },
            { userId: 'user-1', id: { not: 'device-1' } },
          ],
        },
        select: { id: true, userId: true },
      });
      expect(events.emit).toHaveBeenCalledWith('message.created', expect.anything());
    });

    it('binds mediaIds to the new message in the same transaction', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const tx = {
        ...makeTx(),
        messageMedia: {
          updateMany,
        },
      };
      const prisma = {
        message: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      };
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const mediaService = {
        assertAttachmentsOwned: jest.fn().mockResolvedValue([
          { id: 'media-1', userId: 'user-1', messageId: null, uploadStatus: 'COMPLETE' },
          { id: 'media-2', userId: 'user-1', messageId: null, uploadStatus: 'COMPLETE' },
        ]),
        cleanupMessageMedia: jest.fn(),
      } as unknown as MediaService;
      const service = new MessagesService(
        prisma as unknown as PrismaService,
        events,
        mockUnreadService,
        mockConfigService,
        mockPushService,
        mediaService,
        mockFanoutQueue,
      );

      await service.send('user-1', {
        senderDeviceId: 'device-1',
        recipientUserId: 'user-2',
        idempotencyKey: 'idem-media',
        mediaIds: ['media-1', 'media-2'],
        envelopes: [{ recipientDeviceId: 'device-2', ciphertext: { body: 'enc' } }],
      });

      expect(mediaService.assertAttachmentsOwned).toHaveBeenCalledWith(
        'user-1',
        ['media-1', 'media-2'],
        tx,
      );
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['media-1', 'media-2'] }, userId: 'user-1', messageId: null },
        data: { messageId: 'message-1' },
      });
    });

    it('rolls back message creation when mediaIds are invalid', async () => {
      const tx = makeTx();
      const prisma = {
        message: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn((callback: (tx: ReturnType<typeof makeTx>) => unknown) =>
          callback(tx),
        ),
      };
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const mediaService = {
        assertAttachmentsOwned: jest
          .fn()
          .mockRejectedValue(new Error('One or more mediaIds do not exist')),
        cleanupMessageMedia: jest.fn(),
      } as unknown as MediaService;
      const service = new MessagesService(
        prisma as unknown as PrismaService,
        events,
        mockUnreadService,
        mockConfigService,
        mockPushService,
        mediaService,
        mockFanoutQueue,
      );

      await expect(
        service.send('user-1', {
          senderDeviceId: 'device-1',
          recipientUserId: 'user-2',
          idempotencyKey: 'idem-bad-media',
          mediaIds: ['media-bogus'],
          envelopes: [{ recipientDeviceId: 'device-2', ciphertext: { body: 'enc' } }],
        }),
      ).rejects.toThrow('One or more mediaIds do not exist');
      expect(tx.message.create).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('getPending', () => {
    const makePrisma = (envelopes: unknown[]) => ({
      device: {
        findFirst: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1', active: true }),
      },
      messageEnvelope: {
        findMany: jest.fn().mockResolvedValue(envelopes),
      },
    });

    const makeEnvelope = (seq: bigint) => ({
      id: `env-${seq}`,
      envelopeSequence: seq,
      status: 'PENDING',
      message: { id: `msg-${seq}`, threadSequence: Number(seq) },
    });

    it('returns hasMore true when result count equals limit', async () => {
      const envelopes = Array.from({ length: 50 }, (_, i) => makeEnvelope(BigInt(i + 1)));
      const prisma = makePrisma(envelopes);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      const result = await service.getPending('user-1', 'device-1', undefined, 50);

      expect(result.hasMore).toBe(true);
      expect(result.envelopes).toHaveLength(50);
      expect(prisma.messageEnvelope.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('returns hasMore false when fewer results than limit', async () => {
      const envelopes = [makeEnvelope(1n), makeEnvelope(2n)];
      const prisma = makePrisma(envelopes);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      const result = await service.getPending('user-1', 'device-1', undefined, 50);

      expect(result.hasMore).toBe(false);
      expect(result.envelopes).toHaveLength(2);
    });

    it('returns hasMore false for empty result set', async () => {
      const prisma = makePrisma([]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      const result = await service.getPending('user-1', 'device-1', undefined, 50);

      expect(result.hasMore).toBe(false);
      expect(result.envelopes).toHaveLength(0);
    });

    it('uses after cursor to filter envelopes', async () => {
      const prisma = makePrisma([makeEnvelope(51n), makeEnvelope(52n)]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      await service.getPending('user-1', 'device-1', '50', 50);

      expect(prisma.messageEnvelope.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            envelopeSequence: { gt: 50n },
          }),
        }),
      );
    });

    it('orders by envelopeSequence ascending', async () => {
      const prisma = makePrisma([]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      await service.getPending('user-1', 'device-1', undefined, 50);

      expect(prisma.messageEnvelope.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { envelopeSequence: 'asc' },
        }),
      );
    });

    it('defaults limit to 50', async () => {
      const prisma = makePrisma([]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      await service.getPending('user-1', 'device-1');

      expect(prisma.messageEnvelope.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe('sync', () => {
    const makePrisma = (envelopes: unknown[], deletedMessages: unknown[] = []) => ({
      device: {
        findFirst: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1', active: true }),
      },
      messageEnvelope: {
        findMany: jest.fn().mockResolvedValue(envelopes),
      },
      message: {
        findMany: jest.fn().mockResolvedValue(deletedMessages),
      },
    });

    it('returns requiresFullReload when since is older than 14 days', async () => {
      const prisma = makePrisma([]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      const oldSince = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const result = await service.sync('user-1', 'device-1', oldSince);

      expect(result.requiresFullReload).toBe(true);
      expect(result.envelopes).toHaveLength(0);
      expect(result.deletedMessages).toHaveLength(0);
      expect(prisma.messageEnvelope.findMany).not.toHaveBeenCalled();
    });

    it('returns envelopes and deletedMessages within window', async () => {
      const envelopes = [
        {
          id: 'env-1',
          messageId: 'msg-1',
          recipientUserId: 'user-1',
          recipientDeviceId: 'device-1',
          ciphertext: { body: 'enc' },
          status: 'PENDING',
          envelopeVersion: 2,
          updatedAt: new Date(),
          message: {
            id: 'msg-1',
            threadId: 'thread-1',
            groupId: null,
            senderUserId: 'user-2',
            senderDeviceId: 'device-2',
            threadSequence: 1,
            replyToMessageId: null,
            createdAt: new Date(),
            deletedAt: null,
            editedAt: new Date(),
          },
        },
      ];
      const deletedMessages = [
        { id: 'msg-2', threadId: 'thread-1', groupId: null, deletedAt: new Date() },
      ];
      const prisma = makePrisma(envelopes, deletedMessages);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      const recentSince = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const result = await service.sync('user-1', 'device-1', recentSince);

      expect(result.requiresFullReload).toBe(false);
      expect(result.envelopes).toHaveLength(1);
      expect(result.envelopes[0].isEdit).toBe(true);
      expect(result.deletedMessages).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });

    it('caps limit at 500', async () => {
      const prisma = makePrisma([]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events, mockUnreadService, mockConfigService, mockPushService, mockMediaService, mockFanoutQueue);

      const recentSince = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      await service.sync('user-1', 'device-1', recentSince, 1000);

      expect(prisma.messageEnvelope.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 501 }),
      );
    });
  });

  describe('delete (FOR_EVERYONE)', () => {
    const buildAdminDeletePrisma = () => {
      const message = {
        id: 'message-1',
        threadId: null,
        groupId: 'group-1',
        senderUserId: 'author-user',
        createdAt: new Date(),
        deletedAt: null,
        thread: null,
      };
      const tombstoned = {
        ...message,
        deletedAt: new Date('2026-05-16T10:00:00.000Z'),
        thread: null,
        envelopes: [],
      };
      const tx = {
        message: { update: jest.fn().mockResolvedValue(tombstoned) },
        messageAdminDeleteLog: { create: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        device: { findFirst: jest.fn().mockResolvedValue({ id: 'admin-device', userId: 'admin-user', active: true }) },
        message: { findUnique: jest.fn().mockResolvedValue(message) },
        groupMember: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
        $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      };
      return { prisma, tx, message, tombstoned };
    };

    it('emits message.deleted.group with deletedByUserId set to the admin actor, not the message author', async () => {
      const { prisma } = buildAdminDeletePrisma();
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(
        prisma as unknown as PrismaService,
        events,
        mockUnreadService,
        mockConfigService,
        mockPushService,
        mockMediaService,
        mockFanoutQueue,
      );

      await service.delete('admin-user', 'message-1', {
        deviceId: 'admin-device',
        scope: DeleteMessageScope.FOR_EVERYONE,
      });

      expect(events.emit).toHaveBeenCalledWith(
        'message.deleted.group',
        expect.objectContaining({
          messageId: 'message-1',
          groupId: 'group-1',
          senderUserId: 'author-user',
          deletedBy: 'ADMIN',
          deletedByUserId: 'admin-user',
        }),
      );
    });
  });

  describe('forward', () => {
    it('continues to next target when one target fails', async () => {
      const sourceMessage = {
        id: 'source-msg',
        threadId: 'thread-src',
        groupId: null,
        senderUserId: 'user-other',
        createdAt: new Date(),
        deletedAt: null,
        thread: { userAId: 'user-1', userBId: 'user-other' },
      };

      const createdMessage = {
        id: 'fwd-msg',
        threadId: 'thread-new',
        groupId: null,
        senderUserId: 'user-1',
        senderDeviceId: 'device-1',
        threadSequence: 1,
        createdAt: new Date(),
        envelopes: [{ id: 'env-fwd' }],
        media: [],
      };

      const tx = {
        device: {
          findMany: jest.fn().mockImplementation(({ where }: { where: { OR: Array<Record<string, unknown>> } }) => {
            const recipientUserId = (where.OR[1] as { userId: string }).userId;
            if (recipientUserId === 'user-no-devices') {
              return [{ id: 'device-1', userId: 'user-1' }];
            }
            return [
              { id: 'device-1', userId: 'user-1' },
              { id: 'device-2', userId: recipientUserId },
            ];
          }),
        },
        directThread: {
          upsert: jest.fn().mockResolvedValue({ id: 'thread-new' }),
          update: jest.fn().mockResolvedValue({ id: 'thread-new', latestSequence: 1 }),
        },
        message: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(createdMessage),
        },
      };

      const prisma = {
        device: { findFirst: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1', active: true }) },
        message: {
          findUnique: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ('id' in where) return sourceMessage;
            return null;
          }),
        },
        messageMedia: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      };

      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const mediaService = {
        cloneMediaForForward: jest.fn(),
        cleanupMessageMedia: jest.fn(),
      } as unknown as MediaService;

      const service = new MessagesService(
        prisma as unknown as PrismaService,
        events,
        mockUnreadService,
        mockConfigService,
        mockPushService,
        mediaService,
        mockFanoutQueue,
      );

      const dto: ForwardMessageDto = {
        sourceMessageId: 'source-msg',
        senderDeviceId: 'device-1',
        idempotencyKey: 'fwd-idem-12345',
        targets: [
          {
            type: 'direct',
            recipientUserId: 'user-no-devices',
            envelopes: [{ recipientDeviceId: 'device-x', ciphertext: { body: 'enc' } }],
          },
          {
            type: 'direct',
            recipientUserId: 'user-2',
            envelopes: [{ recipientDeviceId: 'device-2', ciphertext: { body: 'enc' } }],
          },
        ],
      };

      const result = await service.forward('user-1', dto);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({ success: false, targetId: 'user-no-devices' });
      expect(result.results[1]).toMatchObject({ success: true, targetId: 'user-2' });
    });
  });
});
