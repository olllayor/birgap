import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_SERVICE_TOKEN } from '../sms/sms.module';
import { OtpStatus } from '@prisma/client';

describe('OtpService', () => {
  let service: OtpService;
  let prisma: PrismaService;
  let smsService: any;

  let mockActiveOtp: any = null;
  let mockFailedOtp: any = null;

  const mockOtpModel = {
    findFirst: jest.fn().mockImplementation((args) => {
      if (args?.where?.attempts) {
        return mockFailedOtp;
      }
      return mockActiveOtp;
    }),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockSmsService = {
    sendOtp: jest.fn(),
  };

  beforeEach(async () => {
    mockActiveOtp = null;
    mockFailedOtp = null;
    mockOtpModel.findFirst.mockClear();
    mockOtpModel.create.mockClear();
    mockOtpModel.update.mockClear();

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
        { provide: SMS_SERVICE_TOKEN, useValue: mockSmsService },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
    prisma = module.get<PrismaService>(PrismaService);
    smsService = module.get(SMS_SERVICE_TOKEN);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('requestOtp', () => {
    it('should send new OTP successfully', async () => {
      mockActiveOtp = null;
      mockOtpModel.create.mockResolvedValue({ id: '1', code: '123456' });
      mockSmsService.sendOtp.mockResolvedValue({ success: true });

      const result = await service.requestOtp('+998901234567');

      expect(result.success).toBe(true);
      expect(mockOtpModel.create).toHaveBeenCalled();
      expect(mockSmsService.sendOtp).toHaveBeenCalled();
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
    });

    it('should throw if SMS sending fails', async () => {
      mockActiveOtp = null;
      mockOtpModel.create.mockResolvedValue({ id: '1' });
      mockSmsService.sendOtp.mockResolvedValue({ success: false, error: 'API error' });

      await expect(service.requestOtp('+998901234567')).rejects.toThrow(
        BadRequestException,
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
        createdAt: new Date(),
      };
      mockFailedOtp = failedOtp;

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
        createdAt: new Date(),
      };
      mockActiveOtp = otpWithMaxAttempts;

      await expect(service.verifyOtp('+998901234567', '123456')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
