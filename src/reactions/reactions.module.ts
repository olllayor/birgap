import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';
import { ReactionsService } from './reactions.service';
import { ReactionsController } from './reactions.controller';
import { ReactionFanoutProcessor } from './queue/reaction-fanout.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'reaction-fanout',
      defaultJobOptions: {
        removeOnComplete: { count: 500, age: 3600 },
        removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    }),
    PrismaModule,
    MetricsModule,
  ],
  providers: [ReactionsService, ReactionFanoutProcessor],
  controllers: [ReactionsController],
  exports: [ReactionsService],
})
export class ReactionsModule {}
