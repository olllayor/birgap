import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { maskPhone, normalizePhone, randomToken, sha256 } from '../common/utils/crypto.util';
import { AccountSuspendedException } from '../moderation/exceptions/account-suspended.exception';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly otpService: OtpService,
  ) {}

  async requestOtp(dto: RequestOtpDto) {
    const phone = normalizePhone(dto.phone);
    const result = await this.otpService.requestOtp(phone);
    return {
      phone: maskPhone(phone),
      mode: this.config.get<string>('OTP_MODE'),
      ...result,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    await this.otpService.verifyOtp(dto.phone, dto.code);

    const phone = normalizePhone(dto.phone);
    const user = await this.prisma.user.upsert({
      where: { phoneHash: sha256(phone) },
      update: { phoneMasked: maskPhone(phone) },
      create: {
        phoneHash: sha256(phone),
        phoneMasked: maskPhone(phone),
      },
      select: { id: true, status: true },
    });

    if (user.status === 'SUSPENDED') {
      await this.assertNotSuspended(user.id);
    }

    return this.issueTokenPair(user.id);
  }

  async refresh(refreshToken: string) {
    const tokenHash = sha256(refreshToken);
    const session = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true, user: { select: { status: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token is invalid');
    }

    if (session.user.status === 'SUSPENDED') {
      await this.assertNotSuspended(session.userId);
    }

    await this.prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(session.userId);
  }

  async logout(user: AuthenticatedUser, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: {
          tokenHash: sha256(refreshToken),
          userId: user.userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: { id: user.sessionId, userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async assertNotSuspended(userId: string): Promise<never> {
    const suspension = await this.prisma.userSuspension.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { suspendedAt: 'desc' },
      select: { reason: true, suspendedAt: true, expiresAt: true },
    });
    throw new AccountSuspendedException({
      reason: suspension?.reason ?? 'No reason provided',
      suspendedAt: (suspension?.suspendedAt ?? new Date()).toISOString(),
      expiresAt: suspension?.expiresAt ? suspension.expiresAt.toISOString() : null,
      appealUrl: this.config.get<string>('SUSPENSION_APPEAL_URL') ?? null,
    });
  }

  private async issueTokenPair(userId: string) {
    const refreshToken = randomToken(48);
    const refreshTokenTtlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS') ?? 30;
    const session = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000),
      },
    });

    const accessToken = await this.jwtService.signAsync({
      sub: userId,
      sid: session.id,
    });

    return {
      user: { id: userId },
      accessToken,
      refreshToken,
    };
  }
}
