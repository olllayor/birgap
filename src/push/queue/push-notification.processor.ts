import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as admin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmProvider } from '../fcm.provider';
import { PushNotificationJobData } from './push-notification-job.interface';
import { QueueMetrics } from '../../metrics/queue.metrics';

@Processor('push-notifications', { concurrency: 10 })
export class PushNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(PushNotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fcm: FcmProvider,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<PushNotificationJobData>): Promise<void> {
    const provider = this.config.get<string>('PUSH_PROVIDER') ?? 'logger';
    if (provider === 'fcm') {
      return this.sendFcmWakeup(job.data.envelopes);
    }
    return this.logWakeup(job.data.envelopes);
  }

  private async logWakeup(
    envelopes: PushNotificationJobData['envelopes'],
  ): Promise<void> {
    const deviceIds = [...new Set(envelopes.map((e) => e.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: { id: { in: deviceIds }, active: true, pushToken: { not: null } },
      select: { id: true, userId: true, pushPlatform: true },
    });

    for (const device of devices) {
      this.logger.log(
        `Push wakeup queued user=${device.userId} device=${device.id} platform=${device.pushPlatform ?? 'unknown'}`,
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
      where: { id: { in: deviceIds }, active: true, pushToken: { not: null } },
      select: { id: true, userId: true, pushToken: true, pushPlatform: true },
    });

    const fcmDevices = devices.filter((d) => d.pushPlatform === 'FCM' && d.pushToken);
    if (fcmDevices.length === 0) {
      return;
    }

    const tokens = fcmDevices.map((d) => d.pushToken as string);
    const message: admin.messaging.MulticastMessage = {
      data: { type: 'new_message' },
      tokens,
      android: { priority: 'high' },
      apns: {
        payload: {
          aps: { contentAvailable: true },
        },
      },
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
