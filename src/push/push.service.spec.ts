import { PushService, PushEnvelopeTarget } from './push.service';

describe('PushService', () => {
  let service: PushService;
  let queue: { add: jest.Mock };
  let prisma: { threadSetting: { findMany: jest.Mock } };

  const targets: PushEnvelopeTarget[] = [
    { recipientDeviceId: 'dev-a1', recipientUserId: 'user-a' },
    { recipientDeviceId: 'dev-a2', recipientUserId: 'user-a' },
    { recipientDeviceId: 'dev-b1', recipientUserId: 'user-b' },
  ];

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    prisma = { threadSetting: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new PushService(queue as never, prisma as never);
  });

  describe('mute filtering', () => {
    it('skips the mute lookup when no threadId is given (group path)', async () => {
      await service.sendMessageWakeup(targets);

      expect(prisma.threadSetting.findMany).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith('send-wakeup', {
        type: 'new_message',
        envelopes: targets,
      });
    });

    it('drops every device of a muted recipient but keeps the rest', async () => {
      prisma.threadSetting.findMany.mockResolvedValue([{ userId: 'user-a' }]);

      await service.sendMessageWakeup(targets, 'thread-1');

      expect(prisma.threadSetting.findMany).toHaveBeenCalledWith({
        where: {
          threadId: 'thread-1',
          userId: { in: ['user-a', 'user-b'] },
          mutedUntil: { gt: expect.any(Date) },
        },
        select: { userId: true },
      });
      expect(queue.add).toHaveBeenCalledWith('send-wakeup', {
        type: 'new_message',
        envelopes: [{ recipientDeviceId: 'dev-b1', recipientUserId: 'user-b' }],
      });
    });

    it('skips the enqueue entirely when every recipient is muted', async () => {
      prisma.threadSetting.findMany.mockResolvedValue([
        { userId: 'user-a' },
        { userId: 'user-b' },
      ]);

      await service.sendMessageWakeup(targets, 'thread-1');

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('fails open when the mute lookup errors', async () => {
      prisma.threadSetting.findMany.mockRejectedValue(new Error('db down'));

      await service.sendEditWakeup(targets, 'thread-1');

      expect(queue.add).toHaveBeenCalledWith('send-edit-wakeup', {
        type: 'edit',
        envelopes: targets,
      });
    });

    it('does not query or enqueue when targets are empty', async () => {
      await service.sendDeleteWakeup([], 'thread-1');

      expect(prisma.threadSetting.findMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('wakeup enqueue', () => {
    it('filters edit wakeups by thread mute', async () => {
      prisma.threadSetting.findMany.mockResolvedValue([{ userId: 'user-b' }]);

      await service.sendEditWakeup(targets, 'thread-1');

      expect(queue.add).toHaveBeenCalledWith('send-edit-wakeup', {
        type: 'edit',
        envelopes: [
          { recipientDeviceId: 'dev-a1', recipientUserId: 'user-a' },
          { recipientDeviceId: 'dev-a2', recipientUserId: 'user-a' },
        ],
      });
    });

    it('filters delete wakeups by thread mute', async () => {
      prisma.threadSetting.findMany.mockResolvedValue([{ userId: 'user-b' }]);

      await service.sendDeleteWakeup(targets, 'thread-1');

      expect(queue.add).toHaveBeenCalledWith('send-delete-wakeup', {
        type: 'delete',
        envelopes: [
          { recipientDeviceId: 'dev-a1', recipientUserId: 'user-a' },
          { recipientDeviceId: 'dev-a2', recipientUserId: 'user-a' },
        ],
      });
    });
  });
});
