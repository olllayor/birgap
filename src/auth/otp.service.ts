import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { OtpStatus } from '@prisma/client';
import { hmacSha256, normalizePhone, randomDigits } from '../common/utils/crypto.util';
import { timingSafeEqual } from 'crypto';
import { SmsOtpJobData } from '../sms/queue/sms-otp-job.interface';

@Injectable()
export class OtpService {
	private readonly logger = new Logger(OtpService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly config: ConfigService,
		@InjectQueue('sms-otp')
		private readonly smsQueue: Queue<SmsOtpJobData>,
	) {}

	async requestOtp(phone: string) {
		const normalizedPhone = normalizePhone(phone);
		const pepper = this.config.getOrThrow<string>('PHONE_HASH_PEPPER');
		const phoneHash = hmacSha256(normalizedPhone, pepper);
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
			const canResendAt = new Date(recentOtp.createdAt.getTime() + cooldownSeconds * 1000);
			return {
				success: true,
				message: 'OTP already sent. Please wait before requesting a new one.',
				canResendAt,
			};
		}

		const code = this.generateOtpCode();
		const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

		try {
			await this.prisma.otp.create({
				data: {
					phoneHash,
					code,
					status: OtpStatus.UNUSED,
					expiresAt,
				},
			});

			await this.smsQueue.add('send-otp', {
				phoneHash,
				phone: normalizedPhone,
				code,
			});

			return {
				success: true,
				message: 'OTP sent successfully',
				expiresInSeconds: ttlSeconds,
			};
		} catch (error) {
			this.logger.error(
				`Failed to request OTP for ${phoneHash}: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw new BadRequestException(
				`Failed to send OTP: ${error instanceof Error ? error.message : 'Unknown queue error'}`,
			);
		}
	}

	async verifyOtp(phone: string, code: string) {
		const normalizedPhone = normalizePhone(phone);
		const pepper = this.config.getOrThrow<string>('PHONE_HASH_PEPPER');
		const phoneHash = hmacSha256(normalizedPhone, pepper);
		const maxAttempts = this.config.get<number>('OTP_MAX_ATTEMPTS') ?? 5;
		const lockoutSeconds = this.config.get<number>('OTP_LOCKOUT_SECONDS') ?? 900;
		const lockoutThreshold = new Date(Date.now() - lockoutSeconds * 1000);

		// Phone-wide lockout: aggregate failed attempts across every OTP for this
		// phone within the lockout window so users can't reset their attempt
		// counter by requesting a fresh OTP after exhausting the previous one.
		const recentAttempts = await this.prisma.otp.aggregate({
			where: {
				phoneHash,
				createdAt: { gt: lockoutThreshold },
			},
			_sum: { attempts: true },
		});
		const totalAttempts = recentAttempts._sum.attempts ?? 0;
		if (totalAttempts >= maxAttempts) {
			const lockoutMinutes = Math.ceil(lockoutSeconds / 60);
			throw new BadRequestException(`Too many failed attempts. Please try again in ${lockoutMinutes} minutes.`);
		}

		const otp = await this.prisma.otp.findFirst({
			where: {
				phoneHash,
				status: OtpStatus.UNUSED,
			},
			orderBy: { createdAt: 'desc' },
		});

		if (!otp) {
			throw new BadRequestException('No active OTP found. Please request a new code.');
		}

		if (otp.expiresAt <= new Date()) {
			throw new BadRequestException('OTP has expired. Please request a new code.');
		}

		const expectedCode = otp.code.padStart(6, '0');
		const providedCode = code.padStart(6, '0');

		if (!this.timingSafeCompare(providedCode, expectedCode)) {
			const newAttempts = otp.attempts + 1;

			await this.prisma.otp.update({
				where: { id: otp.id },
				data: { attempts: newAttempts },
			});

			const remainingAttempts = maxAttempts - totalAttempts - 1;
			if (totalAttempts + 1 >= maxAttempts) {
				const lockoutMinutes = Math.ceil(lockoutSeconds / 60);
				throw new BadRequestException(`Too many failed attempts. Please try again in ${lockoutMinutes} minutes.`);
			}

			throw new BadRequestException(
				`Invalid OTP code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
			);
		}

		await this.prisma.otp.update({
			where: { id: otp.id },
			data: { status: OtpStatus.USED },
		});

		return { success: true, message: 'OTP verified successfully' };
	}

	private generateOtpCode(): string {
		const mockCode = this.config.get<string>('OTP_MOCK_CODE');
		if (mockCode) {
			return mockCode;
		}
		return randomDigits(6);
	}

	private timingSafeCompare(a: string, b: string): boolean {
		if (a.length !== b.length) {
			return false;
		}
		return timingSafeEqual(Buffer.from(a), Buffer.from(b));
	}
}
