import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
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
    }),
    PrismaModule,
  ],
  providers: [GroupsService, GroupsResolver, GroupMemberResolver, UserLoader, GroupFanoutProcessor],
  controllers: [GroupsController],
  exports: [GroupsService],
})
export class GroupsModule {}
