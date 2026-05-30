import { Job } from 'bullmq';
import { R2Service } from '../../storage/r2.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { StorageCleanupJobData } from './storage-cleanup-job.interface';
import { StorageCleanupProcessor } from './storage-cleanup.processor';

describe('StorageCleanupProcessor', () => {
  let processor: StorageCleanupProcessor;
  let r2: R2Service;
  let queueMetrics: QueueMetrics;

  beforeEach(() => {
    r2 = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as R2Service;

    queueMetrics = {
      recordCompleted: jest.fn(),
      recordFailed: jest.fn(),
    } as unknown as QueueMetrics;

    processor = new StorageCleanupProcessor(r2, queueMetrics);
  });

  it('calls r2.deleteObject with the bucket key from job data', async () => {
    const job = {
      id: 'cleanup-1',
      data: { bucketKey: 'backups/user-1/old-key.bin' },
    } as unknown as Job<StorageCleanupJobData>;

    await processor.process(job);

    expect(r2.deleteObject).toHaveBeenCalledWith('backups/user-1/old-key.bin');
  });

  it('throws when r2.deleteObject fails', async () => {
    (r2.deleteObject as jest.Mock).mockRejectedValue(new Error('S3 error'));

    const job = {
      id: 'cleanup-2',
      data: { bucketKey: 'backups/user-1/fail.bin' },
    } as unknown as Job<StorageCleanupJobData>;

    await expect(processor.process(job)).rejects.toThrow('S3 error');
  });

  it('records completed metric on success', () => {
    const job = { id: 'cleanup-3', queueName: 'storage-cleanup' } as unknown as Job<StorageCleanupJobData>;
    processor.onCompleted(job);
    expect(queueMetrics.recordCompleted).toHaveBeenCalledWith('storage-cleanup');
  });

  it('records failed metric on failure', () => {
    const job = {
      id: 'cleanup-4',
      queueName: 'storage-cleanup',
      data: { bucketKey: 'backups/user-1/fail.bin' },
    } as unknown as Job<StorageCleanupJobData>;
    processor.onFailed(job, new Error('S3 error'));
    expect(queueMetrics.recordFailed).toHaveBeenCalledWith('storage-cleanup');
  });
});
