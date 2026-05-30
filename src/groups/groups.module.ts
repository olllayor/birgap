import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';
import { UserLoader } from '../common/loaders/user.loader';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { GroupsResolver } from './groups.resolver';
import { GroupMemberResolver } from './group-members.resolver';
import { GroupFanoutProcessor } from './queue/group-fanout.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'group-fanout',
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
  providers: [GroupsService, GroupsResolver, GroupMemberResolver, UserLoader, GroupFanoutProcessor],
  controllers: [GroupsController],
  exports: [GroupsService],
})
export class GroupsModule {}
