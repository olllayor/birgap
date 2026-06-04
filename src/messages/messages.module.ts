import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageLoader } from '../common/loaders/message.loader';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MessagesController } from './messages.controller';
import { MessagesResolver } from './messages.resolver';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    BullModule.registerQueue({
      name: 'storage-cleanup',
    }),
  ],
  controllers: [MessagesController, MediaController],
  providers: [MessagesService, MediaService, MessagesResolver, MessageLoader],
  exports: [MessagesService, MediaService],
})
export class MessagesModule {}
