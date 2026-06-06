import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { PruneJobData } from './prune-job.interface';
import { PruneProcessor } from './prune.processor';

describe('PruneProcessor', () => {
  let processor: PruneProcessor;
  let prisma: PrismaService;
  let queueMetrics: QueueMetrics;
  let config: ConfigService;

  const mockTx = {
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
    socketTicket: { deleteMany: jest.fn().mockResolvedValue({ count: 10 }) },
    otp: { deleteMany: jest.fn().mockResolvedValue({ count: 15 }) },
    smsReport: { deleteMany: jest.fn().mockResolvedValue({ count: 20 }) },
    report: { deleteMany: jest.fn().mockResolvedValue({ count: 7 }) },
    dailyMetric: { deleteMany: jest.fn().mockResolvedValue({ count: 30 }) },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    } as unknown as PrismaService;

    queueMetrics = {
      recordCompleted: jest.fn(),
      recordFailed: jest.fn(),
    } as unknown as QueueMetrics;

    config = {
      get: jest.fn().mockImplementation((key: string, defaultValue: unknown) => defaultValue),
    } as unknown as ConfigService;

    processor = new PruneProcessor(prisma, queueMetrics, config);
  });

  it('deletes expired tokens, tickets, OTPs, SMS reports, old reports, and old daily metrics in a transaction', async () => {
    const job = {
      id: 'prune-1',
      data: { triggeredAt: new Date().toISOString() },
    } as unknown as Job<PruneJobData>;

    await processor.process(job);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.refreshToken.deleteMany).toHaveBeenCalled();
    expect(mockTx.socketTicket.deleteMany).toHaveBeenCalled();
    expect(mockTx.otp.deleteMany).toHaveBeenCalled();
    expect(mockTx.smsReport.deleteMany).toHaveBeenCalled();
    expect(mockTx.report.deleteMany).toHaveBeenCalled();
    expect(mockTx.dailyMetric.deleteMany).toHaveBeenCalled();
  });

  it('uses REPORT_RETENTION_DAYS and DAILY_METRICS_RETENTION_DAYS from config', async () => {
    config = {
      get: jest.fn().mockImplementation((key: string, defaultValue: unknown) => {
        if (key === 'REPORT_RETENTION_DAYS') return 90;
        if (key === 'DAILY_METRICS_RETENTION_DAYS') return 180;
        return defaultValue;
      }),
    } as unknown as ConfigService;
    processor = new PruneProcessor(prisma, queueMetrics, config);

    const job = {
      id: 'prune-1',
      data: { triggeredAt: new Date().toISOString() },
    } as unknown as Job<PruneJobData>;

    await processor.process(job);

    expect(config.get).toHaveBeenCalledWith('REPORT_RETENTION_DAYS', 365);
    expect(config.get).toHaveBeenCalledWith('DAILY_METRICS_RETENTION_DAYS', 365);
  });

  it('records completed metric on success', () => {
    const job = { id: 'prune-2', queueName: 'database-prune' } as unknown as Job<PruneJobData>;
    processor.onCompleted(job);
    expect(queueMetrics.recordCompleted).toHaveBeenCalledWith('database-prune');
  });

  it('records failed metric on failure', () => {
    const job = { id: 'prune-3', queueName: 'database-prune' } as unknown as Job<PruneJobData>;
    processor.onFailed(job, new Error('DB down'));
    expect(queueMetrics.recordFailed).toHaveBeenCalledWith('database-prune');
  });
});
