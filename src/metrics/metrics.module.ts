import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { RedisMetrics } from './redis.metrics';

@Module({
  imports: [PrometheusModule.register({ defaultMetrics: { enabled: true } })],
  providers: [RedisMetrics],
  exports: [RedisMetrics],
})
export class MetricsModule {}
