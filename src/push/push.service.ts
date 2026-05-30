import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PushNotificationJobData } from './queue/push-notification-job.interface';

export interface PushEnvelopeTarget {
  recipientDeviceId: string;
  recipientUserId: string;
}

@Injectable()
export class PushService {
  constructor(
    @InjectQueue('push-notifications')
    private readonly pushQueue: Queue<PushNotificationJobData>,
  ) {}

  async sendMessageWakeup(envelopes: PushEnvelopeTarget[]) {
    await this.pushQueue.add('send-wakeup', { envelopes });
  }
}
