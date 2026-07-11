import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramController } from './telegram.controller';
import { TelegramOtpProcessor } from './queue/telegram-otp.processor';
import { TELEGRAM_OTP_QUEUE } from './telegram.tokens';

@Global()
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    MetricsModule,
    BullModule.registerQueue({
      name: TELEGRAM_OTP_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  controllers: [TelegramController],
  providers: [TelegramBotService, TelegramOtpProcessor],
  exports: [TelegramBotService, BullModule],
})
export class TelegramModule {}
