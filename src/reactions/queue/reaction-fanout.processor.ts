import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { QueueMetrics } from '../../metrics/queue.metrics';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReactionFanoutJobData } from './reaction-fanout-job.interface';

@Processor('reaction-fanout', { concurrency: 5 })
export class ReactionFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(ReactionFanoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly redis: RedisService,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<ReactionFanoutJobData>): Promise<{ fannedOutTo: number }> {
    const { messageId, groupId, userId, emoji, createdAt, type, reactionId } = job.data;

    let memberIds = await this.redis.getGroupMemberIds(groupId);
    if (!memberIds) {
      const members = await this.prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      memberIds = members.map((m) => m.userId);
      this.redis.setGroupMemberIds(groupId, memberIds).catch(() => {});
    }

    const targetUserIds = memberIds.filter((id) => id !== userId);

    if (targetUserIds.length === 0) {
      return { fannedOutTo: 0 };
    }

    const eventName = type === 'created' ? 'reaction.created' : 'reaction.removed';
    const payload = {
      reactionId,
      messageId,
      groupId,
      userId,
      emoji,
      createdAt,
      targetUserIds,
    };

    this.events.emit(eventName, payload);

    return { fannedOutTo: targetUserIds.length };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ReactionFanoutJobData>) {
    this.queueMetrics.recordCompleted('reaction-fanout');
    this.logger.debug(`Reaction fanout job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ReactionFanoutJobData>, error: Error) {
    this.queueMetrics.recordFailed('reaction-fanout');
    this.logger.error(`Reaction fanout job ${job.id} failed: ${error.message}`);
  }
}
