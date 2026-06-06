import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReportStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from './audit-log.service';
import { ModerationService } from './moderation.service';

function buildPrisma() {
  return {
    user: { findUnique: jest.fn() },
    message: { findUnique: jest.fn() },
    userSuspension: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: { updateMany: jest.fn() },
    report: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
    adminAuditLog: { create: jest.fn() },
  };
}

function buildRedis() {
  return {
    client: {
      publish: jest.fn().mockResolvedValue(1),
    },
  } as unknown as RedisService;
}

function buildAudit() {
  return { write: jest.fn().mockResolvedValue(undefined) };
}

describe('ModerationService.suspendUser', () => {
  it('rejects when actor is not admin', async () => {
    const service = new ModerationService(
      buildPrisma() as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(
      service.suspendUser('admin-1', UserRole.MODERATOR, 'u-target', { reason: 'spam' }),
    ).rejects.toThrow(/admin/i);
  });

  it('rejects self-suspension', async () => {
    const prisma = buildPrisma();
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(
      service.suspendUser('admin-1', UserRole.ADMIN, 'admin-1', { reason: 'spam' }),
    ).rejects.toThrow(/yourself/i);
  });

  it('rejects suspending another admin', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u-2',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(
      service.suspendUser('admin-1', UserRole.ADMIN, 'u-2', { reason: 'spam' }),
    ).rejects.toThrow(/cannot suspend an admin/i);
  });

  it('publishes realtime:user-kicked after commit', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u-target',
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    });
    (prisma.userSuspension.create as jest.Mock).mockResolvedValue({ id: 'susp-1' });
    (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

    const tx = {
      userSuspension: { create: jest.fn().mockResolvedValue({ id: 'susp-1' }) },
      user: { update: jest.fn() },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      message: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      report: { updateMany: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    const redis = buildRedis();
    const audit = buildAudit();
    const events = { emit: jest.fn() };
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      redis,
      audit as unknown as AuditLogService,
      events as unknown as EventEmitter2,
    );

    const result = await service.suspendUser('admin-1', UserRole.ADMIN, 'u-target', { reason: 'spam' });

    expect(result.suspensionId).toBe('susp-1');
    expect(redis.client.publish).toHaveBeenCalledWith(
      'realtime:user-kicked',
      expect.stringContaining('"userId":"u-target"'),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'USER_SUSPEND',
        targetType: 'USER',
        targetId: 'u-target',
      }),
      tx,
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-target' },
        data: expect.objectContaining({
          status: UserStatus.SUSPENDED,
          strikeCount: { increment: 1 },
          lastStrikeAt: expect.any(Date),
        }),
      }),
    );
  });

  it('refuses to suspend if already suspended', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u-target',
      role: UserRole.USER,
      status: UserStatus.SUSPENDED,
    });
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(
      service.suspendUser('admin-1', UserRole.ADMIN, 'u-target', { reason: 'spam' }),
    ).rejects.toThrow(/already suspended/i);
  });
});

describe('ModerationService.tombstoneMessage', () => {
  it('rejects when actor is below MODERATOR', async () => {
    const service = new ModerationService(
      buildPrisma() as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );
    await expect(
      service.tombstoneMessage('u-1', UserRole.USER, 'm-1', {}),
    ).rejects.toThrow(/moderator or admin/i);
  });

  it('refuses to tombstone an already-tombstoned message', async () => {
    const prisma = buildPrisma();
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: new Date(),
    });
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(
      service.tombstoneMessage('mod-1', UserRole.MODERATOR, 'm-1', {}),
    ).rejects.toThrow(/already tombstoned/i);
  });

  it('tombstones, cascade-closes open reports, and writes audit', async () => {
    const prisma = buildPrisma();
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'm-1',
      senderUserId: 'u-2',
      threadId: 't-1',
      groupId: null,
      deletedAt: null,
    });

    const tx = {
      message: { update: jest.fn() },
      report: { updateMany: jest.fn(), update: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    const result = await service.tombstoneMessage('mod-1', UserRole.MODERATOR, 'm-1', { reportId: 'rep-1' });

    expect(result.messageId).toBe('m-1');
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ messageId: 'm-1' }),
        data: expect.objectContaining({ status: ReportStatus.CLOSED, resolution: 'AUTO_CLOSED_TOMBSTONED' }),
      }),
    );
  });
});

describe('ModerationService.resetStrikes', () => {
  it('rejects when actor is not admin', async () => {
    const prisma = buildPrisma();
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(service.resetStrikes('mod-1', UserRole.MODERATOR, 'u-1', 'forgive')).rejects.toThrow(
      /Admin role required/,
    );
  });

  it('rejects when user does not exist', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(service.resetStrikes('admin-1', UserRole.ADMIN, 'u-1', 'forgive')).rejects.toThrow(
      /User not found/,
    );
  });

  it('rejects when user has no strikes', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u-1', strikeCount: 0 });
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      buildAudit() as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    await expect(service.resetStrikes('admin-1', UserRole.ADMIN, 'u-1', 'forgive')).rejects.toThrow(
      /no strikes to reset/,
    );
  });

  it('zeros the counter, clears lastStrikeAt, and writes a STRIKE_RESET audit row with previousCount', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u-1', strikeCount: 3 });
    const tx = {
      user: { update: jest.fn().mockResolvedValue({ id: 'u-1', strikeCount: 0 }) },
      adminAuditLog: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    const audit = buildAudit();
    const service = new ModerationService(
      prisma as unknown as PrismaService,
      buildRedis(),
      audit as unknown as AuditLogService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    const result = await service.resetStrikes('admin-1', UserRole.ADMIN, 'u-1', 'false positive');

    expect(result).toEqual({ id: 'u-1', strikeCount: 0 });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { strikeCount: 0, lastStrikeAt: null },
      select: { id: true, strikeCount: true },
    });
    expect(audit.write).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'STRIKE_RESET',
      targetType: 'USER',
      targetId: 'u-1',
      reason: 'false positive',
      metadata: { previousCount: 3 },
    });
  });
});
