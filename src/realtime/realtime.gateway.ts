import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import { Redis } from 'ioredis';
import { Server, Socket } from 'socket.io';
import { PushService } from '../push/push.service';
import { RedisService } from '../redis/redis.service';
import { TypingDto } from './dto/typing.dto';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../prisma/prisma.service';

const REALTIME_USER_KICKED_CHANNEL = 'realtime:user-kicked';

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
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private isShuttingDown = false;
  private kickSubscriber: Redis | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly redis: RedisService,
    private readonly push: PushService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.kickSubscriber = this.redis.client.duplicate();
    this.kickSubscriber.on('error', (error) => {
      this.logger.warn(`Kick subscriber error: ${error.message}`);
    });
    await this.kickSubscriber.subscribe(REALTIME_USER_KICKED_CHANNEL);
    this.kickSubscriber.on('message', (channel, raw) => {
      if (channel !== REALTIME_USER_KICKED_CHANNEL) {
        return;
      }
      this.handleUserKicked(raw).catch((error) => {
        this.logger.warn(`Failed to handle user-kicked: ${error.message}`);
      });
    });
    this.logger.log(`Subscribed to ${REALTIME_USER_KICKED_CHANNEL}`);
  }

  private async handleUserKicked(raw: string) {
    let payload: { userId?: string; reason?: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload.userId) {
      return;
    }
    const room = `user:${payload.userId}`;
    const sockets = await this.server.in(room).fetchSockets();
    for (const sock of sockets) {
      sock.emit('user.kicked', { reason: payload.reason ?? 'KICKED' });
      sock.disconnect(true);
    }
    if (sockets.length > 0) {
      this.logger.log(`Kicked ${sockets.length} socket(s) for user ${payload.userId} (${payload.reason ?? 'KICKED'})`);
    }
  }

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

  @OnEvent('unread.updated')
  onUnreadUpdated(payload: { userId: string; threadId: string; threadType: string; count: number }) {
    this.server.to(`user:${payload.userId}`).emit('unread.updated', {
      threadId: payload.threadId,
      threadType: payload.threadType,
      count: payload.count,
    });
  }

  @OnEvent('messages.marked_all_read')
  onMarkedAllRead(payload: { userId: string; threadId: string; threadType: string }) {
    this.server.to(`user:${payload.userId}`).emit('messages.marked_all_read', {
      threadId: payload.threadId,
      threadType: payload.threadType,
    });
  }

  @OnEvent('reaction.created')
  onReactionCreated(payload: {
    reactionId: string;
    messageId: string;
    userId: string;
    emoji: string;
    createdAt: string;
    targetUserIds: string[];
    threadId?: string;
    groupId?: string;
  }) {
    const eventPayload = {
      reactionId: payload.reactionId,
      messageId: payload.messageId,
      userId: payload.userId,
      emoji: payload.emoji,
      createdAt: payload.createdAt,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
    };
    for (const targetUserId of payload.targetUserIds) {
      this.server.to(`user:${targetUserId}`).emit('reaction.new', eventPayload);
    }
  }

  @OnEvent('reaction.removed')
  onReactionRemoved(payload: {
    reactionId: string;
    messageId: string;
    userId: string;
    emoji: string;
    targetUserIds: string[];
    threadId?: string;
    groupId?: string;
  }) {
    const eventPayload = {
      reactionId: payload.reactionId,
      messageId: payload.messageId,
      userId: payload.userId,
      emoji: payload.emoji,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
    };
    for (const targetUserId of payload.targetUserIds) {
      this.server.to(`user:${targetUserId}`).emit('reaction.removed', eventPayload);
    }
  }

  @OnEvent('message.deleted')
  onMessageDeleted(payload: {
    messageId: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    deletedAt: string;
    targetUserIds: string[];
  }) {
    const eventPayload = {
      messageId: payload.messageId,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
      senderUserId: payload.senderUserId,
      deletedAt: payload.deletedAt,
    };
    for (const targetUserId of payload.targetUserIds) {
      this.server.to(`user:${targetUserId}`).emit('message.deleted', eventPayload);
    }
  }

  @OnEvent('message.deleted.group')
  async onGroupMessageDeleted(payload: {
    messageId: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    deletedAt: string;
    deletedByUserId?: string;
  }) {
    if (!payload.groupId) {
      return;
    }
    let memberIds = await this.redis.getGroupMemberIds(payload.groupId);
    if (!memberIds) {
      const members = await this.prisma.groupMember.findMany({
        where: { groupId: payload.groupId },
        select: { userId: true },
      });
      memberIds = members.map((m) => m.userId);
      this.redis.setGroupMemberIds(payload.groupId, memberIds).catch(() => {});
    }
    const eventPayload = {
      messageId: payload.messageId,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
      senderUserId: payload.senderUserId,
      deletedAt: payload.deletedAt,
    };
    const actorUserId = payload.deletedByUserId ?? payload.senderUserId;
    for (const userId of memberIds) {
      if (userId !== actorUserId) {
        this.server.to(`user:${userId}`).emit('message.deleted', eventPayload);
      }
    }
  }

  @OnEvent('message.tombstoned.platform')
  async onPlatformTombstone(payload: {
    messageId: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    tombstonedBy: string;
    at: string;
  }) {
    const eventPayload = {
      messageId: payload.messageId,
      threadId: payload.threadId,
      groupId: payload.groupId,
      senderUserId: payload.senderUserId,
      deletedAt: payload.at,
    };
    if (payload.groupId) {
      let memberIds = await this.redis.getGroupMemberIds(payload.groupId);
      if (!memberIds) {
        const members = await this.prisma.groupMember.findMany({
          where: { groupId: payload.groupId },
          select: { userId: true },
        });
        memberIds = members.map((m) => m.userId);
        this.redis.setGroupMemberIds(payload.groupId, memberIds).catch(() => {});
      }
      for (const userId of memberIds) {
        if (userId !== payload.tombstonedBy) {
          this.server.to(`user:${userId}`).emit('message.deleted', eventPayload);
        }
      }
      return;
    }
    if (payload.threadId) {
      const thread = await this.prisma.directThread.findUnique({
        where: { id: payload.threadId },
        select: { userAId: true, userBId: true },
      });
      if (thread) {
        const targetUserIds = [thread.userAId, thread.userBId].filter((id) => id !== payload.tombstonedBy);
        for (const userId of targetUserIds) {
          this.server.to(`user:${userId}`).emit('message.deleted', eventPayload);
        }
      }
    }
  }

  // Both edit paths emit PER DEVICE with that device's refreshed ciphertext —
  // a flat user-room broadcast without ciphertext can't be applied by clients
  // (an already-READ envelope never resurfaces via /messages/pending, so the
  // socket event is the only delivery of the edited content). This also
  // reaches the sender's OTHER devices, which user-room broadcasts that
  // filtered out the sender entirely used to miss.
  private emitEditedPerDevice(payload: {
    messageId: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    senderDeviceId: string;
    editedAt: string;
    envelopes: Array<{ recipientDeviceId: string; ciphertext: unknown }>;
  }) {
    const summary = {
      id: payload.messageId,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
      senderUserId: payload.senderUserId,
      senderDeviceId: payload.senderDeviceId,
      editedAt: payload.editedAt,
    };
    for (const envelope of payload.envelopes ?? []) {
      this.server.to(`device:${envelope.recipientDeviceId}`).emit('message.edited', {
        messageId: payload.messageId,
        threadId: payload.threadId ?? null,
        groupId: payload.groupId ?? null,
        senderUserId: payload.senderUserId,
        senderDeviceId: payload.senderDeviceId,
        editedAt: payload.editedAt,
        ciphertext: envelope.ciphertext,
        message: summary,
      });
    }
  }

  @OnEvent('message.edited')
  onMessageEdited(payload: {
    messageId: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    senderDeviceId: string;
    editedAt: string;
    targetUserIds: string[];
    envelopes: Array<{ recipientDeviceId: string; ciphertext: unknown }>;
  }) {
    this.emitEditedPerDevice(payload);
  }

  @OnEvent('message.edited.group')
  onGroupMessageEdited(payload: {
    // The group edit fanout processor emits `id`, not `messageId`.
    id: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    senderDeviceId: string;
    editedAt: string;
    envelopes: Array<{ recipientDeviceId: string; ciphertext: unknown }>;
  }) {
    if (!payload.groupId) {
      return;
    }
    this.emitEditedPerDevice({ ...payload, messageId: payload.id });
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.logger.log('Shutting down WebSocket gateway, notifying connected clients...');

    if (this.kickSubscriber) {
      await this.kickSubscriber.quit().catch(() => undefined);
      this.kickSubscriber = null;
    }

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
