import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpStatus } from '@prisma/client';
import { TELEGRAM_OTP_QUEUE } from '../telegram/telegram.tokens';

describe('OtpService', () => {
  let service: OtpService;
  let mockTelegramQueue: { add: jest.Mock };

  let mockActiveOtp: unknown = null;
  let mockAttemptsSum = 0;
  let mockTelegramLink: unknown = { id: 'link-1' };

  const mockOtpModel = {
    findFirst: jest.fn().mockImplementation(() => mockActiveOtp),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn().mockImplementation(() =>
      Promise.resolve({ _sum: { attempts: mockAttemptsSum } }),
    ),
  };

  const mockTelegramLinkModel = {
    findUnique: jest.fn().mockImplementation(() => mockTelegramLink),
  };

  beforeEach(async () => {
    mockActiveOtp = null;
    mockAttemptsSum = 0;
    mockTelegramLink = { id: 'link-1' };
    mockOtpModel.findFirst.mockClear();
    mockOtpModel.create.mockClear();
    mockOtpModel.update.mockClear();
    mockOtpModel.aggregate.mockClear();
    mockTelegramLinkModel.findUnique.mockClear();
    mockTelegramQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        {
          provide: PrismaService,
          useValue: {
            otp: mockOtpModel,
            telegramLink: mockTelegramLinkModel,
            smsReport: { create: jest.fn() },
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => key === 'PHONE_HASH_PEPPER' ? 'test-pepper' : undefined), getOrThrow: jest.fn((key: string) => { if (key === 'PHONE_HASH_PEPPER') return 'test-pepper'; throw new Error(`Missing config: ${key}`); }) } },
        { provide: `BullQueue_${TELEGRAM_OTP_QUEUE}`, useValue: mockTelegramQueue },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('requestOtp', () => {
    it('should enqueue OTP to the Telegram queue and return success immediately', async () => {
      mockActiveOtp = null;
      mockOtpModel.create.mockResolvedValue({ id: '1', code: '123456' });

      const result = await service.requestOtp('+998901234567');

      expect(result.success).toBe(true);
      expect(mockOtpModel.create).toHaveBeenCalled();
      expect(mockTelegramQueue.add).toHaveBeenCalledWith('send-otp', {
        phoneHash: expect.any(String),
        phone: '+998901234567',
        code: expect.any(String),
      });
    });

    it('should reject with TELEGRAM_LINK_REQUIRED when the phone has no Telegram link', async () => {
      mockTelegramLink = null;

      await expect(service.requestOtp('+998901234567')).rejects.toThrow(BadRequestException);
      expect(mockOtpModel.create).not.toHaveBeenCalled();
      expect(mockTelegramQueue.add).not.toHaveBeenCalled();
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
      expect(mockTelegramQueue.add).not.toHaveBeenCalled();
    });

    it('should propagate queue errors when Redis is unreachable', async () => {
      mockActiveOtp = null;
      mockOtpModel.create.mockResolvedValue({ id: '1' });
      mockTelegramQueue.add.mockRejectedValue(new Error('Redis connection refused'));

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
        BadRequestException,
      );
    });

    it('should reject expired OTP', async () => {
      mockActiveOtp = null;

      await expect(service.verifyOtp('+998901234567', '123456')).rejects.toThrow(
        BadRequestException,
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
        BadRequestException,
      );
    });

    it('should persist the 5th failed attempt before throwing lockout BadRequestException', async () => {
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
        BadRequestException,
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
        BadRequestException,
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
        BadRequestException,
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
        BadRequestException,
      );
      expect(mockOtpModel.update).not.toHaveBeenCalled();
    });
  });
});
