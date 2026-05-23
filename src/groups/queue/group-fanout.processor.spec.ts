import { GroupFanoutProcessor } from './group-fanout.processor';

describe('GroupFanoutProcessor', () => {
  let prisma: any;
  let events: any;
  let processor: GroupFanoutProcessor;

  beforeEach(() => {
    prisma = {
      groupMember: {
        findMany: jest.fn(),
      },
      device: {
        findMany: jest.fn(),
      },
      messageEnvelope: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
    };

    events = {
      emit: jest.fn(),
    };

    processor = new GroupFanoutProcessor(prisma, events);
  });

  it('fans out message to active devices excluding sender device and emits message.created event', async () => {
    // Mock group members
    prisma.groupMember.findMany.mockResolvedValue([
      { userId: 'user-1' },
      { userId: 'user-2' },
      { userId: 'user-3' },
    ]);

    // Mock active devices
    prisma.device.findMany.mockResolvedValue([
      { id: 'dev-1-sender', userId: 'user-1' },
      { id: 'dev-1-sync', userId: 'user-1' },
      { id: 'dev-2', userId: 'user-2' },
      { id: 'dev-3', userId: 'user-3' },
    ]);

    // Mock envelopes queries
    prisma.messageEnvelope.createMany.mockResolvedValue({ count: 3 });

    const mockEnvelopes = [
      {
        id: 'env-1',
        messageId: 'msg-1',
        recipientUserId: 'user-1',
        recipientDeviceId: 'dev-1-sync',
        ciphertext: 'cipher',
        status: 'PENDING',
        deliveredAt: null,
        readAt: null,
        envelopeSequence: BigInt(100),
        createdAt: new Date('2026-05-20T00:00:00Z'),
        message: {
          id: 'msg-1',
          threadId: null,
          groupId: 'group-1',
          senderUserId: 'user-1',
          senderDeviceId: 'dev-1-sender',
          threadSequence: 5,
          createdAt: new Date('2026-05-20T00:00:00Z'),
        },
      },
      {
        id: 'env-2',
        messageId: 'msg-1',
        recipientUserId: 'user-2',
        recipientDeviceId: 'dev-2',
        ciphertext: 'cipher',
        status: 'PENDING',
        deliveredAt: null,
        readAt: null,
        envelopeSequence: BigInt(101),
        createdAt: new Date('2026-05-20T00:00:00Z'),
        message: {
          id: 'msg-1',
          threadId: null,
          groupId: 'group-1',
          senderUserId: 'user-1',
          senderDeviceId: 'dev-1-sender',
          threadSequence: 5,
          createdAt: new Date('2026-05-20T00:00:00Z'),
        },
      },
    ];
    prisma.messageEnvelope.findMany.mockResolvedValue(mockEnvelopes);

    const job = {
      data: {
        messageId: 'msg-1',
        groupId: 'group-1',
        senderUserId: 'user-1',
        senderDeviceId: 'dev-1-sender',
        ciphertext: 'cipher',
      },
    } as any;

    const result = await processor.process(job);
    expect(result).toEqual({ fannedOutTo: 3 }); // dev-1-sync, dev-2, dev-3

    // Verify database inserts exclude sender device
    expect(prisma.groupMember.findMany).toHaveBeenCalledWith({
      where: { groupId: 'group-1' },
      select: { userId: true },
    });
    expect(prisma.device.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ['user-1', 'user-2', 'user-3'] },
        active: true,
      },
      select: { id: true, userId: true },
    });
    expect(prisma.messageEnvelope.createMany).toHaveBeenCalledWith({
      data: [
        { messageId: 'msg-1', recipientUserId: 'user-1', recipientDeviceId: 'dev-1-sync', ciphertext: 'cipher', status: 'PENDING' },
        { messageId: 'msg-1', recipientUserId: 'user-2', recipientDeviceId: 'dev-2', ciphertext: 'cipher', status: 'PENDING' },
        { messageId: 'msg-1', recipientUserId: 'user-3', recipientDeviceId: 'dev-3', ciphertext: 'cipher', status: 'PENDING' },
      ],
      skipDuplicates: true,
    });

    // Verify emit matches the expected realtime gateway payload
    expect(events.emit).toHaveBeenCalledWith('message.created', {
      id: 'msg-1',
      threadId: null,
      groupId: 'group-1',
      senderUserId: 'user-1',
      senderDeviceId: 'dev-1-sender',
      threadSequence: 5,
      createdAt: mockEnvelopes[0].message.createdAt,
      envelopes: [
        {
          id: 'env-1',
          messageId: 'msg-1',
          recipientUserId: 'user-1',
          recipientDeviceId: 'dev-1-sync',
          ciphertext: 'cipher',
          status: 'PENDING',
          deliveredAt: null,
          readAt: null,
          envelopeSequence: '100', // Safely fanned out sequence string representation
          createdAt: mockEnvelopes[0].createdAt,
          message: {
            id: 'msg-1',
            threadId: null,
            groupId: 'group-1',
            senderUserId: 'user-1',
            senderDeviceId: 'dev-1-sender',
            threadSequence: 5,
            createdAt: mockEnvelopes[0].message.createdAt,
          },
        },
        {
          id: 'env-2',
          messageId: 'msg-1',
          recipientUserId: 'user-2',
          recipientDeviceId: 'dev-2',
          ciphertext: 'cipher',
          status: 'PENDING',
          deliveredAt: null,
          readAt: null,
          envelopeSequence: '101',
          createdAt: mockEnvelopes[1].createdAt,
          message: {
            id: 'msg-1',
            threadId: null,
            groupId: 'group-1',
            senderUserId: 'user-1',
            senderDeviceId: 'dev-1-sender',
            threadSequence: 5,
            createdAt: mockEnvelopes[1].message.createdAt,
          },
        },
      ],
    });
  });
});
