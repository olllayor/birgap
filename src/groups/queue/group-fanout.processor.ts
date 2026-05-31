import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { UnreadService } from '../../unread/unread.service';

export interface GroupFanoutJobData {
  messageId: string;
  groupId: string;
  senderUserId: string;
  senderDeviceId: string;
  ciphertext: unknown;
  threadSequence: number;
  createdAt: string;
}

@Processor('group-fanout', { concurrency: 5 })
export class GroupFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupFanoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly queueMetrics: QueueMetrics,
    private readonly unreadService: UnreadService,
  ) {
    super();
  }

  async process(job: Job<GroupFanoutJobData>): Promise<{ fannedOutTo: number }> {
    const { messageId, groupId, senderUserId, senderDeviceId, ciphertext, threadSequence, createdAt } = job.data;

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

    // 2. Exclude the sender's current device to prevent reflecting the message back to the sending client
    const targetDevices = activeDevices.filter((device) => device.id !== senderDeviceId);

    if (targetDevices.length === 0) {
      return { fannedOutTo: 0 };
    }

    // 3. Batch-insert MessageEnvelope records (fire-and-forget — no need to return rows)
    await this.prisma.messageEnvelope.createMany({
      data: targetDevices.map((device) => ({
        messageId,
        recipientUserId: device.userId,
        recipientDeviceId: device.id,
        ciphertext: ciphertext as Prisma.InputJsonValue,
        status: 'PENDING' as const,
      })),
      skipDuplicates: true,
    });

    // 4. Construct message.created event payload from in-memory data (no DB round-trip)
    const messageEventPayload = {
      id: messageId,
      threadId: null,
      groupId,
      senderUserId,
      senderDeviceId,
      threadSequence,
      createdAt,
      envelopes: targetDevices.map((device) => ({
        messageId,
        recipientUserId: device.userId,
        recipientDeviceId: device.id,
        ciphertext,
        status: 'PENDING' as const,
        deliveredAt: null,
        readAt: null,
        createdAt,
        message: {
          id: messageId,
          threadId: null,
          groupId,
          senderUserId,
          senderDeviceId,
          threadSequence,
          createdAt,
        },
      })),
    };

    // 5. Emit event to trigger realtime Socket.IO broadcasts and push notification wakeups
    this.events.emit('message.created', messageEventPayload);

    // 6. Enqueue unread counter recalc for each unique recipient (excluding sender)
    const recipientUserIds = [
      ...new Set(targetDevices.map((d) => d.userId).filter((uid) => uid !== senderUserId)),
    ];
    await Promise.all(
      recipientUserIds.map((uid) =>
        this.unreadService.enqueueRecalc({
          userId: uid,
          threadId: groupId,
          threadType: 'group',
          reason: 'new_message',
        }),
      ),
    );

    return { fannedOutTo: targetDevices.length };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<GroupFanoutJobData>) {
    this.queueMetrics.recordCompleted('group-fanout');
    this.logger.debug(`Fanout job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GroupFanoutJobData>, error: Error) {
    this.queueMetrics.recordFailed('group-fanout');
    this.logger.error(`Fanout job ${job.id} failed: ${error.message}`);
  }
}
