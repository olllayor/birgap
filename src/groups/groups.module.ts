import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { GroupFanoutProcessor } from './queue/group-fanout.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'group-fanout',
    }),
  ],
  providers: [GroupsService, GroupFanoutProcessor],
  controllers: [GroupsController],
  exports: [GroupsService],
})
export class GroupsModule {}
