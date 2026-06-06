import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

@Injectable()
export class SuspensionReactivationService {
  private readonly logger = new Logger(SuspensionReactivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  @Cron('45 0 * * *', { timeZone: 'UTC' })
  async reactivateExpired() {
    await this.run(new Date());
  }

  async run(now: Date): Promise<{ reactivated: number }> {
    const expired = await this.prisma.userSuspension.findMany({
      where: {
        revokedAt: null,
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, userId: true, expiresAt: true },
    });

    if (expired.length === 0) {
      this.logger.debug('No expired suspensions to reactivate');
      return { reactivated: 0 };
    }

    let reactivated = 0;
    for (const suspension of expired) {
      try {
        await this.reactivateOne(suspension.id, suspension.userId, suspension.expiresAt!, now);
        reactivated += 1;
      } catch (error) {
        this.logger.error(
          `Failed to auto-reactivate user ${suspension.userId} (suspension ${suspension.id}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(`Auto-reactivated ${reactivated}/${expired.length} expired suspensions`);
    return { reactivated };
  }

  private async reactivateOne(
    suspensionId: string,
    userId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userSuspension.update({
        where: { id: suspensionId },
        data: {
          revokedAt: now,
          revokedByUserId: null,
          revokeReason: 'auto: expired',
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.ACTIVE },
      });

      await this.audit.write(
        {
          actorUserId: null,
          action: 'USER_UNSUSPEND',
          targetType: 'USER',
          targetId: userId,
          reason: 'auto: expired',
          metadata: {
            source: 'auto-reactivation',
            suspensionId,
            expiresAt: expiresAt.toISOString(),
          },
        },
        tx,
      );
    });
  }
}
