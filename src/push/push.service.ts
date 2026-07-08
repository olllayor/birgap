import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PushNotificationJobData } from './queue/push-notification-job.interface';

export interface PushEnvelopeTarget {
  recipientDeviceId: string;
  recipientUserId: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectQueue('push-notifications')
    private readonly pushQueue: Queue<PushNotificationJobData>,
    private readonly prisma: PrismaService,
  ) {}

  async sendMessageWakeup(envelopes: PushEnvelopeTarget[], threadId?: string | null) {
    const targets = threadId ? await this.filterMuted(threadId, envelopes) : envelopes;
    if (targets.length === 0) {
      return;
    }
    await this.pushQueue.add('send-wakeup', { type: 'new_message', envelopes: targets });
  }

  async sendEditWakeup(envelopes: PushEnvelopeTarget[], threadId?: string | null) {
    const targets = threadId ? await this.filterMuted(threadId, envelopes) : envelopes;
    if (targets.length === 0) {
      return;
    }
    await this.pushQueue.add('send-edit-wakeup', { type: 'edit', envelopes: targets });
  }

  async sendDeleteWakeup(envelopes: PushEnvelopeTarget[], threadId?: string | null) {
    const targets = threadId ? await this.filterMuted(threadId, envelopes) : envelopes;
    if (targets.length === 0) {
      return;
    }
    await this.pushQueue.add('send-delete-wakeup', { type: 'delete', envelopes: targets });
  }

  /**
   * Drops targets whose recipient has an active mute (mutedUntil in the
   * future) on the given direct thread. Fails open: if the settings lookup
   * errors, every target keeps its push — a broken filter must degrade to
   * a redundant notification, never to a lost wakeup.
   */
  private async filterMuted(
    threadId: string,
    targets: PushEnvelopeTarget[],
  ): Promise<PushEnvelopeTarget[]> {
    try {
      const recipientUserIds = Array.from(new Set(targets.map((t) => t.recipientUserId)));
      if (recipientUserIds.length === 0) {
        return targets;
      }
      const muted = await this.prisma.threadSetting.findMany({
        where: {
          threadId,
          userId: { in: recipientUserIds },
          mutedUntil: { gt: new Date() },
        },
        select: { userId: true },
      });
      if (muted.length === 0) {
        return targets;
      }
      const mutedUserIds = new Set(muted.map((m) => m.userId));
      return targets.filter((t) => !mutedUserIds.has(t.recipientUserId));
    } catch (error) {
      this.logger.warn(
        `Thread mute filter failed for thread ${threadId}, sending push unfiltered: ${error instanceof Error ? error.message : error}`,
      );
      return targets;
    }
  }
}
