import { Test, TestingModule } from '@nestjs/testing';
import { PruneService } from './prune.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PruneService', () => {
  let service: PruneService;
  let prisma: PrismaService;

  const mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    refreshToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
    },
    socketTicket: {
      deleteMany: jest.fn().mockResolvedValue({ count: 10 }),
    },
    otp: {
      deleteMany: jest.fn().mockResolvedValue({ count: 15 }),
    },
    smsReport: {
      deleteMany: jest.fn().mockResolvedValue({ count: 20 }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PruneService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PruneService>(PruneService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('pruneDatabase', () => {
    it('should call deleteMany on all target models in a transaction', async () => {
      await service.pruneDatabase();

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalled();
      expect(mockPrismaService.socketTicket.deleteMany).toHaveBeenCalled();
      expect(mockPrismaService.otp.deleteMany).toHaveBeenCalled();
      expect(mockPrismaService.smsReport.deleteMany).toHaveBeenCalled();
    });

    it('should log an error if transaction fails', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockPrismaService.$transaction.mockRejectedValueOnce(new Error('DB connection failure'));

      await service.pruneDatabase();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database pruning failed: DB connection failure'),
      );
    });
  });
});
