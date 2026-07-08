import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { addDays, hmacSha256, maskPhone, normalizePhone, randomToken, sha256 } from '../common/utils/crypto.util';
import { AccountSuspendedException } from '../moderation/exceptions/account-suspended.exception';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';

interface SessionMeta {
	userAgent?: string;
	ip?: string;
}

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

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

	async verifyOtp(dto: VerifyOtpDto, meta?: SessionMeta) {
		const phone = normalizePhone(dto.phone);
		const pepper = this.config.getOrThrow<string>('PHONE_HASH_PEPPER');
		const phoneHash = hmacSha256(phone, pepper);

		await this.otpService.verifyOtp(phone, dto.code);

		const user = await this.findOrCreateUser(phone, phoneHash);

		await this.throwIfSuspended(user.id);

		return this.issueTokenPair(user.id, meta);
	}

	async refresh(refreshToken: string, meta?: SessionMeta) {
		const tokenHash = sha256(refreshToken);

		// C9 fix: Atomically revoke the current token. If it was already revoked
		// (count === 0), immediately revoke the entire family — no grace window.
		const updated = await this.prisma.refreshToken.updateMany({
			where: { tokenHash, revokedAt: null },
			data: { revokedAt: new Date() },
		});

		if (updated.count === 0) {
			// Token was already revoked — this is a reuse attempt. Revoke the family.
			await this.revokeTokenFamily(tokenHash);
			throw new UnauthorizedException('Refresh token has been reused — all sessions revoked');
		}

		const session = await this.prisma.refreshToken.findUnique({
			where: { tokenHash },
			select: {
				userId: true,
				familyId: true,
				expiresAt: true,
				user: { select: { status: true } },
			},
		});

		if (!session) {
			throw new UnauthorizedException('Refresh token is invalid');
		}

		// The token we just revoked above may have been past its TTL. Reject expired
		// tokens instead of minting a fresh pair from them — otherwise a refresh token
		// effectively never expires as long as it is rotated before revocation.
		if (session.expiresAt.getTime() <= Date.now()) {
			throw new UnauthorizedException('Refresh token has expired');
		}

		await this.throwIfSuspended(session.userId);

		return this.issueTokenPair(session.userId, meta, session.familyId);
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

	private async throwIfSuspended(userId: string): Promise<void> {
		const activeSuspension = await this.prisma.userSuspension.findFirst({
			where: {
				userId,
				revokedAt: null,
				OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
			},
			orderBy: { suspendedAt: 'desc' },
			select: { reason: true, suspendedAt: true, expiresAt: true },
		});

		if (activeSuspension) {
			throw new AccountSuspendedException({
				reason: activeSuspension.reason,
				suspendedAt: activeSuspension.suspendedAt.toISOString(),
				expiresAt: activeSuspension.expiresAt ? activeSuspension.expiresAt.toISOString() : null,
				appealUrl: this.config.get<string>('SUSPENSION_APPEAL_URL') ?? null,
			});
		}
	}

	private async findOrCreateUser(phone: string, phoneHash: string) {
		const existing = await this.prisma.user.findUnique({
			where: { phoneHash },
			select: { id: true },
		});

		if (existing) {
			return existing;
		}

		const legacyHash = sha256(phone);
		const legacyUser = await this.prisma.user.findUnique({
			where: { phoneHash: legacyHash },
			select: { id: true },
		});

		if (legacyUser) {
			await this.prisma.user.update({
				where: { id: legacyUser.id },
				data: { phoneHash },
			});
			return legacyUser;
		}

		return this.prisma.user.create({
			data: {
				phoneHash,
				phoneMasked: maskPhone(phone),
			},
			select: { id: true },
		});
	}

	private async revokeTokenFamily(tokenHash: string) {
		const token = await this.prisma.refreshToken.findUnique({
			where: { tokenHash },
			select: { familyId: true },
		});

		if (token) {
			await this.prisma.refreshToken.updateMany({
				where: { familyId: token.familyId, revokedAt: null },
				data: { revokedAt: new Date() },
			});
		}
	}

	private async issueTokenPair(userId: string, meta?: SessionMeta, familyId?: string) {
		const refreshToken = randomToken(48);
		const refreshTokenTtlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS') ?? 30;

		const session = await this.prisma.refreshToken.create({
			data: {
				userId,
				tokenHash: sha256(refreshToken),
				familyId: familyId ?? randomToken(32),
				expiresAt: addDays(new Date(), refreshTokenTtlDays),
				userAgent: meta?.userAgent ?? null,
				ipAddress: meta?.ip ?? null,
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
