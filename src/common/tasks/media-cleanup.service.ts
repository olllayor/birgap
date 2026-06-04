import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { MediaCleanupJobData } from './media-cleanup-job.interface';

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    @InjectQueue('media-cleanup')
    private readonly mediaCleanupQueue: Queue<MediaCleanupJobData>,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 4 * * *')
  async triggerMediaCleanup() {
    this.logger.log('Triggering media orphan cleanup job...');
    const triggeredAt = new Date().toISOString();
    await this.mediaCleanupQueue.add(
      'cleanup',
      { triggeredAt },
      { jobId: `media-cleanup-${triggeredAt}` },
    );
  }
}
