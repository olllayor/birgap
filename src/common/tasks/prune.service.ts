import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpStatus } from '@prisma/client';

@Injectable()
export class PruneService {
  private readonly logger = new Logger(PruneService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Run daily at 03:00 AM
  @Cron('0 3 * * *')
  async pruneDatabase() {
    this.logger.log('Starting daily database pruning...');
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Delete expired or revoked refresh tokens
        const tokensResult = await tx.refreshToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { revokedAt: { not: null } },
            ],
          },
        });

        // Delete expired or consumed socket tickets
        const ticketsResult = await tx.socketTicket.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { consumedAt: { not: null } },
            ],
          },
        });

        // Delete expired or used OTPs
        const otpsResult = await tx.otp.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { status: OtpStatus.USED },
            ],
          },
        });

        // Delete ancient SMS reports (older than 30 days)
        const smsResult = await tx.smsReport.deleteMany({
          where: {
            createdAt: { lt: thirtyDaysAgo },
          },
        });

        this.logger.log(
          `Pruning completed successfully: ` +
            `Pruned ${tokensResult.count} refresh tokens, ` +
            `${ticketsResult.count} socket tickets, ` +
            `${otpsResult.count} OTPs, and ` +
            `${smsResult.count} SMS reports.`,
        );
      });
    } catch (error) {
      this.logger.error(
        `Database pruning failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
