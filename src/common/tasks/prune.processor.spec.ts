import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { PruneJobData } from './prune-job.interface';
import { PruneProcessor } from './prune.processor';

describe('PruneProcessor', () => {
  let processor: PruneProcessor;
  let prisma: PrismaService;
  let queueMetrics: QueueMetrics;

  const mockTx = {
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
    socketTicket: { deleteMany: jest.fn().mockResolvedValue({ count: 10 }) },
    otp: { deleteMany: jest.fn().mockResolvedValue({ count: 15 }) },
    smsReport: { deleteMany: jest.fn().mockResolvedValue({ count: 20 }) },
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

    processor = new PruneProcessor(prisma, queueMetrics);
  });

  it('deletes expired tokens, tickets, OTPs, and old SMS reports in a transaction', async () => {
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
