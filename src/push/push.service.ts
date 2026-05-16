import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { FcmProvider } from './fcm.provider';

interface PushEnvelopeTarget {
  recipientDeviceId: string;
  recipientUserId: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fcm: FcmProvider,
  ) {}

  async sendMessageWakeup(envelopes: PushEnvelopeTarget[]) {
    const provider = this.config.get<string>('PUSH_PROVIDER');
    if (provider === 'logger') {
      return this.logWakeup(envelopes);
    }

    if (provider === 'fcm') {
      return this.sendFcmWakeup(envelopes);
    }
  }

  private async logWakeup(envelopes: PushEnvelopeTarget[]) {
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

  private async sendFcmWakeup(envelopes: PushEnvelopeTarget[]) {
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
}
