import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { PruneJobData } from './prune-job.interface';
import { OtpStatus } from '@prisma/client';
import { QueueMetrics } from '../../metrics/queue.metrics';

@Processor('database-prune', { concurrency: 1 })
export class PruneProcessor extends WorkerHost {
  private readonly logger = new Logger(PruneProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<PruneJobData>): Promise<void> {
    this.logger.log('Starting daily database pruning...');
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      const tokensResult = await tx.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { revokedAt: { not: null } },
          ],
        },
      });

      const ticketsResult = await tx.socketTicket.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { consumedAt: { not: null } },
          ],
        },
      });

      const otpsResult = await tx.otp.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { status: OtpStatus.USED },
          ],
        },
      });

      const smsResult = await tx.smsReport.deleteMany({
        where: {
          createdAt: { lt: thirtyDaysAgo },
        },
      });

      this.logger.log(
        `Pruning completed successfully: ` +
          `Pruned ${tokensResult.count} refresh tokens, ` +
          `${ticketsResult.count} socket tickets, ` +
          `${otpsResult.count} OTPs, and ` +
          `${smsResult.count} SMS reports.`,
      );
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<PruneJobData>) {
    this.queueMetrics.recordCompleted('database-prune');
    this.logger.debug(`Prune job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PruneJobData>, error: Error) {
    this.queueMetrics.recordFailed('database-prune');
    this.logger.error(`Prune job ${job.id} failed: ${error.message}`);
  }
}
