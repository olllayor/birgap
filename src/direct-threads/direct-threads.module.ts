import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UserLoader } from '../common/loaders/user.loader';
import { DirectThreadsResolver } from './direct-threads.resolver';
import { DirectThreadsService } from './direct-threads.service';

@Module({
  imports: [PrismaModule],
  providers: [DirectThreadsResolver, DirectThreadsService, UserLoader],
  exports: [DirectThreadsService],
})
export class DirectThreadsModule {}
