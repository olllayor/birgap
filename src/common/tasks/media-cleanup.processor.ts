import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../../storage/r2.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { MediaCleanupJobData } from './media-cleanup-job.interface';

@Processor('media-cleanup', { concurrency: 1 })
export class MediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaCleanupProcessor.name);
  private readonly pendingTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly queueMetrics: QueueMetrics,
    config: ConfigService,
  ) {
    super();
    const hours = config.get<number>('MEDIA_PENDING_TIMEOUT_HOURS') ?? 24;
    this.pendingTimeoutMs = hours * 60 * 60 * 1000;
  }

  async process(job: Job<MediaCleanupJobData>): Promise<void> {
    this.logger.log('Starting media orphan cleanup...');
    const cutoff = new Date(Date.now() - this.pendingTimeoutMs);

    const stale = await this.prisma.messageMedia.findMany({
      where: {
        uploadStatus: 'PENDING',
        createdAt: { lt: cutoff },
      },
      select: { id: true, bucketKey: true, thumbnailBucketKey: true },
    });

    if (stale.length === 0) {
      this.logger.log('No stale pending media found');
      return;
    }

    let deletedObjects = 0;
    for (const m of stale) {
      await this.r2.deleteObject(m.bucketKey).catch((error) => {
        this.logger.warn(
          `Failed to delete R2 object ${m.bucketKey}: ${(error as Error).message}`,
        );
      });
      deletedObjects++;
      if (m.thumbnailBucketKey) {
        await this.r2.deleteObject(m.thumbnailBucketKey).catch((error) => {
          this.logger.warn(
            `Failed to delete R2 thumbnail ${m.thumbnailBucketKey}: ${(error as Error).message}`,
          );
        });
        deletedObjects++;
      }
    }

    const result = await this.prisma.messageMedia.deleteMany({
      where: { id: { in: stale.map((m) => m.id) } },
    });

    this.logger.log(
      `Media cleanup completed: removed ${result.count} stale media rows and ${deletedObjects} R2 objects.`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<MediaCleanupJobData>) {
    this.queueMetrics.recordCompleted('media-cleanup');
    this.logger.debug(`Media cleanup job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MediaCleanupJobData>, error: Error) {
    this.queueMetrics.recordFailed('media-cleanup');
    this.logger.error(`Media cleanup job ${job.id} failed: ${error.message}`);
  }
}
