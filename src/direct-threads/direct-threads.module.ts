import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UserLoader } from '../common/loaders/user.loader';
import { MessageLoader } from '../common/loaders/message.loader';
import { DirectThreadsResolver } from './direct-threads.resolver';
import { DirectThreadsService } from './direct-threads.service';
import { DirectThreadsController } from './direct-threads.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DirectThreadsController],
  providers: [DirectThreadsResolver, DirectThreadsService, UserLoader, MessageLoader],
  exports: [DirectThreadsService],
})
export class DirectThreadsModule {}
