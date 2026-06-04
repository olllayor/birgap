import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpStatus } from '@prisma/client';

describe('OtpService', () => {
  let service: OtpService;
  let mockSmsQueue: { add: jest.Mock };

  let mockActiveOtp: unknown = null;
  let mockAttemptsSum = 0;

  const mockOtpModel = {
    findFirst: jest.fn().mockImplementation(() => mockActiveOtp),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn().mockImplementation(() =>
      Promise.resolve({ _sum: { attempts: mockAttemptsSum } }),
    ),
  };

  beforeEach(async () => {
    mockActiveOtp = null;
    mockAttemptsSum = 0;
    mockOtpModel.findFirst.mockClear();
    mockOtpModel.create.mockClear();
    mockOtpModel.update.mockClear();
    mockOtpModel.aggregate.mockClear();
    mockSmsQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        {
          provide: PrismaService,
          useValue: {
            otp: mockOtpModel,
            smsReport: { create: jest.fn() },
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => undefined) } },
        { provide: 'BullQueue_sms-otp', useValue: mockSmsQueue },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('requestOtp', () => {
    it('should enqueue OTP and return success immediately', async () => {
      mockActiveOtp = null;
      mockOtpModel.create.mockResolvedValue({ id: '1', code: '123456' });

      const result = await service.requestOtp('+998901234567');

      expect(result.success).toBe(true);
      expect(mockOtpModel.create).toHaveBeenCalled();
      expect(mockSmsQueue.add).toHaveBeenCalledWith('send-otp', {
        phoneHash: expect.any(String),
        phone: '+998901234567',
        code: expect.any(String),
      });
    });

    it('should not resend within cooldown period', async () => {
      const recentOtp = {
        id: '1',
        phoneHash: 'hash',
        status: OtpStatus.UNUSED,
        createdAt: new Date(),
      };
      mockActiveOtp = recentOtp;

      const result = await service.requestOtp('+998901234567');

      expect(result.success).toBe(true);
      expect(result.message).toContain('already sent');
      expect(mockOtpModel.create).not.toHaveBeenCalled();
      expect(mockSmsQueue.add).not.toHaveBeenCalled();
    });

    it('should propagate queue errors when Redis is unreachable', async () => {
      mockActiveOtp = null;
      mockOtpModel.create.mockResolvedValue({ id: '1' });
      mockSmsQueue.add.mockRejectedValue(new Error('Redis connection refused'));

      await expect(service.requestOtp('+998901234567')).rejects.toThrow(
        'Redis connection refused',
      );
    });
  });

  describe('verifyOtp', () => {
    it('should verify valid OTP', async () => {
      const validOtp = {
        id: '1',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      };
      mockActiveOtp = validOtp;
      mockOtpModel.update.mockResolvedValue({});

      const result = await service.verifyOtp('+998901234567', '123456');

      expect(result.success).toBe(true);
      expect(mockOtpModel.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: OtpStatus.USED },
      });
    });

    it('should reject invalid OTP', async () => {
      const validOtp = {
        id: '1',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      };
      mockActiveOtp = validOtp;
      mockOtpModel.update.mockResolvedValue({});

      await expect(service.verifyOtp('+998901234567', '000000')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject expired OTP', async () => {
      mockActiveOtp = null;

      await expect(service.verifyOtp('+998901234567', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should lock out after max failed attempts', async () => {
      const otpWithAttempts = {
        id: '1',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 4,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      };
      mockActiveOtp = otpWithAttempts;
      mockAttemptsSum = 4;
      mockOtpModel.update.mockResolvedValue({});

      await expect(service.verifyOtp('+998901234567', '000000')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should persist the 5th failed attempt before throwing lockout ForbiddenException', async () => {
      const otpWithAttempts = {
        id: '1',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 4,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      };
      mockActiveOtp = otpWithAttempts;
      mockAttemptsSum = 4;
      mockOtpModel.update.mockResolvedValue({});

      await expect(service.verifyOtp('+998901234567', '000000')).rejects.toThrow(
        ForbiddenException,
      );

      // Verify attempts is updated in DB before throwing
      expect(mockOtpModel.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { attempts: 5 },
      });
    });

    it('should reject verification even with correct code if locked out', async () => {
      const failedOtp = {
        id: '2',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 5,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(Date.now() - 1000), // 1 second ago, within lockout window
      };
      mockActiveOtp = failedOtp;
      mockAttemptsSum = 5;

      await expect(service.verifyOtp('+998901234567', '123456')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockOtpModel.update).not.toHaveBeenCalled();
    });

    it('should lock out immediately if an active OTP already has too many failed attempts', async () => {
      const otpWithMaxAttempts = {
        id: '1',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 5,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(Date.now() - 1000), // within lockout window
      };
      mockActiveOtp = otpWithMaxAttempts;
      mockAttemptsSum = 5;

      await expect(service.verifyOtp('+998901234567', '123456')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should lock out when prior OTPs already accumulated max attempts within window', async () => {
      const freshOtp = {
        id: 'fresh',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      };
      mockActiveOtp = freshOtp;
      mockAttemptsSum = 5; // exhausted on a previous OTP

      await expect(service.verifyOtp('+998901234567', '123456')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockOtpModel.update).not.toHaveBeenCalled();
    });
  });
});
