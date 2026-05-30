import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { StorageCleanupProcessor } from './queue/storage-cleanup.processor';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({
      name: 'storage-cleanup',
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
      },
    }),
  ],
  controllers: [BackupsController],
  providers: [BackupsService, StorageCleanupProcessor],
})
export class BackupsModule {}
