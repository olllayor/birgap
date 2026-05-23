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
    const { messageId, groupId, senderUserId, senderDeviceId, ciphertext } = job.data;

    // 1. Fetch all members of the group
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    const memberUserIds = members.map((m) => m.userId);

    // 2. Fetch all active devices for all members
    const activeDevices = await this.prisma.device.findMany({
      where: {
        userId: { in: memberUserIds },
        active: true,
      },
      select: { id: true, userId: true },
    });

    // 3. Exclude the sender's current device to prevent reflecting the message back to the sending client
    const targetDevices = activeDevices.filter((device) => device.id !== senderDeviceId);

    if (targetDevices.length > 0) {
      // 4. Batch-insert MessageEnvelope records
      await this.prisma.messageEnvelope.createMany({
        data: targetDevices.map((device) => ({
          messageId,
          recipientUserId: device.userId,
          recipientDeviceId: device.id,
          ciphertext: ciphertext as any,
          status: 'PENDING',
        })),
        skipDuplicates: true,
      });
    }

    // 5. Fetch the parent message and created envelopes to construct a fully compatible message.created event payload
    const createdEnvelopes = await this.prisma.messageEnvelope.findMany({
      where: { messageId },
      include: {
        message: {
          select: {
            id: true,
            threadId: true,
            groupId: true,
            senderUserId: true,
            senderDeviceId: true,
            threadSequence: true,
            createdAt: true,
          },
        },
      },
    });

    if (createdEnvelopes.length > 0) {
      const parentMsg = createdEnvelopes[0].message;
      const messageEventPayload = {
        id: messageId,
        threadId: null,
        groupId,
        senderUserId,
        senderDeviceId,
        threadSequence: parentMsg.threadSequence,
        createdAt: parentMsg.createdAt,
        envelopes: createdEnvelopes.map((env) => ({
          id: env.id,
          messageId: env.messageId,
          recipientUserId: env.recipientUserId,
          recipientDeviceId: env.recipientDeviceId,
          ciphertext: env.ciphertext,
          status: env.status,
          deliveredAt: env.deliveredAt,
          readAt: env.readAt,
          envelopeSequence: env.envelopeSequence.toString(), // JSON-safe string for BigInt
          createdAt: env.createdAt,
          message: {
            id: parentMsg.id,
            threadId: parentMsg.threadId,
            groupId: parentMsg.groupId,
            senderUserId: parentMsg.senderUserId,
            senderDeviceId: parentMsg.senderDeviceId,
            threadSequence: parentMsg.threadSequence,
            createdAt: parentMsg.createdAt,
          },
        })),
      };

      // 6. Emit event to trigger realtime Socket.IO broadcasts and push notification wakeups
      this.events.emit('message.created', messageEventPayload);
    }

    return { fannedOutTo: targetDevices.length };
  }
}
