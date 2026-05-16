import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SmsProvider, SmsType } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import { createHash } from 'crypto';

export interface SendSmsParams {
  phoneHash: string;
  phone: string;
  code: string;
}

export interface SmsSendResult {
  success: boolean;
  error?: string;
}

@Injectable()
export class SayqalSmsService {
  private readonly logger = new Logger(SayqalSmsService.name);
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly username: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.getOrThrow<string>('SMS_SAYQAL_URL');
    this.secretKey = this.config.getOrThrow<string>('SMS_SAYQAL_SECRET');
    this.username = this.config.getOrThrow<string>('SMS_SAYQAL_USERNAME');
  }

  async sendOtp(params: SendSmsParams): Promise<SmsSendResult> {
    const utime = Math.floor(Date.now() / 1000);
    const message = `Your verification code: ${params.code}`;

    try {
      await this.transmitSms({
        phone: params.phone,
        text: message,
        serviceType: 2,
        utime,
      });

      await this.prisma.smsReport.create({
        data: {
          phoneHash: params.phoneHash,
          type: SmsType.OTP,
          provider: SmsProvider.SAYQAL,
          success: true,
        },
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Sayqal SMS failed: ${errorMessage}`);

      await this.prisma.smsReport.create({
        data: {
          phoneHash: params.phoneHash,
          type: SmsType.OTP,
          provider: SmsProvider.SAYQAL,
          success: false,
          error: errorMessage,
        },
      });

      return { success: false, error: errorMessage };
    }
  }

  private async transmitSms(params: {
    phone: string;
    text: string;
    serviceType: number;
    utime: number;
  }): Promise<void> {
    const { phone, text, serviceType, utime } = params;

    const cleanPhone = phone.replace(/\D/g, '');
    const token = this.generateToken('TransmitSMS', utime);

    const body = {
      utime,
      username: this.username,
      service: { service: serviceType },
      message: {
        smsid: String(utime),
        phone: cleanPhone,
        text,
      },
    };

    try {
      await axios.post(`${this.baseUrl}/sms/TransmitSMS`, body, {
        headers: {
          'X-Access-Token': token,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        throw new Error(
          `Sayqal API error ${error.response.status}: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  private generateToken(endpoint: string, utime: number): string {
    return createHash('md5')
      .update(`${endpoint} ${this.username} ${this.secretKey} ${utime}`)
      .digest('hex');
  }
}
