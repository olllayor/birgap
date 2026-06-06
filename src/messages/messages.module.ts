import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ModerationModule } from '../moderation/moderation.module';
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
    ModerationModule,
    BullModule.registerQueue({
      name: 'storage-cleanup',
    }),
    BullModule.registerQueue({
      name: 'group-fanout',
      defaultJobOptions: {
        removeOnComplete: { count: 500, age: 3600 },
        removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    }),
  ],
  controllers: [MessagesController, MediaController],
  providers: [MessagesService, MediaService, MessagesResolver, MessageLoader],
  exports: [MessagesService, MediaService],
})
export class MessagesModule {}
