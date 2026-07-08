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

    // Recompute and persist in a single statement. The previous version did a
    // separate COUNT then upsert: a recalc that snapshotted N unread rows before
    // a concurrent markAllRead committed could then write N over the 0, leaving
    // the counter stuck non-zero. Folding the COUNT subquery into the INSERT means
    // it is evaluated against committed state at statement execution, closing that
    // read-then-write gap.
    const threadPredicate =
      threadType === 'direct'
        ? Prisma.sql`m."threadId" = ${threadId}::uuid`
        : Prisma.sql`m."groupId" = ${threadId}::uuid`;

    const result = await this.prisma.$queryRaw<[{ count: number }]>`
      INSERT INTO "UnreadCounter" ("userId", "threadType", "threadId", "count", "updatedAt")
      VALUES (
        ${userId}::uuid,
        ${threadType},
        ${threadId}::uuid,
        (
          SELECT COUNT(DISTINCT e."messageId")
          FROM "MessageEnvelope" e
          JOIN "Message" m ON e."messageId" = m.id
          WHERE e."recipientUserId" = ${userId}::uuid
            AND m."senderUserId" != ${userId}::uuid
            AND ${threadPredicate}
            AND e.status != 'READ'
        ),
        now()
      )
      ON CONFLICT ("userId", "threadType", "threadId")
      DO UPDATE SET "count" = EXCLUDED."count", "updatedAt" = now()
      RETURNING "count"
    `;

    const count = Number(result[0].count);

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
