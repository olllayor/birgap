import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AckMessageDto } from './dto/ack-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { canonicalDirectPair } from './thread.util';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async send(senderUserId: string, dto: SendMessageDto) {
    const existing = await this.prisma.message.findUnique({
      where: {
        senderDeviceId_idempotencyKey: {
          senderDeviceId: dto.senderDeviceId,
          idempotencyKey: dto.idempotencyKey,
        },
      },
      include: { envelopes: true },
    });

    if (existing) {
      return this.serializeMessage(existing);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const allDevices = await tx.device.findMany({
          where: {
            active: true,
            OR: [
              { id: dto.senderDeviceId },
              { userId: dto.recipientUserId },
              { userId: senderUserId, id: { not: dto.senderDeviceId } },
            ],
          },
          select: { id: true, userId: true },
        });

        const senderDevice = allDevices.find((d) => d.id === dto.senderDeviceId);
        if (!senderDevice || senderDevice.userId !== senderUserId) {
          throw new ForbiddenException('Sender device is not active for this user');
        }
        if (senderUserId === dto.recipientUserId) {
          throw new BadRequestException('Recipient must be another user');
        }

        const recipientDevices = allDevices.filter((d) => d.userId === dto.recipientUserId);
        if (recipientDevices.length === 0) {
          throw new NotFoundException('Recipient has no active devices');
        }

        const senderSyncDeviceIds = new Set(
          allDevices.filter((d) => d.userId === senderUserId && d.id !== dto.senderDeviceId).map((d) => d.id),
        );
        const recipientDeviceIds = new Set(recipientDevices.map((device) => device.id));
        const allowedDeviceIds = new Set([...recipientDeviceIds, ...senderSyncDeviceIds]);
        const envelopeDeviceIds = new Set(dto.envelopes.map((envelope) => envelope.recipientDeviceId));

        for (const deviceId of recipientDeviceIds) {
          if (!envelopeDeviceIds.has(deviceId)) {
            throw new BadRequestException('Missing envelope for active recipient device');
          }
        }

        for (const envelope of dto.envelopes) {
          if (!allowedDeviceIds.has(envelope.recipientDeviceId)) {
            throw new BadRequestException('Envelope recipient device is not part of this direct message');
          }
        }

        const [userAId, userBId] = canonicalDirectPair(senderUserId, dto.recipientUserId);
        const thread = await tx.directThread.upsert({
          where: { userAId_userBId: { userAId, userBId } },
          update: {},
          create: { userAId, userBId },
        });
        const sequencedThread = await tx.directThread.update({
          where: { id: thread.id },
          data: { latestSequence: { increment: 1 } },
        });

        const message = await tx.message.create({
          data: {
            threadId: thread.id,
            senderUserId,
            senderDeviceId: dto.senderDeviceId,
            idempotencyKey: dto.idempotencyKey,
            threadSequence: sequencedThread.latestSequence,
            envelopes: {
              create: dto.envelopes.map((envelope) => {
                const isRecipientDevice = recipientDeviceIds.has(envelope.recipientDeviceId);
                return {
                  recipientUserId: isRecipientDevice ? dto.recipientUserId : senderUserId,
                  recipientDeviceId: envelope.recipientDeviceId,
                  ciphertext: envelope.ciphertext as Prisma.InputJsonValue,
                };
              }),
            },
          },
          include: { envelopes: true },
        });

        return message;
      });

      this.events.emit('message.created', this.serializeMessage(created));
      return this.serializeMessage(created);
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const duplicate = await this.prisma.message.findUnique({
          where: {
            senderDeviceId_idempotencyKey: {
              senderDeviceId: dto.senderDeviceId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          include: { envelopes: true },
        });
        if (duplicate) {
          return this.serializeMessage(duplicate);
        }
      }
      throw error;
    }
  }

  async getPending(userId: string, deviceId: string, after?: string, limit = 50) {
    await this.assertActiveDevice(userId, deviceId);

    const envelopes = await this.prisma.messageEnvelope.findMany({
      where: {
        recipientDeviceId: deviceId,
        status: { in: ['PENDING', 'DELIVERED'] },
        ...(after && { envelopeSequence: { gt: BigInt(after) } }),
      },
      orderBy: { envelopeSequence: 'asc' },
      take: limit,
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

    return {
      deviceId,
      envelopes,
      hasMore: envelopes.length === limit,
    };
  }

  async ack(userId: string, messageId: string, dto: AckMessageDto) {
    await this.assertActiveDevice(userId, dto.deviceId);

    const envelope = await this.prisma.messageEnvelope.findUnique({
      where: { messageId_recipientDeviceId: { messageId, recipientDeviceId: dto.deviceId } },
    });
    if (!envelope || envelope.recipientUserId !== userId) {
      throw new NotFoundException('Message envelope not found for device');
    }

    const now = new Date();
    const data =
      dto.status === 'READ'
        ? { status: 'READ' as const, deliveredAt: envelope.deliveredAt ?? now, readAt: now }
        : { status: 'DELIVERED' as const, deliveredAt: envelope.deliveredAt ?? now };

    const updated = await this.prisma.messageEnvelope.update({
      where: { messageId_recipientDeviceId: { messageId, recipientDeviceId: dto.deviceId } },
      data,
      include: {
        message: {
          select: {
            senderUserId: true,
            senderDeviceId: true,
            threadId: true,
            groupId: true,
            threadSequence: true,
          },
        },
      },
    });

    this.events.emit('message.ack', {
      messageId,
      deviceId: dto.deviceId,
      userId,
      status: updated.status,
      threadId: updated.message.threadId,
      groupId: updated.message.groupId,
      threadSequence: updated.message.threadSequence,
      senderUserId: updated.message.senderUserId,
      senderDeviceId: updated.message.senderDeviceId,
    });

    return updated;
  }

  private async assertActiveDevice(userId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId, active: true },
    });
    if (!device) {
      throw new ForbiddenException('Device is not active for this user');
    }
  }

  private serializeMessage(message: {
    id: string;
    threadId: string | null;
    groupId?: string | null;
    senderUserId: string;
    senderDeviceId: string;
    threadSequence: number;
    createdAt: Date;
    envelopes: unknown[];
  }) {
    return {
      id: message.id,
      threadId: message.threadId,
      groupId: message.groupId ?? null,
      senderUserId: message.senderUserId,
      senderDeviceId: message.senderDeviceId,
      threadSequence: message.threadSequence,
      createdAt: message.createdAt,
      envelopes: message.envelopes,
    };
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
