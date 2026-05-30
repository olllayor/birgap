import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from './messages.service';

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
    const service = new MessagesService(prisma as unknown as PrismaService, events);

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
      const service = new MessagesService(prisma as unknown as PrismaService, events);

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
      const service = new MessagesService(prisma as unknown as PrismaService, events);

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
      const service = new MessagesService(prisma as unknown as PrismaService, events);

      const result = await service.getPending('user-1', 'device-1', undefined, 50);

      expect(result.hasMore).toBe(false);
      expect(result.envelopes).toHaveLength(2);
    });

    it('returns hasMore false for empty result set', async () => {
      const prisma = makePrisma([]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events);

      const result = await service.getPending('user-1', 'device-1', undefined, 50);

      expect(result.hasMore).toBe(false);
      expect(result.envelopes).toHaveLength(0);
    });

    it('uses after cursor to filter envelopes', async () => {
      const prisma = makePrisma([makeEnvelope(51n), makeEnvelope(52n)]);
      const events = { emit: jest.fn() } as unknown as EventEmitter2;
      const service = new MessagesService(prisma as unknown as PrismaService, events);

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
      const service = new MessagesService(prisma as unknown as PrismaService, events);

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
      const service = new MessagesService(prisma as unknown as PrismaService, events);

      await service.getPending('user-1', 'device-1');

      expect(prisma.messageEnvelope.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });
});
