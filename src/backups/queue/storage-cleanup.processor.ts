import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { R2Service } from '../../storage/r2.service';
import { StorageCleanupJobData } from './storage-cleanup-job.interface';
import { QueueMetrics } from '../../metrics/queue.metrics';

@Processor('storage-cleanup', { concurrency: 3 })
export class StorageCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(StorageCleanupProcessor.name);

  constructor(
    private readonly r2: R2Service,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<StorageCleanupJobData>): Promise<void> {
    const { bucketKey } = job.data;
    this.logger.log(`Deleting old backup object: ${bucketKey}`);
    try {
      await this.r2.deleteObject(bucketKey);
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : '';
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === 'NoSuchKey' || statusCode === 404) {
        this.logger.warn(`Object already deleted: ${bucketKey}`);
        return;
      }
      throw error;
    }
    this.logger.log(`Successfully deleted: ${bucketKey}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<StorageCleanupJobData>) {
    this.queueMetrics.recordCompleted('storage-cleanup');
    this.logger.debug(`Cleanup job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<StorageCleanupJobData> | undefined, error: Error) {
    this.queueMetrics.recordFailed('storage-cleanup');
    const jobId = job?.id ?? 'unknown';
    const bucketKey = job?.data?.bucketKey ?? 'unknown';
    this.logger.error(`Cleanup job ${jobId} failed for ${bucketKey}: ${error.message}`);
  }
}
