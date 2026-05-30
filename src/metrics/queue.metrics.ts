import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

@Injectable()
export class QueueMetrics {
  constructor(
    @InjectMetric('queue_job_completed_total')
    private readonly completedCounter: Counter<string>,
    @InjectMetric('queue_job_failed_total')
    private readonly failedCounter: Counter<string>,
  ) {}

  recordCompleted(queue: string) {
    this.completedCounter.inc({ queue });
  }

  recordFailed(queue: string) {
    this.failedCounter.inc({ queue });
  }
}
