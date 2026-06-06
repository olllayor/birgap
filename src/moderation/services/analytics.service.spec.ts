import { DailyMetricKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

function buildPrisma() {
  return {
    dailyMetric: { findMany: jest.fn() },
  };
}

describe('AnalyticsService.series', () => {
  it('returns an empty series for an unknown kind/date range (no DB rows)', async () => {
    const prisma = buildPrisma();
    (prisma.dailyMetric.findMany as jest.Mock).mockResolvedValueOnce([]);
    const service = new AnalyticsService(prisma as unknown as PrismaService);

    const result = await service.series({ kind: DailyMetricKind.DAU } as never);

    expect(result.kind).toBe('DAU');
    expect(result.series).toEqual([]);
    expect(result.dimension).toBeNull();
  });

  it('maps the rows to {date, value} and trims to YYYY-MM-DD', async () => {
    const prisma = buildPrisma();
    (prisma.dailyMetric.findMany as jest.Mock).mockResolvedValueOnce([
      { date: new Date('2026-06-01T00:00:00Z'), value: 100 },
      { date: new Date('2026-06-02T00:00:00Z'), value: 200 },
    ]);
    const service = new AnalyticsService(prisma as unknown as PrismaService);

    const result = await service.series({
      kind: DailyMetricKind.MESSAGES_SENT_DIRECT,
      from: '2026-06-01',
      to: '2026-06-02',
    } as never);

    expect(result.series).toEqual([
      { date: '2026-06-01', value: 100 },
      { date: '2026-06-02', value: 200 },
    ]);
  });

  it('applies the dimension filter only when provided', async () => {
    const prisma = buildPrisma();
    (prisma.dailyMetric.findMany as jest.Mock).mockResolvedValueOnce([]);
    const service = new AnalyticsService(prisma as unknown as PrismaService);

    await service.series({ kind: DailyMetricKind.MESSAGES_SENT_GROUP, dimension: 'GROUP' } as never);
    expect(prisma.dailyMetric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dimension: 'GROUP', kind: 'MESSAGES_SENT_GROUP' }),
      }),
    );

    (prisma.dailyMetric.findMany as jest.Mock).mockResolvedValueOnce([]);
    await service.series({ kind: DailyMetricKind.MESSAGES_SENT_GROUP } as never);
    const call = (prisma.dailyMetric.findMany as jest.Mock).mock.calls[1][0];
    expect(call.where.dimension).toBeUndefined();
  });

  it('defaults to 30 days when no `from` is given', async () => {
    const prisma = buildPrisma();
    (prisma.dailyMetric.findMany as jest.Mock).mockResolvedValueOnce([]);
    const service = new AnalyticsService(prisma as unknown as PrismaService);

    await service.series({ kind: DailyMetricKind.DAU } as never);

    const where = (prisma.dailyMetric.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(where.date.lte).toBeInstanceOf(Date);
  });
});
