import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PruneJobData } from './prune-job.interface';

@Injectable()
export class PruneService {
  private readonly logger = new Logger(PruneService.name);

  constructor(
    @InjectQueue('database-prune')
    private readonly pruneQueue: Queue<PruneJobData>,
  ) {}

  @Cron('0 3 * * *')
  async triggerPrune() {
    this.logger.log('Triggering database prune job...');
    const triggeredAt = new Date().toISOString();
    await this.pruneQueue.add(
      'prune',
      { triggeredAt },
      { jobId: `database-prune-${triggeredAt}` },
    );
  }
}
