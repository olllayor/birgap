import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions, Server } from 'socket.io';

/**
 * Socket.IO adapter backed by Redis pub/sub. Without it, `server.to(room).emit`
 * only reaches sockets connected to the node that handled the emit, so on more
 * than one instance recipients on other nodes never receive live delivery
 * (message.new, typing, reactions, edits). The Redis adapter fans room emits out
 * across all nodes.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    this.pubClient = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.subClient = this.pubClient.duplicate();
    this.pubClient.on('error', (e) => this.logger.warn(`pub client error: ${e.message}`));
    this.subClient.on('error', (e) => this.logger.warn(`sub client error: ${e.message}`));
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(): Promise<void> {
    await this.pubClient?.quit().catch(() => undefined);
    await this.subClient?.quit().catch(() => undefined);
  }
}
