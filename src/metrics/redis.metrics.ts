import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

@Injectable()
export class RedisMetrics {
  constructor(
    @InjectMetric('redis_cache_operations_total')
    private readonly counter: Counter<string>,
  ) {}

  record(operation: 'get' | 'set' | 'invalidate', result: 'success' | 'error') {
    this.counter.inc({ operation, result });
  }
}
