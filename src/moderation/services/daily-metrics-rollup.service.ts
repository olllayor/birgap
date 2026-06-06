import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

export type DailyRollupKind =
  | 'MESSAGES_SENT_DIRECT'
  | 'MESSAGES_SENT_GROUP'
  | 'DAU'
  | 'NEW_USERS'
  | 'REPORTS_OPENED'
  | 'REPORTS_RESOLVED'
  | 'USERS_SUSPENDED';

@Injectable()
export class DailyMetricsRollupService {
  private readonly logger = new Logger(DailyMetricsRollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 0 * * *', { timeZone: 'UTC' })
  async rollupYesterday() {
    const now = new Date();
    const yesterday = this.utcDayStart(this.subDays(now, 1));
    await this.rollupDay(yesterday);
  }

  async rollupDay(date: Date): Promise<{ date: string; written: number }> {
    const dayStart = this.utcDayStart(date);
    const dayEnd = this.addDays(dayStart, 1);
    const dateStr = this.toDateKey(dayStart);

    this.logger.log(`Rolling up daily metrics for ${dateStr}`);

    const messagesByChannel = await this.prisma.message.groupBy({
      by: ['groupId'],
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        deletedAt: null,
      },
      _count: { _all: true },
    });

    const messagesDirect = messagesByChannel
      .filter((row) => row.groupId === null)
      .reduce((sum, row) => sum + row._count._all, 0);
    const messagesGroup = messagesByChannel
      .filter((row) => row.groupId !== null)
      .reduce((sum, row) => sum + row._count._all, 0);

    const dau = await this.prisma.message.findMany({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        deletedAt: null,
      },
      select: { senderUserId: true },
      distinct: ['senderUserId'],
    });
    const dauCount = dau.length;

    const newUsers = await this.prisma.user.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });

    const reportsOpened = await this.prisma.report.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });

    const reportsResolved = await this.prisma.report.count({
      where: {
        reviewedAt: { gte: dayStart, lt: dayEnd },
      },
    });

    const usersSuspended = await this.prisma.userSuspension.count({
      where: {
        suspendedAt: { gte: dayStart, lt: dayEnd },
      },
    });

    const rows: Array<{ kind: DailyRollupKind; value: number }> = [
      { kind: 'MESSAGES_SENT_DIRECT', value: messagesDirect },
      { kind: 'MESSAGES_SENT_GROUP', value: messagesGroup },
      { kind: 'DAU', value: dauCount },
      { kind: 'NEW_USERS', value: newUsers },
      { kind: 'REPORTS_OPENED', value: reportsOpened },
      { kind: 'REPORTS_RESOLVED', value: reportsResolved },
      { kind: 'USERS_SUSPENDED', value: usersSuspended },
    ];

    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.dailyMetric.upsert({
          where: {
            date_kind_dimension: {
              date: dayStart,
              kind: row.kind,
              // dimension is nullable; Prisma's generated input type doesn't allow null here
              // (see https://github.com/prisma/prisma/issues/16976). Cast is safe because the
              // unique index includes the column and PG treats NULL distinctly.
              dimension: null as unknown as string,
            },
          },
          update: { value: row.value },
          create: {
            date: dayStart,
            kind: row.kind,
            dimension: null,
            value: row.value,
          },
        }),
      ),
    );

    this.logger.log(
      `Daily metrics for ${dateStr} rolled up: ${rows
        .map((r) => `${r.kind}=${r.value}`)
        .join(' ')}`,
    );

    return { date: dateStr, written: rows.length };
  }

  private utcDayStart(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private addDays(d: Date, n: number): Date {
    return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
  }

  private subDays(d: Date, n: number): Date {
    return this.addDays(d, -n);
  }

  private toDateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
