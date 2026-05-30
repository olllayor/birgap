import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PushService } from '../push/push.service';
import { RedisService } from '../redis/redis.service';
import { TypingDto } from './dto/typing.dto';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedSocket = Socket & {
  data: {
    userId?: string;
    deviceId?: string;
    sessionId?: string;
  };
};

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  pingInterval: 25000,
  pingTimeout: 10000,
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private isShuttingDown = false;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly redis: RedisService,
    private readonly push: PushService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    if (this.isShuttingDown) {
      client.emit('server.shutdown', { message: 'Server is shutting down' });
      client.disconnect(true);
      return;
    }

    const ticket = this.extractTicket(client);
    if (!ticket) {
      client.disconnect(true);
      return;
    }

    try {
      const auth = await this.realtimeService.consumeSocketTicket(ticket, client.id);
      client.data.userId = auth.userId;
      client.data.deviceId = auth.deviceId;
      client.data.sessionId = auth.sessionId;
      await client.join(`user:${auth.userId}`);
      await client.join(`device:${auth.deviceId}`);
      await this.redis.setDeviceSocket(auth.userId, auth.deviceId, client.id).catch((error) => {
        this.logger.warn(`Could not register socket in Redis: ${error.message}`);
      });
      this.server.to(`user:${auth.userId}`).emit('presence.active', {
        userId: auth.userId,
        deviceId: auth.deviceId,
      });
    } catch (error) {
      this.logger.warn(`Socket auth failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const { userId, deviceId } = client.data;
    if (!userId || !deviceId) {
      return;
    }
    await this.redis.removeDeviceSocket(userId, deviceId, client.id).catch(() => undefined);
  }

  @SubscribeMessage('typing.start')
  async handleTypingStart(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: TypingDto) {
    if (!client.data.userId) {
      return;
    }
    if (body.groupId) {
      let memberIds = await this.redis.getGroupMemberIds(body.groupId);
      if (!memberIds) {
        const members = await this.prisma.groupMember.findMany({
          where: { groupId: body.groupId },
          select: { userId: true },
        });
        memberIds = members.map((m) => m.userId);
        this.redis.setGroupMemberIds(body.groupId, memberIds).catch(() => {});
      }
      for (const userId of memberIds) {
        if (userId !== client.data.userId) {
          this.server.to(`user:${userId}`).emit('typing.start', {
            userId: client.data.userId,
            deviceId: client.data.deviceId,
            groupId: body.groupId,
          });
        }
      }
    } else if (body.recipientUserId) {
      this.server.to(`user:${body.recipientUserId}`).emit('typing.start', {
        userId: client.data.userId,
        deviceId: client.data.deviceId,
      });
    }
  }

  @SubscribeMessage('typing.stop')
  async handleTypingStop(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: TypingDto) {
    if (!client.data.userId) {
      return;
    }
    if (body.groupId) {
      let memberIds = await this.redis.getGroupMemberIds(body.groupId);
      if (!memberIds) {
        const members = await this.prisma.groupMember.findMany({
          where: { groupId: body.groupId },
          select: { userId: true },
        });
        memberIds = members.map((m) => m.userId);
        this.redis.setGroupMemberIds(body.groupId, memberIds).catch(() => {});
      }
      for (const userId of memberIds) {
        if (userId !== client.data.userId) {
          this.server.to(`user:${userId}`).emit('typing.stop', {
            userId: client.data.userId,
            deviceId: client.data.deviceId,
            groupId: body.groupId,
          });
        }
      }
    } else if (body.recipientUserId) {
      this.server.to(`user:${body.recipientUserId}`).emit('typing.stop', {
        userId: client.data.userId,
        deviceId: client.data.deviceId,
      });
    }
  }

  @OnEvent('message.created')
  onMessageCreated(message: { envelopes: Array<{ recipientDeviceId: string; recipientUserId: string }> }) {
    for (const envelope of message.envelopes) {
      this.server.to(`device:${envelope.recipientDeviceId}`).emit('message.new', envelope);
    }
    this.push.sendMessageWakeup(message.envelopes).catch((error) => {
      this.logger.warn(
        `Failed to enqueue push wakeup: ${error instanceof Error ? error.message : error}`,
      );
    });
  }

  @OnEvent('message.ack')
  onMessageAck(payload: { senderUserId: string }) {
    this.server.to(`user:${payload.senderUserId}`).emit('message.ack', payload);
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.logger.log('Shutting down WebSocket gateway, notifying connected clients...');

    this.server.emit('server.shutdown', { message: 'Server is shutting down, please reconnect' });

    try {
      const connectedSockets = Array.from(this.server.sockets.sockets.values()) as AuthenticatedSocket[];
      this.logger.log(`Cleaning up ${connectedSockets.length} active sockets in Redis...`);
      await Promise.all(
        connectedSockets.map(async (socket) => {
          const { userId, deviceId } = socket.data;
          if (userId && deviceId) {
            await this.redis.removeDeviceSocket(userId, deviceId, socket.id).catch(() => undefined);
          }
        }),
      );
    } catch (error) {
      this.logger.warn(`Failed to cleanup Redis sockets during shutdown: ${error instanceof Error ? error.message : error}`);
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn('Graceful shutdown timeout reached, forcing close');
        resolve();
      }, 5000);

      this.server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.logger.log('WebSocket gateway closed');
  }

  private extractTicket(client: Socket) {
    const authTicket = client.handshake.auth?.ticket;
    if (typeof authTicket === 'string') {
      return authTicket;
    }
    const queryTicket = client.handshake.query?.ticket;
    return typeof queryTicket === 'string' ? queryTicket : undefined;
  }
}
