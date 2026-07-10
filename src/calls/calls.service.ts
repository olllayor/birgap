import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CallStatus, CallType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

const CALL_CURSOR_PATTERN = /^(\d+):([0-9a-f-]{36})$/i;

export interface InitiateCallInput {
  calleeUserId: string;
  callType: CallType;
  sdpOffer: unknown;
}

// Signaling payloads (SDP/ICE) are relayed through the gateway and never
// persisted — CallLog stores lifecycle metadata only. Ring timers are
// node-local (same pattern as the gateway's presence-offline debounce): the
// node that accepted call.initiate owns the ring timeout for that call.
@Injectable()
export class CallsService implements OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name);
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  private get ringTimeoutMs(): number {
    return Number(this.config.get('CALL_RING_TIMEOUT_MS') ?? 45_000) || 45_000;
  }

  async initiate(callerUserId: string, input: InitiateCallInput) {
    if (callerUserId === input.calleeUserId) {
      throw new BadRequestException('Cannot call yourself');
    }

    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: callerUserId, blockedId: input.calleeUserId },
          { blockerId: input.calleeUserId, blockedId: callerUserId },
        ],
      },
      select: { id: true },
    });
    if (block) {
      throw new ForbiddenException('Cannot call: this user is blocked');
    }

    const callee = await this.prisma.user.findFirst({
      where: { id: input.calleeUserId, status: 'ACTIVE' },
      select: { id: true, devices: { where: { active: true }, select: { id: true } } },
    });
    if (!callee || callee.devices.length === 0) {
      throw new NotFoundException('Callee is not reachable');
    }

    // One live (RINGING/ACTIVE) call per pair at a time, either direction.
    const existing = await this.prisma.callLog.findFirst({
      where: {
        status: { in: [CallStatus.RINGING, CallStatus.ACTIVE] },
        OR: [
          { callerId: callerUserId, calleeId: input.calleeUserId },
          { callerId: input.calleeUserId, calleeId: callerUserId },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('A call between these users is already in progress');
    }

    const call = await this.prisma.callLog.create({
      data: {
        callerId: callerUserId,
        calleeId: input.calleeUserId,
        type: input.callType,
        status: CallStatus.RINGING,
      },
    });

    this.armRingTimer(call.id);

    // Wake offline callee devices so the app can surface the incoming call.
    this.push
      .sendCallWakeup(
        callee.devices.map((d) => ({ recipientDeviceId: d.id, recipientUserId: input.calleeUserId })),
        { kind: 'incoming_call', callId: call.id, callerUserId, callType: input.callType },
      )
      .catch((error) => {
        this.logger.warn(
          `Failed to enqueue incoming-call push for call ${call.id}: ${error instanceof Error ? error.message : error}`,
        );
      });

    return call;
  }

  /** Callee answers a ringing call. Guarded transition RINGING -> ACTIVE. */
  async answer(callId: string, userId: string) {
    const updated = await this.prisma.callLog.updateMany({
      where: { id: callId, calleeId: userId, status: CallStatus.RINGING },
      data: { status: CallStatus.ACTIVE, answeredAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Call is not ringing for this user');
    }
    this.disarmRingTimer(callId);
    return this.getOwnCall(callId, userId);
  }

  /** Callee declines a ringing call. RINGING -> DECLINED. */
  async decline(callId: string, userId: string) {
    const updated = await this.prisma.callLog.updateMany({
      where: { id: callId, calleeId: userId, status: CallStatus.RINGING },
      data: { status: CallStatus.DECLINED, endedAt: new Date(), endReason: 'declined' },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Call is not ringing for this user');
    }
    this.disarmRingTimer(callId);
    return this.getOwnCall(callId, userId);
  }

  /**
   * Either participant ends the call. ACTIVE -> ENDED. A caller hanging up
   * while still RINGING cancels the call: it becomes MISSED for the callee
   * (with a missed-call push), matching phone semantics.
   */
  async end(callId: string, userId: string, reason?: string) {
    const call = await this.getOwnCall(callId, userId);

    if (call.status === CallStatus.RINGING && call.callerId === userId) {
      const updated = await this.prisma.callLog.updateMany({
        where: { id: callId, status: CallStatus.RINGING },
        data: { status: CallStatus.MISSED, endedAt: new Date(), endReason: reason ?? 'cancelled' },
      });
      if (updated.count > 0) {
        this.disarmRingTimer(callId);
        this.sendMissedCallPush(callId, call.callerId, call.calleeId, call.type);
      }
      return this.getOwnCall(callId, userId);
    }

    const updated = await this.prisma.callLog.updateMany({
      where: { id: callId, status: CallStatus.ACTIVE },
      data: { status: CallStatus.ENDED, endedAt: new Date(), endReason: reason ?? 'hangup' },
    });
    if (updated.count === 0) {
      // Already terminal (peer hung up first / timed out) — idempotent success.
      return this.getOwnCall(callId, userId);
    }
    return this.getOwnCall(callId, userId);
  }

  /** Loads a call and asserts the user is a participant. */
  async getOwnCall(callId: string, userId: string) {
    const call = await this.prisma.callLog.findUnique({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException('Call not found');
    }
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new ForbiddenException('Not a participant in this call');
    }
    return call;
  }

  otherParticipant(call: { callerId: string; calleeId: string }, userId: string) {
    return call.callerId === userId ? call.calleeId : call.callerId;
  }

  async history(
    userId: string,
    opts: { filter?: 'missed' | 'all'; cursor?: string; limit?: number },
  ) {
    let cursorTs: number | undefined;
    let cursorId: string | undefined;
    if (opts.cursor !== undefined) {
      const match = CALL_CURSOR_PATTERN.exec(opts.cursor);
      if (!match) {
        throw new BadRequestException('Invalid cursor');
      }
      cursorTs = Number(match[1]);
      cursorId = match[2].toLowerCase();
    }

    const take = Math.min(opts.limit ?? 30, 100);
    const participantWhere =
      opts.filter === 'missed'
        ? { calleeId: userId, status: CallStatus.MISSED }
        : { OR: [{ callerId: userId }, { calleeId: userId }] };

    const calls = await this.prisma.callLog.findMany({
      where: {
        ...participantWhere,
        // Live calls don't belong in history.
        status: { notIn: [CallStatus.RINGING, CallStatus.ACTIVE] },
        ...(cursorTs !== undefined && {
          OR: [
            { startedAt: { lt: new Date(cursorTs) } },
            { startedAt: new Date(cursorTs), id: { lt: cursorId } },
          ],
        }),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: {
        caller: { select: { id: true, username: true, profileAvatarUrl: true, encryptedProfile: true, profileKeyHash: true } },
        callee: { select: { id: true, username: true, profileAvatarUrl: true, encryptedProfile: true, profileKeyHash: true } },
      },
    });

    const hasMore = calls.length > take;
    const page = hasMore ? calls.slice(0, take) : calls;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? `${last.startedAt.getTime()}:${last.id}` : null;

    return {
      items: page.map((c) => ({
        id: c.id,
        direction: c.callerId === userId ? 'outgoing' : 'incoming',
        peer: c.callerId === userId ? c.callee : c.caller,
        type: c.type,
        status: c.status,
        startedAt: c.startedAt.toISOString(),
        answeredAt: c.answeredAt?.toISOString() ?? null,
        endedAt: c.endedAt?.toISOString() ?? null,
        durationSeconds:
          c.answeredAt && c.endedAt
            ? Math.max(0, Math.round((c.endedAt.getTime() - c.answeredAt.getTime()) / 1000))
            : null,
        endReason: c.endReason,
      })),
      nextCursor,
      hasMore,
    };
  }

  private armRingTimer(callId: string) {
    const timer = setTimeout(() => {
      this.ringTimers.delete(callId);
      this.expireRinging(callId).catch((error) => {
        this.logger.warn(
          `Ring-timeout handling failed for call ${callId}: ${error instanceof Error ? error.message : error}`,
        );
      });
    }, this.ringTimeoutMs);
    this.ringTimers.set(callId, timer);
  }

  private disarmRingTimer(callId: string) {
    const timer = this.ringTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringTimers.delete(callId);
    }
  }

  // Guarded transition: only fires if the call is still RINGING, so an answer
  // that races the timer wins cleanly.
  private async expireRinging(callId: string) {
    const updated = await this.prisma.callLog.updateMany({
      where: { id: callId, status: CallStatus.RINGING },
      data: { status: CallStatus.MISSED, endedAt: new Date(), endReason: 'timeout' },
    });
    if (updated.count === 0) {
      return;
    }
    const call = await this.prisma.callLog.findUnique({ where: { id: callId } });
    if (!call) {
      return;
    }
    // Gateway relays call.ended to both parties' sockets.
    this.events.emit('call.timeout', {
      callId: call.id,
      callerUserId: call.callerId,
      calleeUserId: call.calleeId,
    });
    this.sendMissedCallPush(call.id, call.callerId, call.calleeId, call.type);
  }

  private sendMissedCallPush(callId: string, callerUserId: string, calleeUserId: string, callType: CallType) {
    this.prisma.device
      .findMany({ where: { userId: calleeUserId, active: true }, select: { id: true } })
      .then((devices) =>
        this.push.sendCallWakeup(
          devices.map((d) => ({ recipientDeviceId: d.id, recipientUserId: calleeUserId })),
          { kind: 'missed_call', callId, callerUserId, callType },
        ),
      )
      .catch((error) => {
        this.logger.warn(
          `Failed to enqueue missed-call push for call ${callId}: ${error instanceof Error ? error.message : error}`,
        );
      });
  }

  onModuleDestroy() {
    for (const timer of this.ringTimers.values()) {
      clearTimeout(timer);
    }
    this.ringTimers.clear();
  }
}
