import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { QueuesController } from './queues.controller';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'sms-otp',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'push-notifications',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'group-fanout',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'group-edit-fanout',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'database-prune',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'storage-cleanup',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'unread-recalc',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'reaction-fanout',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'media-cleanup',
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [QueuesController],
})
export class QueuesModule {}
