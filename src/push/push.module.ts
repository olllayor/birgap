import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';
import { FcmProvider } from './fcm.provider';
import { PushService } from './push.service';
import { PushNotificationProcessor } from './queue/push-notification.processor';

@Global()
@Module({
  imports: [
    PrismaModule,
    MetricsModule,
    BullModule.registerQueue({
      name: 'push-notifications',
      defaultJobOptions: {
        removeOnComplete: { count: 1000, age: 3600 },
        removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'fixed', delay: 10000 },
      },
    }),
  ],
  providers: [FcmProvider, PushService, PushNotificationProcessor],
  exports: [PushService],
})
export class PushModule {}
