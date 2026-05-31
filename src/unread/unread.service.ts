import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { UnreadRecalcJobData } from './queue/unread-recalc-job.interface';

@Injectable()
export class UnreadService {
  constructor(
    @InjectQueue('unread-recalc')
    private readonly unreadQueue: Queue<UnreadRecalcJobData>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueRecalc(data: UnreadRecalcJobData) {
    await this.unreadQueue.add('recalc', data, {
      jobId: `${data.userId}:${data.threadType}:${data.threadId}`,
      delay: 500,
      removeOnComplete: true,
    });
  }

  async getCounts(userId: string) {
    return this.prisma.unreadCounter.findMany({
      where: { userId },
      select: { threadType: true, threadId: true, count: true },
    });
  }

  async markAllRead(userId: string, threadId: string, threadType: 'direct' | 'group') {
    await this.prisma.$transaction(async (tx) => {
      await tx.messageEnvelope.updateMany({
        where: {
          recipientUserId: userId,
          message:
            threadType === 'direct'
              ? { threadId }
              : { groupId: threadId },
          status: { not: 'READ' },
        },
        data: { status: 'READ', readAt: new Date() },
      });

      await tx.unreadCounter.upsert({
        where: { userId_threadType_threadId: { userId, threadType, threadId } },
        update: { count: 0 },
        create: { userId, threadType, threadId, count: 0 },
      });
    });
  }
}
