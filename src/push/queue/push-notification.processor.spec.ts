import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { FcmProvider } from '../fcm.provider';
import { PushNotificationJobData } from './push-notification-job.interface';
import { PushNotificationProcessor } from './push-notification.processor';
import { QueueMetrics } from '../../metrics/queue.metrics';

describe('PushNotificationProcessor', () => {
  let processor: PushNotificationProcessor;
  let prisma: PrismaService;
  let config: ConfigService;
  let fcm: FcmProvider;
  let queueMetrics: QueueMetrics;
  let redis: RedisService;

  beforeEach(() => {
    prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    config = {
      get: jest.fn().mockReturnValue('logger'),
    } as unknown as ConfigService;

    fcm = {
      isReady: jest.fn().mockReturnValue(false),
      getMessaging: jest.fn(),
    } as unknown as FcmProvider;

    queueMetrics = {
      recordCompleted: jest.fn(),
      recordFailed: jest.fn(),
    } as unknown as QueueMetrics;

    redis = {
      getDevicesWithSockets: jest.fn().mockResolvedValue(new Set<string>()),
    } as unknown as RedisService;

    processor = new PushNotificationProcessor(prisma, config, fcm, queueMetrics, redis);
  });

  it('logs wakeup in logger mode', async () => {
    (config.get as jest.Mock).mockReturnValue('logger');
    (prisma.device.findMany as jest.Mock).mockResolvedValue([
      { id: 'dev-1', userId: 'user-1', pushPlatform: 'FCM' },
    ]);

    const job = {
      id: 'job-1',
      data: {
        envelopes: [
          { recipientDeviceId: 'dev-1', recipientUserId: 'user-1' },
        ],
      },
    } as unknown as Job<PushNotificationJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(prisma.device.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['dev-1'] }, active: true, pushToken: { not: null } },
      select: { id: true, userId: true, pushPlatform: true },
    });
  });

  it('falls back to logger when FCM is not ready', async () => {
    (config.get as jest.Mock).mockReturnValue('fcm');
    (fcm.isReady as jest.Mock).mockReturnValue(false);
    (prisma.device.findMany as jest.Mock).mockResolvedValue([
      { id: 'dev-1', userId: 'user-1', pushPlatform: 'FCM' },
    ]);

    const job = {
      id: 'job-2',
      data: {
        envelopes: [
          { recipientDeviceId: 'dev-1', recipientUserId: 'user-1' },
        ],
      },
    } as unknown as Job<PushNotificationJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(fcm.getMessaging).not.toHaveBeenCalled();
  });

  it('sends FCM multicast and clears stale tokens on partial failure', async () => {
    (config.get as jest.Mock).mockReturnValue('fcm');
    (fcm.isReady as jest.Mock).mockReturnValue(true);
    (redis.getDevicesWithSockets as jest.Mock).mockResolvedValue(new Set<string>());

    (prisma.device.findMany as jest.Mock).mockResolvedValue([
      { id: 'dev-1', userId: 'user-1', pushToken: 'token-1', pushPlatform: 'FCM' },
      { id: 'dev-2', userId: 'user-2', pushToken: 'token-2', pushPlatform: 'FCM' },
    ]);

    const mockSendEachForMulticast = jest.fn().mockResolvedValue({
      failureCount: 1,
      responses: [
        { success: true },
        {
          success: false,
          error: {
            code: 'messaging/registration-token-not-registered',
            message: 'Token expired',
          },
        },
      ],
    });

    (fcm.getMessaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });

    const job = {
      id: 'job-3',
      data: {
        envelopes: [
          { recipientDeviceId: 'dev-1', recipientUserId: 'user-1' },
          { recipientDeviceId: 'dev-2', recipientUserId: 'user-2' },
        ],
      },
    } as unknown as Job<PushNotificationJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(prisma.device.updateMany).toHaveBeenCalledWith({
      where: { pushToken: { in: ['token-2'] } },
      data: { pushToken: null, pushPlatform: null, pushActive: false },
    });
  });

  it('skips FCM send when no FCM devices found', async () => {
    (config.get as jest.Mock).mockReturnValue('fcm');
    (fcm.isReady as jest.Mock).mockReturnValue(true);
    (prisma.device.findMany as jest.Mock).mockResolvedValue([
      { id: 'dev-1', userId: 'user-1', pushToken: null, pushPlatform: null },
    ]);

    const job = {
      id: 'job-4',
      data: {
        envelopes: [
          { recipientDeviceId: 'dev-1', recipientUserId: 'user-1' },
        ],
      },
    } as unknown as Job<PushNotificationJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(fcm.getMessaging).not.toHaveBeenCalled();
  });

  it('sends FCM with apns-push-type background for new-message wakeup', async () => {
    (config.get as jest.Mock).mockReturnValue('fcm');
    (fcm.isReady as jest.Mock).mockReturnValue(true);
    (redis.getDevicesWithSockets as jest.Mock).mockResolvedValue(new Set<string>());

    (prisma.device.findMany as jest.Mock).mockResolvedValue([
      { id: 'dev-1', userId: 'user-1', pushToken: 'token-1', pushPlatform: 'FCM' },
    ]);

    const mockSendEachForMulticast = jest.fn().mockResolvedValue({
      failureCount: 0,
      responses: [{ success: true }],
    });
    (fcm.getMessaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });

    const job = {
      id: 'job-5',
      data: {
        type: 'new_message',
        envelopes: [{ recipientDeviceId: 'dev-1', recipientUserId: 'user-1' }],
      },
    } as unknown as Job<PushNotificationJobData>;

    await processor.process(job);

    const [message] = mockSendEachForMulticast.mock.calls[0] as [
      { apns: { headers: Record<string, string> } },
    ];
    expect(message.apns.headers['apns-push-type']).toBe('background');
    expect(message.apns.headers['apns-priority']).toBe('5');
  });

  it('skips FCM send for devices that are online', async () => {
    (config.get as jest.Mock).mockReturnValue('fcm');
    (fcm.isReady as jest.Mock).mockReturnValue(true);
    (redis.getDevicesWithSockets as jest.Mock).mockResolvedValue(new Set(['dev-1']));

    (prisma.device.findMany as jest.Mock).mockResolvedValue([
      { id: 'dev-1', userId: 'user-1', pushToken: 'token-1', pushPlatform: 'FCM' },
      { id: 'dev-2', userId: 'user-2', pushToken: 'token-2', pushPlatform: 'FCM' },
    ]);

    const mockSendEachForMulticast = jest.fn().mockResolvedValue({
      failureCount: 0,
      responses: [{ success: true }],
    });
    (fcm.getMessaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });

    const job = {
      id: 'job-6',
      data: {
        type: 'new_message',
        envelopes: [
          { recipientDeviceId: 'dev-1', recipientUserId: 'user-1' },
          { recipientDeviceId: 'dev-2', recipientUserId: 'user-2' },
        ],
      },
    } as unknown as Job<PushNotificationJobData>;

    await processor.process(job);

    const [message] = mockSendEachForMulticast.mock.calls[0] as [
      { tokens: string[] },
    ];
    expect(message.tokens).toEqual(['token-2']);
  });

  it('skips all pushes when Redis presence check rejects', async () => {
    (config.get as jest.Mock).mockReturnValue('fcm');
    (fcm.isReady as jest.Mock).mockReturnValue(true);
    (redis.getDevicesWithSockets as jest.Mock).mockRejectedValue(new Error('redis down'));

    (prisma.device.findMany as jest.Mock).mockResolvedValue([
      { id: 'dev-1', userId: 'user-1', pushToken: 'token-1', pushPlatform: 'FCM' },
    ]);

    const mockSendEachForMulticast = jest.fn();
    (fcm.getMessaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });

    const job = {
      id: 'job-7',
      data: {
        type: 'new_message',
        envelopes: [{ recipientDeviceId: 'dev-1', recipientUserId: 'user-1' }],
      },
    } as unknown as Job<PushNotificationJobData>;

    await processor.process(job);

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});
