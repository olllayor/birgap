import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { UnreadRecalcJobData } from './unread-recalc-job.interface';

@Processor('unread-recalc', { concurrency: 5 })
export class UnreadRecalcProcessor extends WorkerHost {
  private readonly logger = new Logger(UnreadRecalcProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<UnreadRecalcJobData>): Promise<void> {
    const { userId, threadId, threadType } = job.data;

    const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT e."messageId") as count
      FROM "MessageEnvelope" e
      JOIN "Message" m ON e."messageId" = m.id
      WHERE e."recipientUserId" = ${userId}::uuid
        AND m."senderUserId" != ${userId}::uuid
        AND ${
          threadType === 'direct'
            ? Prisma.sql`m."threadId" = ${threadId}::uuid`
            : Prisma.sql`m."groupId" = ${threadId}::uuid`
        }
        AND e.status != 'READ'
    `;

    const count = Number(result[0].count);

    await this.prisma.unreadCounter.upsert({
      where: {
        userId_threadType_threadId: { userId, threadType, threadId },
      },
      update: { count },
      create: { userId, threadType, threadId, count },
    });

    this.events.emit('unread.updated', { userId, threadId, threadType, count });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<UnreadRecalcJobData>) {
    this.queueMetrics.recordCompleted('unread-recalc');
    this.logger.debug(`Unread recalc job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<UnreadRecalcJobData>, error: Error) {
    this.queueMetrics.recordFailed('unread-recalc');
    this.logger.error(`Unread recalc job ${job.id} failed: ${error.message}`);
  }
}
