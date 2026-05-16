import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SmsProvider, SmsType } from '@prisma/client';
import { SendSmsParams, SmsSendResult } from './sayqal-sms.service';

@Injectable()
export class MockSmsService {
  private readonly logger = new Logger(MockSmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendOtp(params: SendSmsParams): Promise<SmsSendResult> {
    const mockCode = this.config.get<string>('OTP_MOCK_CODE') ?? '000000';

    this.logger.log(`[MOCK SMS] Phone: ${params.phone}, Code: ${mockCode}`);

    await this.prisma.smsReport.create({
      data: {
        phoneHash: params.phoneHash,
        type: SmsType.OTP,
        provider: SmsProvider.MOCK,
        success: true,
      },
    });

    return { success: true };
  }
}
