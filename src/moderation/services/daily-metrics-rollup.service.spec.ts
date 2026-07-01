import { PrismaService } from '../../prisma/prisma.service';
import { DailyMetricsRollupService } from './daily-metrics-rollup.service';

function makePrismaStub() {
  return {
    message: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      count: jest.fn().mockResolvedValue(0),
    },
    report: {
      count: jest.fn().mockResolvedValue(0),
    },
    userSuspension: {
      count: jest.fn().mockResolvedValue(0),
    },
    dailyMetric: {
      upsert: jest.fn().mockResolvedValue({ id: 'metric-1' }),
    },
    $transaction: jest.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('DailyMetricsRollupService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: DailyMetricsRollupService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaStub();
    service = new DailyMetricsRollupService(prisma as unknown as PrismaService);
  });

  it('rolls up one day into 7 daily metrics keyed by (date, kind, dimension=null)', async () => {
    prisma.message.groupBy.mockResolvedValueOnce([
      { groupId: null, _count: { _all: 12 } },
      { groupId: 'group-a', _count: { _all: 5 } },
      { groupId: 'group-b', _count: { _all: 3 } },
    ]);
    prisma.message.findMany.mockResolvedValueOnce([
      { senderUserId: 'u-1' },
      { senderUserId: 'u-2' },
    ]);
    prisma.user.count.mockResolvedValueOnce(4);
    prisma.report.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prisma.userSuspension.count.mockResolvedValueOnce(1);

    const result = await service.rollupDay(new Date('2026-06-01T12:34:56Z'));

    expect(result).toEqual({ date: '2026-06-01', written: 7 });
    expect(prisma.dailyMetric.upsert).toHaveBeenCalledTimes(7);

    const calls = (prisma.dailyMetric.upsert as jest.Mock).mock.calls;
    const seenKinds = calls.map((c) => c[0].where.date_kind_dimension.kind);
    expect(seenKinds).toEqual(
      expect.arrayContaining([
        'MESSAGES_SENT_DIRECT',
        'MESSAGES_SENT_GROUP',
        'DAU',
        'NEW_USERS',
        'REPORTS_OPENED',
        'REPORTS_RESOLVED',
        'USERS_SUSPENDED',
      ]),
    );

    for (const call of calls) {
      expect(call[0].where.date_kind_dimension.dimension).toBeNull();
    }

    const directCall = calls.find((c) => c[0].where.date_kind_dimension.kind === 'MESSAGES_SENT_DIRECT');
    expect(directCall[0].update.value).toBe(12);
    const groupCall = calls.find((c) => c[0].where.date_kind_dimension.kind === 'MESSAGES_SENT_GROUP');
    expect(groupCall[0].update.value).toBe(8);
    const dauCall = calls.find((c) => c[0].where.date_kind_dimension.kind === 'DAU');
    expect(dauCall[0].update.value).toBe(2);
    const newUsersCall = calls.find((c) => c[0].where.date_kind_dimension.kind === 'NEW_USERS');
    expect(newUsersCall[0].update.value).toBe(4);
    const openedCall = calls.find((c) => c[0].where.date_kind_dimension.kind === 'REPORTS_OPENED');
    expect(openedCall[0].update.value).toBe(2);
    const resolvedCall = calls.find((c) => c[0].where.date_kind_dimension.kind === 'REPORTS_RESOLVED');
    expect(resolvedCall[0].update.value).toBe(1);
    const suspendedCall = calls.find((c) => c[0].where.date_kind_dimension.kind === 'USERS_SUSPENDED');
    expect(suspendedCall[0].update.value).toBe(1);
  });

  it('normalises the date to UTC midnight before bucketing', async () => {
    await service.rollupDay(new Date('2026-06-01T23:59:59.999Z'));

    for (const call of (prisma.dailyMetric.upsert as jest.Mock).mock.calls) {
      const date: Date = call[0].where.date_kind_dimension.date;
      expect(date.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    }
  });

  it('returns zero counts for an empty day (still writes 7 rows)', async () => {
    const result = await service.rollupDay(new Date('2026-06-01T00:00:00Z'));
    expect(result.written).toBe(7);
    for (const call of (prisma.dailyMetric.upsert as jest.Mock).mock.calls) {
      expect(call[0].update.value).toBe(0);
    }
  });
});
