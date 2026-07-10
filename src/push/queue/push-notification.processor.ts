import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as admin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { FcmProvider } from '../fcm.provider';
import { PushNotificationJobData } from './push-notification-job.interface';
import { QueueMetrics } from '../../metrics/queue.metrics';

const SILENT_APNS = {
  payload: { aps: { contentAvailable: true } },
  headers: { 'apns-push-type': 'background' as const, 'apns-priority': '5' },
};

@Processor('push-notifications', { concurrency: 10 })
export class PushNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(PushNotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fcm: FcmProvider,
    private readonly queueMetrics: QueueMetrics,
    private readonly redis: RedisService,
  ) {
    super();
  }

  async process(job: Job<PushNotificationJobData>): Promise<void> {
    const provider = this.config.get<string>('PUSH_PROVIDER') ?? 'logger';
    const { type, envelopes, call } = job.data;

    if (type === 'incoming_call' || type === 'missed_call') {
      if (provider === 'fcm') {
        return this.sendCallFcmWakeup(envelopes, type, call);
      }
      return this.logCallWakeup(envelopes, type);
    }

    if (provider === 'fcm') {
      if (type === 'edit' || type === 'delete') {
        return this.sendSilentFcmWakeup(envelopes, type);
      }
      return this.sendFcmWakeup(envelopes);
    }

    if (type === 'edit' || type === 'delete') {
      return this.logSilentWakeup(envelopes, type);
    }
    return this.logWakeup(envelopes);
  }

  private async logCallWakeup(
    envelopes: PushNotificationJobData['envelopes'],
    type: 'incoming_call' | 'missed_call',
  ): Promise<void> {
    const deviceIds = [...new Set(envelopes.map((e) => e.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: deviceIds },
        active: true,
        pushToken: { not: null },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, pushPlatform: true },
    });
    for (const device of devices) {
      this.logger.log(
        `Call push (${type}) queued user=${device.userId} device=${device.id} platform=${device.pushPlatform ?? 'unknown'}`,
      );
    }
  }

  private async sendCallFcmWakeup(
    envelopes: PushNotificationJobData['envelopes'],
    type: 'incoming_call' | 'missed_call',
    call: PushNotificationJobData['call'],
  ): Promise<void> {
    if (!this.fcm.isReady()) {
      this.logger.warn('FCM provider is not initialized; falling back to logger');
      return this.logCallWakeup(envelopes, type);
    }

    const deviceIds = [...new Set(envelopes.map((e) => e.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: deviceIds },
        active: true,
        pushToken: { not: null },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, pushToken: true, pushPlatform: true },
    });

    const candidates = devices.filter((d) => d.pushPlatform === 'FCM' && d.pushToken);
    if (candidates.length === 0) {
      return;
    }

    // Devices with a live socket already got the gateway event; only wake the rest.
    const fcmDevices = await this.filterOnlineDevices(candidates);
    if (fcmDevices.length === 0) {
      return;
    }

    const tokens = fcmDevices.map((d) => d.pushToken as string);
    const message: admin.messaging.MulticastMessage = {
      data: {
        type,
        callId: call?.callId ?? '',
        callerUserId: call?.callerUserId ?? '',
        callType: call?.callType ?? '',
      },
      tokens,
      android: { priority: 'high' },
      // 'background' keeps the push silent at the OS level; the app renders the
      // ring UI / missed-call notification itself from the data payload.
      apns: SILENT_APNS,
    };

    const response = await this.fcm.getMessaging().sendEachForMulticast(message);

    if (response.failureCount > 0) {
      const staleTokens: string[] = [];
      response.responses.forEach((res, index) => {
        if (!res.success && res.error) {
          this.logger.warn(
            `Call FCM send failed for device=${fcmDevices[index].id}: ${res.error.code} ${res.error.message}`,
          );
          if (
            res.error.code === 'messaging/registration-token-not-registered' ||
            res.error.code === 'messaging/invalid-registration-token'
          ) {
            staleTokens.push(tokens[index]);
          }
        }
      });
      if (staleTokens.length > 0) {
        await this.prisma.device.updateMany({
          where: { pushToken: { in: staleTokens } },
          data: { pushToken: null, pushPlatform: null, pushActive: false },
        });
        this.logger.log(`Cleared ${staleTokens.length} stale FCM tokens`);
      }
    }
  }

  private async logWakeup(
    envelopes: PushNotificationJobData['envelopes'],
  ): Promise<void> {
    const deviceIds = [...new Set(envelopes.map((e) => e.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: deviceIds },
        active: true,
        pushToken: { not: null },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, pushPlatform: true },
    });

    for (const device of devices) {
      this.logger.log(
        `Push wakeup queued user=${device.userId} device=${device.id} platform=${device.pushPlatform ?? 'unknown'}`,
      );
    }
  }

  private async logSilentWakeup(
    envelopes: PushNotificationJobData['envelopes'],
    type: 'edit' | 'delete',
  ): Promise<void> {
    const deviceIds = [...new Set(envelopes.map((e) => e.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: deviceIds },
        active: true,
        pushToken: { not: null },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, pushPlatform: true },
    });

    for (const device of devices) {
      this.logger.log(
        `Silent ${type} push queued user=${device.userId} device=${device.id} platform=${device.pushPlatform ?? 'unknown'}`,
      );
    }
  }

  private async sendFcmWakeup(
    envelopes: PushNotificationJobData['envelopes'],
  ): Promise<void> {
    if (!this.fcm.isReady()) {
      this.logger.warn('FCM provider is not initialized; falling back to logger');
      return this.logWakeup(envelopes);
    }

    const deviceIds = [...new Set(envelopes.map((e) => e.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: deviceIds },
        active: true,
        pushToken: { not: null },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, pushToken: true, pushPlatform: true },
    });

    const candidates = devices.filter((d) => d.pushPlatform === 'FCM' && d.pushToken);
    if (candidates.length === 0) {
      return;
    }

    const fcmDevices = await this.filterOnlineDevices(candidates);
    if (fcmDevices.length === 0) {
      return;
    }

    const tokens = fcmDevices.map((d) => d.pushToken as string);
    const message: admin.messaging.MulticastMessage = {
      data: { type: 'new_message' },
      tokens,
      android: { priority: 'high' },
      apns: SILENT_APNS,
    };

    const response = await this.fcm.getMessaging().sendEachForMulticast(message);

    if (response.failureCount > 0) {
      const staleTokens: string[] = [];

      response.responses.forEach((res, index) => {
        if (!res.success && res.error) {
          const error = res.error;
          this.logger.warn(
            `FCM send failed for device=${fcmDevices[index].id}: ${error.code} ${error.message}`,
          );

          if (
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token'
          ) {
            staleTokens.push(tokens[index]);
          }
        }
      });

      if (staleTokens.length > 0) {
        await this.prisma.device.updateMany({
          where: { pushToken: { in: staleTokens } },
          data: { pushToken: null, pushPlatform: null, pushActive: false },
        });
        this.logger.log(`Cleared ${staleTokens.length} stale FCM tokens`);
      }
    }
  }

  private async sendSilentFcmWakeup(
    envelopes: PushNotificationJobData['envelopes'],
    type: 'edit' | 'delete',
  ): Promise<void> {
    if (!this.fcm.isReady()) {
      this.logger.warn('FCM provider is not initialized; falling back to logger');
      return this.logSilentWakeup(envelopes, type);
    }

    const deviceIds = [...new Set(envelopes.map((e) => e.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: deviceIds },
        active: true,
        pushToken: { not: null },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, pushToken: true, pushPlatform: true },
    });

    const candidates = devices.filter((d) => d.pushPlatform === 'FCM' && d.pushToken);
    if (candidates.length === 0) {
      return;
    }

    const fcmDevices = await this.filterOnlineDevices(candidates);
    if (fcmDevices.length === 0) {
      return;
    }

    const tokens = fcmDevices.map((d) => d.pushToken as string);
    const message: admin.messaging.MulticastMessage = {
      data: { type: `message_${type}` },
      tokens,
      android: { priority: 'high' },
      apns: SILENT_APNS,
    };

    const response = await this.fcm.getMessaging().sendEachForMulticast(message);

    if (response.failureCount > 0) {
      const staleTokens: string[] = [];

      response.responses.forEach((res, index) => {
        if (!res.success && res.error) {
          const error = res.error;
          this.logger.warn(
            `Silent FCM send failed for device=${fcmDevices[index].id}: ${error.code} ${error.message}`,
          );

          if (
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token'
          ) {
            staleTokens.push(tokens[index]);
          }
        }
      });

      if (staleTokens.length > 0) {
        await this.prisma.device.updateMany({
          where: { pushToken: { in: staleTokens } },
          data: { pushToken: null, pushPlatform: null, pushActive: false },
        });
        this.logger.log(`Cleared ${staleTokens.length} stale FCM tokens`);
      }
    }
  }

  private async filterOnlineDevices<
    T extends { id: string; pushToken: string | null; pushPlatform: string | null },
  >(devices: T[]): Promise<T[]> {
    if (devices.length === 0) {
      return [];
    }
    // P0 tradeoff: if the Redis presence check fails, return an empty list
    // (assume online, skip push). This trades push availability for cost
    // correctness during Redis outages. Revisit in P1 with a fail-open flag.
    try {
      const online = await this.redis.getDevicesWithSockets(devices.map((d) => d.id));
      return devices.filter((d) => !online.has(d.id));
    } catch (error) {
      this.logger.warn(
        `Redis presence check failed; skipping all pushes for this job: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<PushNotificationJobData>) {
    this.queueMetrics.recordCompleted('push-notifications');
    this.logger.debug(`Push job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PushNotificationJobData>, error: Error) {
    this.queueMetrics.recordFailed('push-notifications');
    this.logger.error(`Push job ${job.id} failed: ${error.message}`);
  }
}
