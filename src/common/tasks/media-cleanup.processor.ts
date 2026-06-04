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
    const reclaimableIds: string[] = [];
    for (const m of stale) {
      const mainOk = await this.tryDeleteR2Object(m.bucketKey);
      let thumbOk = true;
      if (mainOk) {
        deletedObjects++;
      }
      if (m.thumbnailBucketKey) {
        thumbOk = await this.tryDeleteR2Object(m.thumbnailBucketKey);
        if (thumbOk) {
          deletedObjects++;
        }
      }
      if (mainOk && thumbOk) {
        reclaimableIds.push(m.id);
      }
    }

    const orphaned = stale.length - reclaimableIds.length;
    if (orphaned > 0) {
      this.logger.warn(
        `Retaining ${orphaned} media row(s) because R2 deletion failed; will retry on next run`,
      );
    }

    let removedRows = 0;
    if (reclaimableIds.length > 0) {
      const result = await this.prisma.messageMedia.deleteMany({
        where: { id: { in: reclaimableIds } },
      });
      removedRows = result.count;
    }

    this.logger.log(
      `Media cleanup completed: removed ${removedRows} stale media rows and ${deletedObjects} R2 objects.`,
    );
  }

  private async tryDeleteR2Object(bucketKey: string): Promise<boolean> {
    try {
      await this.r2.deleteObject(bucketKey);
      return true;
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (name === 'NoSuchKey' || statusCode === 404) {
        return true;
      }
      this.logger.warn(
        `Failed to delete R2 object ${bucketKey}: ${(error as Error).message}`,
      );
      return false;
    }
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
