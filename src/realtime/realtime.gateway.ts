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
import { CallsService } from '../calls/calls.service';
import { PushService } from '../push/push.service';
import { RedisService } from '../redis/redis.service';
import { TypingDto } from './dto/typing.dto';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../prisma/prisma.service';

const REALTIME_USER_KICKED_CHANNEL = 'realtime:user-kicked';
const TYPING_THROTTLE_MS = 500; // H1: max one typing event per 500ms per socket
// Wait this long after a user's last socket drops before telling direct-thread
// peers they went offline, so brief network flaps don't spam presence events.
const PRESENCE_OFFLINE_DEBOUNCE_MS = 10_000;

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

  // H1: In-memory typing throttle — tracks last event timestamp per socket id.
  private readonly typingThrottle = new Map<string, number>();

  // Pending "went offline" timers keyed by userId (flap debounce). Node-local
  // is fine: each socket disconnects on the node that held it, and the timer
  // re-checks Redis before emitting so a reconnect on another node still
  // suppresses the presence.inactive.
  private readonly pendingOffline = new Map<string, NodeJS.Timeout>();

  /**
   * True when a UserBlock exists in either direction between the two users.
   * Used to silently drop direct typing indicators — the sender gets no error
   * (Telegram behaviour: the blocker must not be probeable via typing relays).
   * Plain Prisma lookup is fine here: typing is already throttled to one event
   * per 500ms per socket.
   */
  private async isDirectBlocked(userIdA: string, userIdB: string): Promise<boolean> {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userIdA, blockedId: userIdB },
          { blockerId: userIdB, blockedId: userIdA },
        ],
      },
      select: { id: true },
    });
    return block !== null;
  }

  /** Returns true if the socket should be throttled (too soon since last typing event). */
  private isTypingThrottled(socketId: string): boolean {
    const now = Date.now();
    const last = this.typingThrottle.get(socketId) ?? 0;
    if (now - last < TYPING_THROTTLE_MS) {
      return true;
    }
    this.typingThrottle.set(socketId, now);
    return false;
  }

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly redis: RedisService,
    private readonly push: PushService,
    private readonly prisma: PrismaService,
    private readonly calls: CallsService,
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

      // Sample the offline→online transition BEFORE registering this socket:
      // peers only need presence.active when the user's first socket appears
      // (fail-open: on Redis error assume already-online and stay quiet).
      const wasOnline = await this.redis.hasUserSocket(auth.userId).catch(() => true);

      await this.redis.setDeviceSocket(auth.userId, auth.deviceId, client.id).catch((error) => {
        this.logger.warn(`Could not register socket in Redis: ${error.message}`);
      });

      // Reconnect within the debounce window: cancel the pending inactive.
      // Peers never saw the inactive, so from their point of view nothing
      // changed — emit nothing to them in that case.
      const pendingInactive = this.pendingOffline.get(auth.userId);
      if (pendingInactive) {
        clearTimeout(pendingInactive);
        this.pendingOffline.delete(auth.userId);
      }

      // Own-room emit stays unconditional: the user's other devices track
      // per-device presence and are not subject to the flap debounce.
      this.server.to(`user:${auth.userId}`).emit('presence.active', {
        userId: auth.userId,
        deviceId: auth.deviceId,
      });

      if (!wasOnline && !pendingInactive) {
        // Genuine offline→online transition: fan out to direct-thread peers.
        // Non-fatal — a fan-out failure must not kill the connection.
        this.emitPresenceToPeers('presence.active', auth.userId, {
          userId: auth.userId,
          deviceId: auth.deviceId,
        }).catch((error) => {
          this.logger.warn(
            `Failed to fan out presence.active for user ${auth.userId}: ${error instanceof Error ? error.message : error}`,
          );
        });
      }
    } catch (error) {
      this.logger.warn(`Socket auth failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const { userId, deviceId } = client.data;
    // H1: clean up throttle tracking for this socket
    this.typingThrottle.delete(client.id);
    if (!userId || !deviceId) {
      return;
    }
    await this.redis.removeDeviceSocket(userId, deviceId, client.id).catch(() => undefined);

    // Persist last-seen once the device's final socket closes, so other users can
    // show "last seen recently". A device may hold several sockets, so only the
    // last one dropping counts as going offline (fail-open: on Redis error we
    // assume still-online and skip the write rather than flap the timestamp).
    const stillOnline = await this.redis.hasDeviceSocket(deviceId).catch(() => true);
    if (stillOnline) {
      return;
    }
    const lastSeenAt = new Date();
    await this.prisma.device
      .update({ where: { id: deviceId }, data: { lastSeenAt } })
      .catch(() => undefined);
    this.server.to(`user:${userId}`).emit('presence.inactive', {
      userId,
      deviceId,
      lastSeenAt: lastSeenAt.toISOString(),
    });

    // Direct-thread peers only care about user-level presence, and only after
    // the debounce window — brief reconnects (network flaps) must not spam
    // them. Fail-open: on Redis error assume still-online and stay quiet.
    const userStillOnline = await this.redis.hasUserSocket(userId).catch(() => true);
    if (userStillOnline) {
      return;
    }
    const existing = this.pendingOffline.get(userId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.pendingOffline.delete(userId);
      this.emitDebouncedPeerInactive(userId, deviceId, lastSeenAt).catch((error) => {
        this.logger.warn(
          `Failed to fan out presence.inactive for user ${userId}: ${error instanceof Error ? error.message : error}`,
        );
      });
    }, PRESENCE_OFFLINE_DEBOUNCE_MS);
    this.pendingOffline.set(userId, timer);
  }

  // Fires after the debounce window: re-check Redis so a reconnect anywhere
  // (including on another node) suppresses the peer-facing inactive.
  private async emitDebouncedPeerInactive(userId: string, deviceId: string, lastSeenAt: Date) {
    const backOnline = await this.redis.hasUserSocket(userId).catch(() => true);
    if (backOnline) {
      return;
    }
    await this.emitPresenceToPeers('presence.inactive', userId, {
      userId,
      deviceId,
      lastSeenAt: lastSeenAt.toISOString(),
    });
  }

  private async emitPresenceToPeers(
    event: 'presence.active' | 'presence.inactive',
    userId: string,
    payload: Record<string, unknown>,
  ) {
    const peerIds = await this.getPresencePeerIds(userId);
    for (const peerId of peerIds) {
      this.server.to(`user:${peerId}`).emit(event, payload);
    }
  }

  // Everyone who should see this user's presence: DirectThread peers plus
  // co-members of shared groups. Short-lived Redis cache (60s) with Prisma as
  // fallback — same pattern as group member lookup.
  private async getPresencePeerIds(userId: string): Promise<string[]> {
    try {
      const cached = await this.redis.getThreadPeerIds(userId);
      if (cached) {
        return cached.filter((id) => id !== userId);
      }
    } catch (error) {
      this.logger.warn(
        `Could not read thread peers from Redis for user ${userId}: ${error instanceof Error ? error.message : error}`,
      );
    }
    const [threads, coMembers] = await Promise.all([
      this.prisma.directThread.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        select: { userAId: true, userBId: true },
      }),
      this.prisma.groupMember.findMany({
        where: { group: { members: { some: { userId } } } },
        select: { userId: true },
      }),
    ]);
    const peerIds = Array.from(
      new Set([
        ...threads.map((t) => (t.userAId === userId ? t.userBId : t.userAId)),
        ...coMembers.map((m) => m.userId),
      ]),
    ).filter((id) => id !== userId);
    this.redis.setThreadPeerIds(userId, peerIds).catch(() => {});
    return peerIds;
  }

  @SubscribeMessage('typing.start')
  async handleTypingStart(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: TypingDto) {
    if (!client.data.userId) {
      return;
    }
    // H1: rate-limit typing events
    if (this.isTypingThrottled(client.id)) {
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
      // Silently drop when blocked in either direction — no error to sender.
      if (await this.isDirectBlocked(client.data.userId, body.recipientUserId)) {
        return;
      }
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
    // H1: rate-limit typing events
    if (this.isTypingThrottled(client.id)) {
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
      // Silently drop when blocked in either direction — no error to sender.
      if (await this.isDirectBlocked(client.data.userId, body.recipientUserId)) {
        return;
      }
      this.server.to(`user:${body.recipientUserId}`).emit('typing.stop', {
        userId: client.data.userId,
        deviceId: client.data.deviceId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // WebRTC call signaling. The server relays SDP/ICE blobs verbatim (they are
  // opaque, never persisted) and owns the call state machine via CallsService.
  // Handler return values are socket.io acks: { ok, callId?, error? }.
  // ---------------------------------------------------------------------------

  @SubscribeMessage('call.initiate')
  async handleCallInitiate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { calleeUserId?: string; callType?: string; sdpOffer?: unknown },
  ) {
    if (!client.data.userId || !client.data.deviceId) {
      return { ok: false, error: 'UNAUTHENTICATED' };
    }
    if (!body?.calleeUserId || !body?.sdpOffer || (body.callType !== 'AUDIO' && body.callType !== 'VIDEO')) {
      return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    try {
      const call = await this.calls.initiate(client.data.userId, {
        calleeUserId: body.calleeUserId,
        callType: body.callType,
        sdpOffer: body.sdpOffer,
      });
      this.server.to(`user:${body.calleeUserId}`).emit('call.incoming', {
        callId: call.id,
        callerUserId: client.data.userId,
        callerDeviceId: client.data.deviceId,
        callType: call.type,
        sdpOffer: body.sdpOffer,
        startedAt: call.startedAt.toISOString(),
      });
      return { ok: true, callId: call.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'CALL_FAILED' };
    }
  }

  @SubscribeMessage('call.answer')
  async handleCallAnswer(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { callId?: string; sdpAnswer?: unknown },
  ) {
    if (!client.data.userId || !client.data.deviceId) {
      return { ok: false, error: 'UNAUTHENTICATED' };
    }
    if (!body?.callId || !body?.sdpAnswer) {
      return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    try {
      const call = await this.calls.answer(body.callId, client.data.userId);
      this.server.to(`user:${call.callerId}`).emit('call.answered', {
        callId: call.id,
        calleeDeviceId: client.data.deviceId,
        sdpAnswer: body.sdpAnswer,
      });
      // Stop the ring on the callee's other devices (client ignores own deviceId).
      this.server.to(`user:${call.calleeId}`).emit('call.taken', {
        callId: call.id,
        answeredByDeviceId: client.data.deviceId,
      });
      return { ok: true, callId: call.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'CALL_FAILED' };
    }
  }

  @SubscribeMessage('call.decline')
  async handleCallDecline(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { callId?: string },
  ) {
    if (!client.data.userId || !body?.callId) {
      return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    try {
      const call = await this.calls.decline(body.callId, client.data.userId);
      const ended = { callId: call.id, reason: 'declined', endedAt: call.endedAt?.toISOString() ?? null };
      this.server.to(`user:${call.callerId}`).emit('call.ended', ended);
      this.server.to(`user:${call.calleeId}`).emit('call.ended', ended);
      return { ok: true, callId: call.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'CALL_FAILED' };
    }
  }

  @SubscribeMessage('call.end')
  async handleCallEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { callId?: string; reason?: string },
  ) {
    if (!client.data.userId || !body?.callId) {
      return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    try {
      const call = await this.calls.end(body.callId, client.data.userId, body.reason);
      const ended = {
        callId: call.id,
        reason: call.endReason ?? 'hangup',
        status: call.status,
        endedAt: call.endedAt?.toISOString() ?? null,
      };
      this.server.to(`user:${call.callerId}`).emit('call.ended', ended);
      this.server.to(`user:${call.calleeId}`).emit('call.ended', ended);
      return { ok: true, callId: call.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'CALL_FAILED' };
    }
  }

  @SubscribeMessage('call.ice')
  async handleCallIce(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { callId?: string; candidate?: unknown },
  ) {
    if (!client.data.userId || !body?.callId || body?.candidate === undefined) {
      return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    try {
      const call = await this.calls.getOwnCall(body.callId, client.data.userId);
      if (call.status !== 'RINGING' && call.status !== 'ACTIVE') {
        return { ok: false, error: 'CALL_NOT_LIVE' };
      }
      const otherUserId = this.calls.otherParticipant(call, client.data.userId);
      this.server.to(`user:${otherUserId}`).emit('call.ice', {
        callId: call.id,
        candidate: body.candidate,
        fromUserId: client.data.userId,
        fromDeviceId: client.data.deviceId,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'CALL_FAILED' };
    }
  }

  // Ring timeout fired in CallsService (call flipped to MISSED there).
  @OnEvent('call.timeout')
  onCallTimeout(payload: { callId: string; callerUserId: string; calleeUserId: string }) {
    const ended = { callId: payload.callId, reason: 'timeout', endedAt: new Date().toISOString() };
    this.server.to(`user:${payload.callerUserId}`).emit('call.ended', ended);
    this.server.to(`user:${payload.calleeUserId}`).emit('call.ended', ended);
  }

  @OnEvent('message.created')
  async onMessageCreated(message: {
    envelopes: Array<{ recipientDeviceId: string; recipientUserId: string }>;
    threadId?: string | null;
    [key: string]: unknown;
  }) {
    // Each device gets its own envelope PLUS the message summary (threadId,
    // senderUserId, createdAt, ...). Without the summary the client cannot
    // file the message into a conversation — it would store an orphan row it
    // can never display.
    const { envelopes, media: _media, ...summary } = message;
    for (const envelope of envelopes) {
      this.server.to(`device:${envelope.recipientDeviceId}`).emit('message.new', {
        ...envelope,
        message: summary,
      });
    }
    // Per-user thread mute suppresses the FCM wakeup only — the socket emit
    // above and unread counting are untouched. Groups (no threadId) are
    // unaffected; group mute is a follow-up. The mute filter itself lives in
    // PushService.sendMessageWakeup (fails open on lookup errors).
    this.push.sendMessageWakeup(message.envelopes, message.threadId).catch((error) => {
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

  @OnEvent('message.pin')
  onDirectPinChanged(payload: {
    action: 'pinned' | 'unpinned';
    messageId: string;
    threadType: string;
    threadId: string | null;
    groupId: string | null;
    pinnedByUserId: string;
    at: string;
    targetUserIds: string[];
  }) {
    const eventPayload = {
      action: payload.action,
      messageId: payload.messageId,
      threadType: payload.threadType,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
      pinnedByUserId: payload.pinnedByUserId,
      at: payload.at,
    };
    for (const targetUserId of payload.targetUserIds) {
      this.server.to(`user:${targetUserId}`).emit('message.pin', eventPayload);
    }
  }

  @OnEvent('message.pin.group')
  async onGroupPinChanged(payload: {
    action: 'pinned' | 'unpinned';
    messageId: string;
    threadType: string;
    threadId: string | null;
    groupId: string | null;
    pinnedByUserId: string;
    at: string;
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
      action: payload.action,
      messageId: payload.messageId,
      threadType: payload.threadType,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
      pinnedByUserId: payload.pinnedByUserId,
      at: payload.at,
    };
    for (const userId of memberIds) {
      if (userId !== payload.pinnedByUserId) {
        this.server.to(`user:${userId}`).emit('message.pin', eventPayload);
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

  @OnEvent('message.edited')
  onMessageEdited(payload: {
    messageId: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    senderDeviceId: string;
    editedAt: string;
    targetUserIds: string[];
    envelopes: unknown[];
  }) {
    const eventPayload = {
      messageId: payload.messageId,
      threadId: payload.threadId ?? null,
      groupId: payload.groupId ?? null,
      senderUserId: payload.senderUserId,
      senderDeviceId: payload.senderDeviceId,
      editedAt: payload.editedAt,
    };
    // Per-device emit carrying that device's re-encrypted envelope: an edit is
    // new ciphertext, and without it the receiving client has nothing to
    // decrypt — a user-room broadcast of bare metadata can't update the text.
    const envelopes = payload.envelopes as Array<{
      recipientDeviceId: string;
      ciphertext: unknown;
      envelopeSequence?: unknown;
    }>;
    for (const envelope of envelopes) {
      this.server.to(`device:${envelope.recipientDeviceId}`).emit('message.edited', {
        ...eventPayload,
        ciphertext: envelope.ciphertext,
        envelopeSequence: envelope.envelopeSequence?.toString?.() ?? null,
      });
    }
  }

  @OnEvent('message.edited.group')
  async onGroupMessageEdited(payload: {
    messageId: string;
    threadId: string | null;
    groupId: string | null;
    senderUserId: string;
    senderDeviceId: string;
    editedAt: string;
    envelopes: unknown[];
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
      senderDeviceId: payload.senderDeviceId,
      editedAt: payload.editedAt,
    };
    for (const userId of memberIds) {
      if (userId !== payload.senderUserId) {
        this.server.to(`user:${userId}`).emit('message.edited', eventPayload);
      }
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.logger.log('Shutting down WebSocket gateway, notifying connected clients...');

    for (const timer of this.pendingOffline.values()) {
      clearTimeout(timer);
    }
    this.pendingOffline.clear();

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
