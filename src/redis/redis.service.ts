import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private connected = false;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      reconnectOnError: (error) => {
        const retryable = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'];
        return retryable.some((code) => error.message.includes(code));
      },
    });
    this.client.on('ready', () => {
      this.connected = true;
    });
    this.client.on('error', (error) => {
      this.connected = false;
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  isHealthy(): boolean {
    return this.connected && this.client.status === 'ready';
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }

  async setDeviceSocket(userId: string, deviceId: string, socketId: string) {
    await this.ensureConnected();
    const pipe = this.client.pipeline();
    pipe.sadd(`user:${userId}:sockets`, socketId);
    pipe.sadd(`device:${deviceId}:sockets`, socketId);
    pipe.expire(`user:${userId}:sockets`, 7200);
    pipe.expire(`device:${deviceId}:sockets`, 7200);
    pipe.set(`socket:${socketId}`, JSON.stringify({ userId, deviceId }), 'EX', 3600);
    await pipe.exec();
    await this.pruneStaleSockets(userId, deviceId).catch((error) => {
      this.logger.warn(`Failed to prune stale sockets for user ${userId}: ${error.message}`);
    });
  }

  async removeDeviceSocket(userId: string, deviceId: string, socketId: string) {
    await this.ensureConnected();
    const pipe = this.client.pipeline();
    pipe.srem(`user:${userId}:sockets`, socketId);
    pipe.srem(`device:${deviceId}:sockets`, socketId);
    pipe.del(`socket:${socketId}`);
    await pipe.exec();
  }

  async hasDeviceSocket(deviceId: string) {
    await this.ensureConnected();
    return (await this.client.scard(`device:${deviceId}:sockets`)) > 0;
  }

  async hasUserSocket(userId: string) {
    await this.ensureConnected();
    return (await this.client.scard(`user:${userId}:sockets`)) > 0;
  }

  async getDevicesWithSockets(deviceIds: string[]): Promise<Set<string>> {
    if (deviceIds.length === 0) {
      return new Set();
    }
    await this.ensureConnected();
    const pipe = this.client.pipeline();
    for (const id of deviceIds) {
      pipe.scard(`device:${id}:sockets`);
    }
    const results = await pipe.exec();
    const online = new Set<string>();
    results?.forEach(([err, count], i) => {
      if (!err && Number(count) > 0) {
        online.add(deviceIds[i]);
      }
    });
    return online;
  }

  async pruneStaleSockets(userId: string, deviceId: string) {
    await this.ensureConnected();
    const userKey = `user:${userId}:sockets`;
    const deviceKey = `device:${deviceId}:sockets`;

    const [userSockets, deviceSockets] = await Promise.all([
      this.client.smembers(userKey),
      this.client.smembers(deviceKey),
    ]);

    const allSocketIds = [...userSockets, ...deviceSockets];
    if (allSocketIds.length === 0) {
      return;
    }

    const pipe = this.client.pipeline();
    for (const sid of allSocketIds) {
      pipe.exists(`socket:${sid}`);
    }
    const results = await pipe.exec();

    const staleUserSockets: string[] = [];
    const staleDeviceSockets: string[] = [];
    const split = userSockets.length;

    for (let i = 0; i < allSocketIds.length; i++) {
      const [, exists] = results![i]!;
      if (!exists) {
        if (i < split) {
          staleUserSockets.push(allSocketIds[i]);
        } else {
          staleDeviceSockets.push(allSocketIds[i]);
        }
      }
    }

    if (staleUserSockets.length > 0 || staleDeviceSockets.length > 0) {
      const sremPipe = this.client.pipeline();
      for (const sid of staleUserSockets) {
        sremPipe.srem(userKey, sid);
      }
      for (const sid of staleDeviceSockets) {
        sremPipe.srem(deviceKey, sid);
      }
      await sremPipe.exec();
    }
  }

  async getGroupMemberIds(groupId: string): Promise<string[] | null> {
    await this.ensureConnected();
    const members = await this.client.smembers(`group:${groupId}:member_ids`);
    return members.length > 0 ? members : null;
  }

  async setGroupMemberIds(groupId: string, userIds: string[]) {
    await this.ensureConnected();
    const key = `group:${groupId}:member_ids`;
    const pipe = this.client.pipeline();
    pipe.del(key);
    if (userIds.length > 0) {
      pipe.sadd(key, ...userIds);
    }
    pipe.expire(key, 300);
    await pipe.exec();
  }

  async invalidateGroupMemberIds(groupId: string) {
    await this.ensureConnected();
    await this.client.del(`group:${groupId}:member_ids`);
  }

  // Direct-thread peer cache for presence fan-out — same pattern as the group
  // member cache above. Short TTL keeps new threads visible within a minute.
  async getThreadPeerIds(userId: string): Promise<string[] | null> {
    await this.ensureConnected();
    const peers = await this.client.smembers(`user:${userId}:thread-peers`);
    return peers.length > 0 ? peers : null;
  }

  async setThreadPeerIds(userId: string, peerIds: string[]) {
    await this.ensureConnected();
    const key = `user:${userId}:thread-peers`;
    const pipe = this.client.pipeline();
    pipe.del(key);
    if (peerIds.length > 0) {
      pipe.sadd(key, ...peerIds);
    }
    pipe.expire(key, 60);
    await pipe.exec();
  }

  private async ensureConnected() {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }
}
