import { Test, TestingModule } from '@nestjs/testing';
import { PruneService } from './prune.service';

describe('PruneService', () => {
  let service: PruneService;
  let mockPruneQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockPruneQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PruneService,
        { provide: 'BullQueue_database-prune', useValue: mockPruneQueue },
      ],
    }).compile();

    service = module.get<PruneService>(PruneService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('triggerPrune', () => {
    it('should add a prune job to the queue', async () => {
      await service.triggerPrune();

      expect(mockPruneQueue.add).toHaveBeenCalledWith(
        'prune',
        { triggeredAt: expect.any(String) },
        { jobId: 'database-prune-singleton' },
      );
    });

    it('should propagate queue errors when Redis is unreachable', async () => {
      mockPruneQueue.add.mockRejectedValue(new Error('Redis connection refused'));

      await expect(service.triggerPrune()).rejects.toThrow('Redis connection refused');
    });
  });
});
