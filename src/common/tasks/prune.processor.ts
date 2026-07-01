import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(_job: Job<PruneJobData>): Promise<void> {
    this.logger.log('Starting daily database pruning...');
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const reportRetentionDays = this.config.get<number>('REPORT_RETENTION_DAYS', 365);
    const metricsRetentionDays = this.config.get<number>('DAILY_METRICS_RETENTION_DAYS', 365);
    const reportCutoff = new Date(Date.now() - reportRetentionDays * 24 * 60 * 60 * 1000);
    const metricsCutoff = new Date(Date.now() - metricsRetentionDays * 24 * 60 * 60 * 1000);

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

      const reportsResult = await tx.report.deleteMany({
        where: {
          createdAt: { lt: reportCutoff },
        },
      });

      const metricsResult = await tx.dailyMetric.deleteMany({
        where: {
          date: { lt: metricsCutoff },
        },
      });

      this.logger.log(
        `Pruning completed successfully: ` +
          `Pruned ${tokensResult.count} refresh tokens, ` +
          `${ticketsResult.count} socket tickets, ` +
          `${otpsResult.count} OTPs, ` +
          `${smsResult.count} SMS reports, ` +
          `${reportsResult.count} reports (>${reportRetentionDays}d), and ` +
          `${metricsResult.count} daily metrics (>${metricsRetentionDays}d). ` +
          `Note: AdminAuditLog is NEVER pruned.`,
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
