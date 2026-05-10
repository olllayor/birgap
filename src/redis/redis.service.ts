import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', (error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }

  async setDeviceSocket(userId: string, deviceId: string, socketId: string) {
    await this.ensureConnected();
    await this.client.sadd(`user:${userId}:sockets`, socketId);
    await this.client.sadd(`device:${deviceId}:sockets`, socketId);
    await this.client.set(`socket:${socketId}`, JSON.stringify({ userId, deviceId }), 'EX', 3600);
  }

  async removeDeviceSocket(userId: string, deviceId: string, socketId: string) {
    await this.ensureConnected();
    await this.client.srem(`user:${userId}:sockets`, socketId);
    await this.client.srem(`device:${deviceId}:sockets`, socketId);
    await this.client.del(`socket:${socketId}`);
  }

  async hasDeviceSocket(deviceId: string) {
    await this.ensureConnected();
    return (await this.client.scard(`device:${deviceId}:sockets`)) > 0;
  }

  private async ensureConnected() {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }
}
