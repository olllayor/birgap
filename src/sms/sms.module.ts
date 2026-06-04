import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';
import { SayqalSmsService } from './sayqal-sms.service';
import { MockSmsService } from './mock-sms.service';
import { SmsOtpProcessor } from './queue/sms-otp.processor';

export type SmsService = SayqalSmsService | MockSmsService;

export const SMS_SERVICE_TOKEN = 'SMS_SERVICE';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    MetricsModule,
    BullModule.registerQueue({
      name: 'sms-otp',
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  providers: [
    SayqalSmsService,
    MockSmsService,
    SmsOtpProcessor,
    {
      provide: SMS_SERVICE_TOKEN,
      inject: [SayqalSmsService, MockSmsService, ConfigService],
      useFactory: (
        sayqal: SayqalSmsService,
        mock: MockSmsService,
        config: ConfigService,
      ) => {
        const mode = config.get<string>('OTP_MODE') ?? 'mock';
        return mode === 'sayqal' ? sayqal : mock;
      },
    },
  ],
  exports: [SMS_SERVICE_TOKEN, SayqalSmsService, MockSmsService],
})
export class SmsModule {}
