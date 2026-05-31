import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';
import { UnreadService } from './unread.service';
import { UnreadRecalcProcessor } from './queue/unread-recalc.processor';

@Global()
@Module({
  imports: [
    PrismaModule,
    MetricsModule,
    BullModule.registerQueue({
      name: 'unread-recalc',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: { count: 100, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    }),
  ],
  providers: [UnreadService, UnreadRecalcProcessor],
  exports: [UnreadService],
})
export class UnreadModule {}
