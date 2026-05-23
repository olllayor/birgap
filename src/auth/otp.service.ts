import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OtpStatus } from '@prisma/client';
import { SmsService, SMS_SERVICE_TOKEN } from '../sms/sms.module';
import { Inject } from '@nestjs/common';
import { sha256, normalizePhone } from '../common/utils/crypto.util';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_SERVICE_TOKEN)
    private readonly smsService: SmsService,
  ) {}

  async requestOtp(phone: string) {
    const normalizedPhone = normalizePhone(phone);
    const phoneHash = sha256(normalizedPhone);
    const ttlSeconds = this.config.get<number>('OTP_TTL_SECONDS') ?? 300;
    const cooldownSeconds = this.config.get<number>('OTP_RESEND_COOLDOWN_SECONDS') ?? 120;

    const recentOtp = await this.prisma.otp.findFirst({
      where: {
        phoneHash,
        status: OtpStatus.UNUSED,
        createdAt: {
          gte: new Date(Date.now() - cooldownSeconds * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      const canResendAt = new Date(
        recentOtp.createdAt.getTime() + cooldownSeconds * 1000,
      );
      return {
        success: true,
        message: 'OTP already sent. Please wait before requesting a new one.',
        canResendAt,
      };
    }

    const code = this.generateOtpCode();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.otp.create({
      data: {
        phoneHash,
        code,
        status: OtpStatus.UNUSED,
        expiresAt,
      },
    });

    const sendResult = await this.smsService.sendOtp({
      phoneHash,
      phone: normalizedPhone,
      code,
    });

    if (!sendResult.success) {
      throw new BadRequestException('Failed to send OTP. Please try again.');
    }

    return {
      success: true,
      message: 'OTP sent successfully',
      expiresInSeconds: ttlSeconds,
    };
  }

  async verifyOtp(phone: string, code: string) {
    const normalizedPhone = normalizePhone(phone);
    const phoneHash = sha256(normalizedPhone);
    const maxAttempts = this.config.get<number>('OTP_MAX_ATTEMPTS') ?? 5;
    const lockoutSeconds = this.config.get<number>('OTP_LOCKOUT_SECONDS') ?? 900;

    const recentFailed = await this.prisma.otp.findFirst({
      where: {
        phoneHash,
        status: OtpStatus.UNUSED,
        attempts: { gte: maxAttempts },
        createdAt: {
          gt: new Date(Date.now() - lockoutSeconds * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentFailed) {
      throw new ForbiddenException(
        'Too many failed attempts. Please try again later.',
      );
    }

    const otp = await this.prisma.otp.findFirst({
      where: {
        phoneHash,
        status: OtpStatus.UNUSED,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new NotFoundException('Invalid or expired OTP');
    }

    if (otp.attempts >= maxAttempts) {
      throw new ForbiddenException(
        'Too many failed attempts. Please try again later.',
      );
    }

    const expectedCode = otp.code.padStart(6, '0');
    const providedCode = code.padStart(6, '0');

    if (!this.timingSafeCompare(providedCode, expectedCode)) {
      const newAttempts = otp.attempts + 1;

      await this.prisma.otp.update({
        where: { id: otp.id },
        data: { attempts: newAttempts },
      });

      if (newAttempts >= maxAttempts) {
        throw new ForbiddenException(
          'Too many failed attempts. Please try again later.',
        );
      }

      throw new ForbiddenException('Invalid OTP code');
    }

    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { status: OtpStatus.USED },
    });

    return { success: true, message: 'OTP verified successfully' };
  }

  private generateOtpCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
