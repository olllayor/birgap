import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async series(query: AnalyticsQueryDto) {
    const now = new Date();
    const days = query.days ?? 30;
    const to = query.to ? new Date(query.to) : now;
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    const fromDate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const toDate = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

    const where: Prisma.DailyMetricWhereInput = {
      kind: query.kind,
      date: { gte: fromDate, lte: toDate },
      ...(query.dimension !== undefined && { dimension: query.dimension }),
    };

    const rows = await this.prisma.dailyMetric.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    return {
      kind: query.kind,
      dimension: query.dimension ?? null,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      series: rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        value: r.value,
      })),
    };
  }
}
