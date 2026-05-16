import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { SayqalSmsService } from './sayqal-sms.service';
import { MockSmsService } from './mock-sms.service';

export type SmsService = SayqalSmsService | MockSmsService;

export const SMS_SERVICE_TOKEN = 'SMS_SERVICE';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    SayqalSmsService,
    MockSmsService,
    {
      provide: SMS_SERVICE_TOKEN,
      inject: [SayqalSmsService, MockSmsService, ConfigModule],
      useFactory: (
        sayqal: SayqalSmsService,
        mock: MockSmsService,
        config: ConfigModule,
      ) => {
        const mode = process.env.OTP_MODE ?? 'mock';
        return mode === 'sayqal' ? sayqal : mock;
      },
    },
  ],
  exports: [SMS_SERVICE_TOKEN, SayqalSmsService, MockSmsService],
})
export class SmsModule {}
