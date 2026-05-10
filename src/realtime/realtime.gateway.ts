import { Logger } from '@nestjs/common';
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
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly redis: RedisService,
    private readonly push: PushService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
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
  handleTypingStart(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: TypingDto) {
    if (!client.data.userId) {
      return;
    }
    this.server.to(`user:${body.recipientUserId}`).emit('typing.start', {
      userId: client.data.userId,
      deviceId: client.data.deviceId,
    });
  }

  @SubscribeMessage('typing.stop')
  handleTypingStop(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: TypingDto) {
    if (!client.data.userId) {
      return;
    }
    this.server.to(`user:${body.recipientUserId}`).emit('typing.stop', {
      userId: client.data.userId,
      deviceId: client.data.deviceId,
    });
  }

  @OnEvent('message.created')
  async onMessageCreated(message: { envelopes: Array<{ recipientDeviceId: string; recipientUserId: string }> }) {
    for (const envelope of message.envelopes) {
      this.server.to(`device:${envelope.recipientDeviceId}`).emit('message.new', envelope);
    }
    await this.push.sendMessageWakeup(message.envelopes);
  }

  @OnEvent('message.ack')
  onMessageAck(payload: { senderUserId: string }) {
    this.server.to(`user:${payload.senderUserId}`).emit('message.ack', payload);
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
