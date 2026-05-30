import { Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('group-fanout')
export class GroupFanoutProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { messageId, groupId, senderUserId, senderDeviceId, ciphertext, threadSequence, createdAt } = job.data;

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

    // 3. Batch-insert MessageEnvelope records (fire-and-forget — no need to return rows)
    await this.prisma.messageEnvelope.createMany({
      data: targetDevices.map((device) => ({
        messageId,
        recipientUserId: device.userId,
        recipientDeviceId: device.id,
        ciphertext: ciphertext as any,
        status: 'PENDING' as const,
      })),
      skipDuplicates: true,
    });

    // 4. Construct message.created event payload from in-memory data (no DB round-trip)
    const messageEventPayload = {
      id: messageId,
      threadId: null,
      groupId,
      senderUserId,
      senderDeviceId,
      threadSequence,
      createdAt,
      envelopes: targetDevices.map((device) => ({
        messageId,
        recipientUserId: device.userId,
        recipientDeviceId: device.id,
        ciphertext,
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
          createdAt,
        },
      })),
    };

    // 5. Emit event to trigger realtime Socket.IO broadcasts and push notification wakeups
    this.events.emit('message.created', messageEventPayload);

    return { fannedOutTo: targetDevices.length };
  }
}
