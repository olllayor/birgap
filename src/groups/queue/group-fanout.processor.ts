import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { UnreadService } from '../../unread/unread.service';

export interface GroupFanoutJobData {
  messageId: string;
  groupId: string;
  senderUserId: string;
  senderDeviceId: string;
  // C6 fix: per-device envelopes for normal sends. The forward path instead
  // supplies a single group-key `ciphertext` (see below), so this is optional.
  envelopes?: Array<{ recipientDeviceId: string; senderUserId: string; ciphertext: unknown }>;
  // Forward path: one opaque group-key-encrypted payload replicated to every
  // member device (there are no per-device envelopes for a forward).
  ciphertext?: unknown;
  threadSequence: number;
  replyToMessageId: string | null;
  contentType?: string;
  createdAt: string;
  mediaIds: string[];
  forwarded?: boolean;
}

@Processor('group-fanout', { concurrency: 5 })
export class GroupFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupFanoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly queueMetrics: QueueMetrics,
    private readonly unreadService: UnreadService,
  ) {
    super();
  }

  async process(job: Job<GroupFanoutJobData>): Promise<{ fannedOutTo: number }> {
    const { messageId, groupId, senderUserId, senderDeviceId, envelopes, ciphertext, threadSequence, replyToMessageId, contentType, createdAt, mediaIds, forwarded } = job.data;

    // 1. Fetch all active devices for group members in a single query
    const activeDevices = await this.prisma.device.findMany({
      where: {
        user: {
          groupMembers: { some: { groupId } },
        },
        active: true,
      },
      select: { id: true, userId: true },
    });

    // 2. Exclude the sender's current device to prevent reflecting the message back to the sending client
    const targetDevices = activeDevices.filter((device) => device.id !== senderDeviceId);

    if (targetDevices.length === 0) {
      return { fannedOutTo: 0 };
    }

    // 3. Build per-device ciphertexts.
    //    - Normal send: use the per-device envelopes the sender provided (C6).
    //    - Forward: no per-device envelopes exist; replicate the single opaque
    //      group-key `ciphertext` to every member device. (Without this fallback
    //      forwarded group messages produced zero envelopes and were never delivered.)
    let envelopeData: Array<{
      messageId: string;
      recipientUserId: string;
      recipientDeviceId: string;
      ciphertext: Prisma.InputJsonValue;
      status: 'PENDING';
    }>;

    if (envelopes && envelopes.length > 0) {
      const envelopeMap = new Map<string, unknown>();
      for (const env of envelopes) {
        if (env.recipientDeviceId !== senderDeviceId) {
          envelopeMap.set(env.recipientDeviceId, env.ciphertext);
        }
      }
      envelopeData = targetDevices
        .filter((device) => envelopeMap.has(device.id))
        .map((device) => ({
          messageId,
          recipientUserId: device.userId,
          recipientDeviceId: device.id,
          ciphertext: envelopeMap.get(device.id) as Prisma.InputJsonValue,
          status: 'PENDING' as const,
        }));
    } else if (ciphertext !== undefined && ciphertext !== null) {
      envelopeData = targetDevices.map((device) => ({
        messageId,
        recipientUserId: device.userId,
        recipientDeviceId: device.id,
        ciphertext: ciphertext as Prisma.InputJsonValue,
        status: 'PENDING' as const,
      }));
    } else {
      envelopeData = [];
    }

    // If the sender didn't provide envelopes for all group members (e.g., own-device sync),
    // we still need to insert them. For group members without a specific envelope,
    // we cannot encrypt for them — skip those devices.
    if (envelopeData.length === 0) {
      this.logger.warn(`No envelopes provided for any group member (message ${messageId})`);
      return { fannedOutTo: 0 };
    }

    // Chunk the insert: a large group can exceed Postgres' bind-parameter limit
    // in a single createMany, which would fail the whole job and drop delivery.
    // skipDuplicates makes re-inserts on retry a no-op.
    const CHUNK_SIZE = 500;
    for (let i = 0; i < envelopeData.length; i += CHUNK_SIZE) {
      const chunk = envelopeData.slice(i, i + CHUNK_SIZE);
      await this.prisma.messageEnvelope.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }

    // Exactly-once broadcast via an outbox marker. The envelope inserts above are
    // idempotent, but the realtime emit and push wakeup are not — a retry would
    // double-deliver. Flip Message.fannedOutAt from null→now atomically; only the
    // execution that wins the flip (count === 1) proceeds to emit. A retry (even
    // one that crashed between insert and emit on a prior attempt) re-inserts,
    // then wins the flip if it was never set, or sees count 0 and skips.
    const flip = await this.prisma.message.updateMany({
      where: { id: messageId, fannedOutAt: null },
      data: { fannedOutAt: new Date() },
    });
    if (flip.count === 0) {
      this.logger.warn(`Fanout for message ${messageId} already broadcast — skipping re-emit`);
      return { fannedOutTo: envelopeData.length };
    }

    // 3c. Fetch media for the event payload (cheap single query, ordered for client rendering)
    const media = mediaIds?.length
      ? await this.prisma.messageMedia.findMany({
          where: { id: { in: mediaIds } },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // 4. Construct message.created event payload from in-memory data (no DB round-trip)
    const messageEventPayload = {
      id: messageId,
      threadId: null,
      groupId,
      senderUserId,
      senderDeviceId,
      threadSequence,
      contentType: contentType ?? 'TEXT',
      replyToMessageId,
      forwarded: forwarded ?? false,
      createdAt,
      media,
      envelopes: envelopeData.map((env) => ({
        messageId: env.messageId,
        recipientUserId: env.recipientUserId,
        recipientDeviceId: env.recipientDeviceId,
        ciphertext: env.ciphertext,
        status: 'PENDING' as const,
        deliveredAt: null,
        readAt: null,
        createdAt,
        message: {
          id: messageId,
          threadId: null,
          groupId,
          senderUserId,
          senderDeviceId,
          threadSequence,
          contentType: contentType ?? 'TEXT',
          replyToMessageId,
          forwarded: forwarded ?? false,
          createdAt,
          media,
        },
      })),
    };

    // 5. Emit event to trigger realtime Socket.IO broadcasts and push notification wakeups
    this.events.emit('message.created', messageEventPayload);

    // 6. Enqueue unread counter recalc for each unique recipient (excluding sender)
    const recipientUserIds = [
      ...new Set(envelopeData.map((d) => d.recipientUserId).filter((uid) => uid !== senderUserId)),
    ];
    await Promise.all(
      recipientUserIds.map((uid) =>
        this.unreadService.enqueueRecalc({
          userId: uid,
          threadId: groupId,
          threadType: 'group',
          reason: 'new_message',
        }),
      ),
    );

    return { fannedOutTo: envelopeData.length };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<GroupFanoutJobData>) {
    this.queueMetrics.recordCompleted('group-fanout');
    this.logger.debug(`Fanout job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GroupFanoutJobData>, error: Error) {
    this.queueMetrics.recordFailed('group-fanout');
    this.logger.error(`Fanout job ${job.id} failed: ${error.message}`);
  }
}
