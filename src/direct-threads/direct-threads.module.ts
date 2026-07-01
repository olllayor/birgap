import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DirectThreadsService } from './direct-threads.service';
import { DirectThreadsController } from './direct-threads.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DirectThreadsController],
  providers: [DirectThreadsService],
  exports: [DirectThreadsService],
})
export class DirectThreadsModule {}
