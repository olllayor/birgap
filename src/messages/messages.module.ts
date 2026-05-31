import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageLoader } from '../common/loaders/message.loader';
import { MessagesController } from './messages.controller';
import { MessagesResolver } from './messages.resolver';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesResolver, MessageLoader],
  exports: [MessagesService],
})
export class MessagesModule {}
