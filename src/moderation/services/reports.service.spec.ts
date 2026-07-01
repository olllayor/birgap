import { ConfigService } from '@nestjs/config';
import { ReportReason, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from './audit-log.service';
import { ReportsService } from './reports.service';

const mockConfig = {
  get: jest.fn().mockImplementation((key: string, fallback: number) => fallback),
} as unknown as ConfigService;

function buildPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
    },
    message: {
      findUnique: jest.fn(),
    },
    groupMember: {
      findUnique: jest.fn(),
    },
    report: {
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
}

function buildRedis() {
  return {
    client: {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    },
  } as unknown as RedisService;
}

describe('ReportsService.create', () => {
  it('rejects a suspended reporter', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'SUSPENDED', role: 'USER' });
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      buildRedis(),
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await expect(
      service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM }),
    ).rejects.toThrow(/suspended/i);
  });

  it('rejects when reporter is the message sender', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: 'USER' });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-1',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-1', userBId: 'u-2' },
    });
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      buildRedis(),
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await expect(
      service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM }),
    ).rejects.toThrow(/your own/i);
  });

  it('rejects when reporter is not a thread participant in a direct thread', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: 'USER' });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-2', userBId: 'u-3' },
    });
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      buildRedis(),
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await expect(
      service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM }),
    ).rejects.toThrow(/thread participants/i);
  });

  it('rejects when reporter is not a group member', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: 'USER' });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: null,
      groupId: 'g-1',
      deletedAt: null,
      thread: null,
    });
    (prisma.groupMember.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      buildRedis(),
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await expect(
      service.create('u-1', { messageId: 'm-1', reason: ReportReason.HARASSMENT }),
    ).rejects.toThrow(/group members/i);
  });

  it('rejects reports against already-deleted messages', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: 'USER' });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: new Date(),
      thread: { userAId: 'u-1', userBId: 'u-2' },
    });
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      buildRedis(),
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await expect(
      service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM }),
    ).rejects.toThrow(/deleted/i);
  });

  it('blocks USER at the daily limit but exempts MODERATOR', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'ACTIVE', role: UserRole.USER });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-1', userBId: 'u-2' },
    });

    const redis = buildRedis();
    (redis.client.incr as jest.Mock).mockResolvedValue(201);

    const service = new ReportsService(
      prisma as unknown as PrismaService,
      redis,
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await expect(
      service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM }),
    ).rejects.toThrow(/limit/i);

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'ACTIVE', role: UserRole.MODERATOR });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-9', userBId: 'u-2' },
    });
    const now = new Date();
    (prisma.report.upsert as jest.Mock).mockResolvedValue({
      id: 'rep-1',
      createdAt: now,
      updatedAt: now,
    });
    const result = await service.create('u-9', { messageId: 'm-1', reason: ReportReason.SPAM });
    expect(result).toEqual({ id: 'rep-1', createdAt: now, updatedAt: now });
  });

  it('upserts the report idempotently on (reporter, message)', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: UserRole.USER });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-1', userBId: 'u-2' },
    });
    const now = new Date();
    (prisma.report.upsert as jest.Mock).mockResolvedValue({
      id: 'rep-1',
      createdAt: now,
      updatedAt: now,
    });

    const service = new ReportsService(
      prisma as unknown as PrismaService,
      buildRedis(),
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM, freeText: 'spam' });

    expect(prisma.report.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reporterUserId_messageId: { reporterUserId: 'u-1', messageId: 'm-1' } },
        create: expect.objectContaining({ reason: ReportReason.SPAM, freeText: 'spam' }),
      }),
    );
  });

  it('rejects USER at the IP rate limit (50/min by default) but exempts MODERATOR', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    (redis.client.incr as jest.Mock).mockImplementation((key: string) => {
      if (key.startsWith('reports:ip:')) return Promise.resolve(51);
      return Promise.resolve(1);
    });

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: UserRole.USER });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-1', userBId: 'u-2' },
    });

    const service = new ReportsService(
      prisma as unknown as PrismaService,
      redis,
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await expect(
      service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM }, '203.0.113.42'),
    ).rejects.toThrow(/Report rate limit of 50\/minute/);

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: UserRole.MODERATOR });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-2',
      senderUserId: 'u-9',
      threadId: 't-9',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'mod-1', userBId: 'u-9' },
    });
    const now = new Date();
    (prisma.report.upsert as jest.Mock).mockResolvedValue({
      id: 'rep-1',
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.create(
      'mod-1',
      { messageId: 'm-2', reason: ReportReason.SPAM },
      '203.0.113.42',
    );
    expect(result.id).toBe('rep-1');
  });

  it('skips the IP rate limit when no IP is passed (caller has not opted in)', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: UserRole.USER });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-1', userBId: 'u-2' },
    });
    const now = new Date();
    (prisma.report.upsert as jest.Mock).mockResolvedValue({
      id: 'rep-1',
      createdAt: now,
      updatedAt: now,
    });

    const service = new ReportsService(
      prisma as unknown as PrismaService,
      redis,
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM });

    const incrCalls = (redis.client.incr as jest.Mock).mock.calls.map((c) => c[0]);
    expect(incrCalls.some((k) => String(k).startsWith('reports:ip:'))).toBe(false);
  });

  it('uses a per-minute Redis key for the IP rate limit and sets a 90s TTL on the first hit', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', role: UserRole.USER });
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
      thread: { userAId: 'u-1', userBId: 'u-2' },
    });
    const now = new Date();
    (prisma.report.upsert as jest.Mock).mockResolvedValue({
      id: 'rep-1',
      createdAt: now,
      updatedAt: now,
    });

    const service = new ReportsService(
      prisma as unknown as PrismaService,
      redis,
      {} as unknown as AuditLogService,
      mockConfig,
    );

    await service.create('u-1', { messageId: 'm-1', reason: ReportReason.SPAM }, '198.51.100.7');

    const ipCall = (redis.client.incr as jest.Mock).mock.calls.find(
      (c) => String(c[0]).startsWith('reports:ip:198.51.100.7:'),
    );
    expect(ipCall).toBeDefined();
    expect(redis.client.expire).toHaveBeenCalledWith(ipCall[0], 90);
  });
});
