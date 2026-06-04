import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { PushService } from '../../push/push.service';

export interface GroupEditFanoutJobData {
  messageId: string;
  groupId: string;
  senderUserId: string;
  senderDeviceId: string;
  ciphertext: unknown;
  editedAt: string;
}

@Processor('group-edit-fanout', { concurrency: 5 })
export class GroupEditFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupEditFanoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly queueMetrics: QueueMetrics,
    private readonly push: PushService,
  ) {
    super();
  }

  async process(job: Job<GroupEditFanoutJobData>): Promise<{ updatedCount: number }> {
    const { messageId, groupId, senderUserId, senderDeviceId, ciphertext, editedAt } = job.data;

    // 1. Fetch all active devices for group members in a single query
    const activeDevices = await this.prisma.device.findMany({
      where: {
        user: {
          groupMembers: { some: { groupId } },
        },
        active: true,
      },
      select: { id: true, userId: true },
    });

    // 2. Exclude the sender's current device
    const targetDevices = activeDevices.filter((device) => device.id !== senderDeviceId);

    if (targetDevices.length === 0) {
      return { updatedCount: 0 };
    }

    // 3. Batch-update existing MessageEnvelope records in chunks to avoid param limits
    const deviceIds = targetDevices.map((d) => d.id);
    const chunkSize = 100;
    let updatedCount = 0;

    for (let i = 0; i < deviceIds.length; i += chunkSize) {
      const chunk = deviceIds.slice(i, i + chunkSize);
      const result = await this.prisma.messageEnvelope.updateMany({
        where: {
          messageId,
          recipientDeviceId: { in: chunk },
        },
        data: {
          ciphertext: ciphertext as Prisma.InputJsonValue,
          envelopeVersion: { increment: 1 },
        },
      });
      updatedCount += result.count;
    }

    // 4. Construct event payload with minimal envelope metadata
    const eventPayload = {
      id: messageId,
      threadId: null,
      groupId,
      senderUserId,
      senderDeviceId,
      editedAt,
      envelopes: targetDevices.map((device) => ({
        messageId,
        recipientUserId: device.userId,
        recipientDeviceId: device.id,
        ciphertext,
        status: 'PENDING' as const,
        deliveredAt: null,
        readAt: null,
        createdAt: editedAt,
        message: {
          id: messageId,
          threadId: null,
          groupId,
          senderUserId,
          senderDeviceId,
          editedAt,
        },
      })),
    };

    // 5. Emit event to trigger realtime Socket.IO broadcasts
    this.events.emit('message.edited.group', eventPayload);

    // 6. Silent push wakeup for offline clients
    const pushTargets = targetDevices
      .filter((d) => d.userId !== senderUserId)
      .map((d) => ({
        recipientDeviceId: d.id,
        recipientUserId: d.userId,
      }));

    if (pushTargets.length > 0) {
      this.push.sendEditWakeup(pushTargets).catch((error) => {
        this.logger.warn(
          `Failed to enqueue edit push wakeup: ${error instanceof Error ? error.message : error}`,
        );
      });
    }

    return { updatedCount };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<GroupEditFanoutJobData>) {
    this.queueMetrics.recordCompleted('group-edit-fanout');
    this.logger.debug(`Group edit fanout job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GroupEditFanoutJobData>, error: Error) {
    this.queueMetrics.recordFailed('group-edit-fanout');
    this.logger.error(`Group edit fanout job ${job.id} failed: ${error.message}`);
  }
}
