import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { RedisMetrics } from './redis.metrics';
import { QueueMetrics } from './queue.metrics';

@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    RedisMetrics,
    QueueMetrics,
    makeCounterProvider({
      name: 'queue_job_completed_total',
      help: 'Total number of completed queue jobs',
      labelNames: ['queue'],
    }),
    makeCounterProvider({
      name: 'queue_job_failed_total',
      help: 'Total number of failed queue jobs',
      labelNames: ['queue'],
    }),
    makeCounterProvider({
      name: 'redis_cache_operations_total',
      help: 'Total number of Redis cache operations',
      labelNames: ['operation', 'result'],
    }),
  ],
  exports: [RedisMetrics, QueueMetrics],
})
export class MetricsModule {}
