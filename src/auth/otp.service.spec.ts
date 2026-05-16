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

  const mockOtpModel = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockSmsService = {
    sendOtp: jest.fn(),
  };

  beforeEach(async () => {
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
      mockOtpModel.findFirst.mockResolvedValue(null);
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
      mockOtpModel.findFirst.mockResolvedValue(recentOtp);

      const result = await service.requestOtp('+998901234567');

      expect(result.success).toBe(true);
      expect(result.message).toContain('already sent');
      expect(mockOtpModel.create).not.toHaveBeenCalled();
    });

    it('should throw if SMS sending fails', async () => {
      mockOtpModel.findFirst.mockResolvedValue(null);
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
      mockOtpModel.findFirst.mockResolvedValue(validOtp);
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
      mockOtpModel.findFirst.mockResolvedValue(validOtp);
      mockOtpModel.update.mockResolvedValue({});

      await expect(service.verifyOtp('+998901234567', '000000')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject expired OTP', async () => {
      mockOtpModel.findFirst.mockResolvedValue(null);

      await expect(service.verifyOtp('+998901234567', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should lock out after max failed attempts', async () => {
      const otpWithMaxAttempts = {
        id: '1',
        phoneHash: 'hash',
        code: '123456',
        status: OtpStatus.UNUSED,
        attempts: 4,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      };
      mockOtpModel.findFirst.mockResolvedValue(otpWithMaxAttempts);

      await expect(service.verifyOtp('+998901234567', '000000')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
