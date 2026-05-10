import { EventEmitter2 } from '@nestjs/event-emitter';
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
    const service = new MessagesService(prisma as any, events);

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
});
