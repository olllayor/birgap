import { GroupFanoutProcessor } from './group-fanout.processor';

describe('GroupFanoutProcessor', () => {
  let prisma: any;
  let events: any;
  let processor: GroupFanoutProcessor;

  beforeEach(() => {
    prisma = {
      device: {
        findMany: jest.fn(),
      },
      messageEnvelope: {
        createMany: jest.fn(),
      },
    };

    events = {
      emit: jest.fn(),
    };

    processor = new GroupFanoutProcessor(prisma, events);
  });

  it('fans out message to active devices excluding sender device and emits message.created event', async () => {
    // Mock active devices for group members (single query)
    prisma.device.findMany.mockResolvedValue([
      { id: 'dev-1-sender', userId: 'user-1' },
      { id: 'dev-1-sync', userId: 'user-1' },
      { id: 'dev-2', userId: 'user-2' },
      { id: 'dev-3', userId: 'user-3' },
    ]);

    prisma.messageEnvelope.createMany.mockResolvedValue({ count: 3 });

    const job = {
      data: {
        messageId: 'msg-1',
        groupId: 'group-1',
        senderUserId: 'user-1',
        senderDeviceId: 'dev-1-sender',
        ciphertext: 'cipher',
        threadSequence: 5,
        createdAt: new Date('2026-05-20T00:00:00Z').toISOString(),
      },
    } as any;

    const result = await processor.process(job);
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
      createdAt,
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
            createdAt,
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
            createdAt,
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
            createdAt,
          },
        },
      ],
    });
  });
});
