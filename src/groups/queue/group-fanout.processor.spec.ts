import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { UnreadService } from '../../unread/unread.service';
import { GroupFanoutJobData, GroupFanoutProcessor } from './group-fanout.processor';

describe('GroupFanoutProcessor', () => {
  let processor: GroupFanoutProcessor;

  const mockQueueMetrics = {
    recordCompleted: jest.fn(),
    recordFailed: jest.fn(),
  } as unknown as QueueMetrics;

  const mockUnreadService = {
    enqueueRecalc: jest.fn().mockResolvedValue(undefined),
  } as unknown as UnreadService;

  beforeEach(() => {
    const prisma = {
      device: {
        findMany: jest.fn(),
      },
      messageEnvelope: {
        createMany: jest.fn(),
      },
      messageMedia: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const events = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    processor = new GroupFanoutProcessor(prisma, events, mockQueueMetrics, mockUnreadService);
  });

  it('fans out message to active devices excluding sender device and emits message.created event', async () => {
    // Need to access the mock prisma instance for assertions.
    // Since processor stores it privately, we spy via the constructor.
    // We'll re-instantiate here with refs we can access.
    const prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dev-1-sender', userId: 'user-1' },
          { id: 'dev-1-sync', userId: 'user-1' },
          { id: 'dev-2', userId: 'user-2' },
          { id: 'dev-3', userId: 'user-3' },
        ]),
      },
      messageEnvelope: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      messageMedia: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const events = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    const testProcessor = new GroupFanoutProcessor(prisma, events, mockQueueMetrics, mockUnreadService);

    const job = {
      data: {
        messageId: 'msg-1',
        groupId: 'group-1',
        senderUserId: 'user-1',
        senderDeviceId: 'dev-1-sender',
        ciphertext: 'cipher',
        threadSequence: 5,
        replyToMessageId: null,
        createdAt: new Date('2026-05-20T00:00:00Z').toISOString(),
        mediaIds: [],
      },
    } as unknown as Job<GroupFanoutJobData>;

    const result = await testProcessor.process(job);
    expect(result).toEqual({ fannedOutTo: 3 }); // dev-1-sync, dev-2, dev-3

    // Verify single combined query
    expect(prisma.device.findMany).toHaveBeenCalledWith({
      where: {
        user: {
          groupMembers: { some: { groupId: 'group-1' } },
        },
        active: true,
      },
      select: { id: true, userId: true },
    });

    // Verify batch insert excludes sender device
    expect(prisma.messageEnvelope.createMany).toHaveBeenCalledWith({
      data: [
        { messageId: 'msg-1', recipientUserId: 'user-1', recipientDeviceId: 'dev-1-sync', ciphertext: 'cipher', status: 'PENDING' },
        { messageId: 'msg-1', recipientUserId: 'user-2', recipientDeviceId: 'dev-2', ciphertext: 'cipher', status: 'PENDING' },
        { messageId: 'msg-1', recipientUserId: 'user-3', recipientDeviceId: 'dev-3', ciphertext: 'cipher', status: 'PENDING' },
      ],
      skipDuplicates: true,
    });

    // Verify emit matches the expected realtime gateway payload
    const createdAt = new Date('2026-05-20T00:00:00Z').toISOString();
    expect(events.emit).toHaveBeenCalledWith('message.created', {
      id: 'msg-1',
      threadId: null,
      groupId: 'group-1',
      senderUserId: 'user-1',
      senderDeviceId: 'dev-1-sender',
      threadSequence: 5,
      contentType: 'TEXT',
      replyToMessageId: null,
      forwarded: false,
      createdAt,
      media: [],
      envelopes: [
        {
          messageId: 'msg-1',
          recipientUserId: 'user-1',
          recipientDeviceId: 'dev-1-sync',
          ciphertext: 'cipher',
          status: 'PENDING',
          deliveredAt: null,
          readAt: null,
          createdAt,
          message: {
            id: 'msg-1',
            threadId: null,
            groupId: 'group-1',
            senderUserId: 'user-1',
            senderDeviceId: 'dev-1-sender',
            threadSequence: 5,
            contentType: 'TEXT',
            replyToMessageId: null,
            forwarded: false,
            createdAt,
            media: [],
          },
        },
        {
          messageId: 'msg-1',
          recipientUserId: 'user-2',
          recipientDeviceId: 'dev-2',
          ciphertext: 'cipher',
          status: 'PENDING',
          deliveredAt: null,
          readAt: null,
          createdAt,
          message: {
            id: 'msg-1',
            threadId: null,
            groupId: 'group-1',
            senderUserId: 'user-1',
            senderDeviceId: 'dev-1-sender',
            threadSequence: 5,
            contentType: 'TEXT',
            replyToMessageId: null,
            forwarded: false,
            createdAt,
            media: [],
          },
        },
        {
          messageId: 'msg-1',
          recipientUserId: 'user-3',
          recipientDeviceId: 'dev-3',
          ciphertext: 'cipher',
          status: 'PENDING',
          deliveredAt: null,
          readAt: null,
          createdAt,
          message: {
            id: 'msg-1',
            threadId: null,
            groupId: 'group-1',
            senderUserId: 'user-1',
            senderDeviceId: 'dev-1-sender',
            threadSequence: 5,
            contentType: 'TEXT',
            replyToMessageId: null,
            forwarded: false,
            createdAt,
            media: [],
          },
        },
      ],
    });
  });
});
