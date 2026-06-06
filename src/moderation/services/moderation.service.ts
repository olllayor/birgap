import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, ReportStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from './audit-log.service';
import { SuspendUserDto } from '../dto/suspend-user.dto';
import { UnsuspendUserDto } from '../dto/unsuspend-user.dto';
import { TombstoneMessageDto } from '../dto/tombstone-message.dto';

const REALTIME_USER_KICKED_CHANNEL = 'realtime:user-kicked';
const REALTIME_MESSAGE_TOMBSTONED_CHANNEL = 'realtime:message-tombstoned';

interface KickMessage {
  userId: string;
  reason: 'SUSPENDED' | 'KICKED';
  at: string;
}

interface TombstonedMessage {
  messageId: string;
  threadId: string | null;
  groupId: string | null;
  senderUserId: string;
  scope: 'platform' | 'group';
  tombstonedBy: string;
  at: string;
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  async tombstoneMessage(
    actorUserId: string,
    actorRole: UserRole,
    messageId: string,
    dto: TombstoneMessageDto,
  ) {
    if (actorRole !== UserRole.MODERATOR && actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Moderator or admin role required');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderUserId: true, deletedAt: true, groupId: true, threadId: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.deletedAt) {
      throw new ConflictException('Message is already tombstoned');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const tombstonedAt = new Date();
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: tombstonedAt },
      });

      if (dto.reportId) {
        await this.cascadeCloseReports(tx, messageId, dto.reportId, actorUserId, 'AUTO_CLOSED_TOMBSTONED');
      } else {
        await tx.report.updateMany({
          where: { messageId, status: { in: [ReportStatus.OPEN, ReportStatus.IN_REVIEW] } },
          data: {
            status: ReportStatus.CLOSED,
            resolution: 'AUTO_CLOSED_TOMBSTONED',
            reviewedByUserId: actorUserId,
            reviewedAt: tombstonedAt,
          },
        });
      }

      await this.audit.write(
        {
          actorUserId,
          action: 'MESSAGE_TOMBSTONE',
          targetType: 'MESSAGE',
          targetId: messageId,
          reason: dto.reason,
          metadata: { scope: 'platform', reportId: dto.reportId ?? null },
        },
        tx,
      );

      return { tombstonedAt };
    });

    await this.emitTombstoned({
      messageId,
      threadId: message.threadId,
      groupId: message.groupId,
      senderUserId: message.senderUserId,
      scope: 'platform',
      tombstonedBy: actorUserId,
      at: result.tombstonedAt.toISOString(),
    }).catch((error) => {
      this.logger.warn(`Failed to publish message-tombstoned event: ${error.message}`);
    });

    return { messageId, tombstonedAt: result.tombstonedAt };
  }

  async untombstoneMessage(actorUserId: string, actorRole: UserRole, messageId: string, reason?: string) {
    if (actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, deletedAt: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (!message.deletedAt) {
      throw new BadRequestException('Message is not tombstoned');
    }

    const restored = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: null },
      });
      await this.audit.write(
        {
          actorUserId,
          action: 'MESSAGE_UNTOMBSTONE',
          targetType: 'MESSAGE',
          targetId: messageId,
          reason,
        },
        tx,
      );
      return updated;
    });

    return restored;
  }

  async suspendUser(actorUserId: string, actorRole: UserRole, targetUserId: string, dto: SuspendUserDto) {
    if (actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required to suspend users');
    }
    if (targetUserId === actorUserId) {
      throw new BadRequestException('You cannot suspend yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true, role: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.role === UserRole.ADMIN) {
      throw new ForbiddenException('Cannot suspend an admin — demote first');
    }
    if (target.status === UserStatus.SUSPENDED) {
      throw new ConflictException('User is already suspended');
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const suspension = await tx.userSuspension.create({
        data: {
          userId: targetUserId,
          suspendedByUserId: actorUserId,
          reason: dto.reason ?? 'No reason provided',
          expiresAt,
        },
      });

      const now = new Date();
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          status: UserStatus.SUSPENDED,
          strikeCount: { increment: 1 },
          lastStrikeAt: now,
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      const nonDeletedMessages = await tx.message.findMany({
        where: { senderUserId: targetUserId, deletedAt: null },
        select: { id: true },
      });

      if (nonDeletedMessages.length > 0) {
        const tombstonedAt = new Date();
        await tx.message.updateMany({
          where: { id: { in: nonDeletedMessages.map((m) => m.id) } },
          data: { deletedAt: tombstonedAt },
        });

        await tx.report.updateMany({
          where: { messageId: { in: nonDeletedMessages.map((m) => m.id) }, status: { in: [ReportStatus.OPEN, ReportStatus.IN_REVIEW] } },
          data: {
            status: ReportStatus.CLOSED,
            resolution: 'AUTO_CLOSED_SUSPENDED',
            reviewedByUserId: actorUserId,
            reviewedAt: tombstonedAt,
          },
        });

        for (const messageId of nonDeletedMessages.map((m) => m.id)) {
          await this.audit.write(
            {
              actorUserId,
              action: 'MESSAGE_TOMBSTONE',
              targetType: 'MESSAGE',
              targetId: messageId,
              metadata: { scope: 'platform', cascadeFrom: 'USER_SUSPEND', suspensionId: suspension.id },
            },
            tx,
          );
        }
      }

      if (dto.reportId) {
        const report = await tx.report.findUnique({
          where: { id: dto.reportId },
          select: { messageId: true, status: true },
        });
        if (report && (report.status === ReportStatus.OPEN || report.status === ReportStatus.IN_REVIEW)) {
          await tx.report.update({
            where: { id: dto.reportId },
            data: {
              status: ReportStatus.CLOSED,
              resolution: 'AUTO_CLOSED_SUSPENDED',
              reviewedByUserId: actorUserId,
              reviewedAt: new Date(),
            },
          });
        }
      }

      await this.audit.write(
        {
          actorUserId,
          action: 'USER_SUSPEND',
          targetType: 'USER',
          targetId: targetUserId,
          reason: dto.reason,
          metadata: {
            suspensionId: suspension.id,
            expiresAt: expiresAt?.toISOString() ?? null,
            tombstonedMessageCount: nonDeletedMessages.length,
            reportId: dto.reportId ?? null,
          },
        },
        tx,
      );

      return { suspensionId: suspension.id, tombstonedMessageCount: nonDeletedMessages.length };
    });

    await this.emitUserKicked({
      userId: targetUserId,
      reason: 'SUSPENDED',
      at: new Date().toISOString(),
    }).catch((error) => {
      this.logger.warn(`Failed to publish user-kicked event: ${error.message}`);
    });

    return { suspensionId: result.suspensionId, tombstonedMessageCount: result.tombstonedMessageCount };
  }

  async resetStrikes(actorUserId: string, actorRole: UserRole, targetUserId: string, reason: string) {
    if (actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required to reset strikes');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, strikeCount: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.strikeCount === 0) {
      throw new BadRequestException('User has no strikes to reset');
    }

    const previousCount = target.strikeCount;
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: { strikeCount: 0, lastStrikeAt: null },
        select: { id: true, strikeCount: true },
      });
      await this.audit.write({
        actorUserId,
        action: 'STRIKE_RESET',
        targetType: 'USER',
        targetId: targetUserId,
        reason,
        metadata: { previousCount },
      });
      return u;
    });

    return result;
  }

  async unsuspendUser(actorUserId: string, actorRole: UserRole, targetUserId: string, dto: UnsuspendUserDto) {
    if (actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required to unsuspend users');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.status !== UserStatus.SUSPENDED) {
      throw new BadRequestException('User is not suspended');
    }

    const active = await this.prisma.userSuspension.findFirst({
      where: { userId: targetUserId, revokedAt: null },
      orderBy: { suspendedAt: 'desc' },
    });
    if (!active) {
      throw new BadRequestException('No active suspension found');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.userSuspension.update({
        where: { id: active.id },
        data: {
          revokedAt: new Date(),
          revokedByUserId: actorUserId,
          revokeReason: dto.reason,
        },
      });
      await tx.user.update({
        where: { id: targetUserId },
        data: { status: UserStatus.ACTIVE },
      });
      await this.audit.write({
        actorUserId,
        action: 'USER_UNSUSPEND',
        targetType: 'USER',
        targetId: targetUserId,
        reason: dto.reason,
        metadata: { suspensionId: active.id },
      });
      return active.id;
    });

    return { suspensionId: result };
  }

  async listSuspensions(targetUserId: string, limit: number) {
    return this.prisma.userSuspension.findMany({
      where: { userId: targetUserId },
      orderBy: { suspendedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        suspendedBy: { select: { id: true, username: true } },
        revokedBy: { select: { id: true, username: true } },
      },
    });
  }

  async getActiveSuspension(targetUserId: string) {
    return this.prisma.userSuspension.findFirst({
      where: { userId: targetUserId, revokedAt: null },
      orderBy: { suspendedAt: 'desc' },
    });
  }

  async changeUserRole(actorUserId: string, actorRole: UserRole, targetUserId: string, newRole: UserRole, reason?: string) {
    if (actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required to change user roles');
    }
    if (newRole !== UserRole.USER && newRole !== UserRole.MODERATOR && newRole !== UserRole.ADMIN) {
      throw new BadRequestException('Invalid target role');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, status: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.status === UserStatus.SUSPENDED && newRole !== UserRole.USER) {
      throw new BadRequestException('Cannot promote a suspended user — unsuspend first');
    }

    const action: 'ROLE_PROMOTE' | 'ROLE_DEMOTE' =
      this.roleRank(newRole) > this.roleRank(target.role) ? 'ROLE_PROMOTE' : 'ROLE_DEMOTE';

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: { role: newRole },
        select: { id: true, role: true },
      });
      await this.audit.write({
        actorUserId,
        action,
        targetType: 'USER',
        targetId: targetUserId,
        reason,
        metadata: { from: target.role, to: newRole },
      });
      return u;
    });

    return updated;
  }

  private roleRank(role: UserRole): number {
    return role === UserRole.ADMIN ? 2 : role === UserRole.MODERATOR ? 1 : 0;
  }

  private async cascadeCloseReports(
    tx: Prisma.TransactionClient,
    messageId: string,
    triggerReportId: string,
    actorUserId: string,
    resolution: 'AUTO_CLOSED_TOMBSTONED' | 'AUTO_CLOSED_SUSPENDED',
  ) {
    await tx.report.updateMany({
      where: { messageId, status: { in: [ReportStatus.OPEN, ReportStatus.IN_REVIEW] } },
      data: {
        status: ReportStatus.CLOSED,
        resolution,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    });

    await tx.report.update({
      where: { id: triggerReportId },
      data: {
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    });
  }

  private async emitUserKicked(message: KickMessage): Promise<void> {
    await this.redis.client.publish(REALTIME_USER_KICKED_CHANNEL, JSON.stringify(message));
  }

  private async emitTombstoned(message: TombstonedMessage): Promise<void> {
    await this.redis.client.publish(REALTIME_MESSAGE_TOMBSTONED_CHANNEL, JSON.stringify(message));
    this.events.emit('message.tombstoned.platform', message);
  }
}
