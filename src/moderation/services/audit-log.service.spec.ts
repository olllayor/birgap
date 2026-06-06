import { AdminAuditAction, AdminAuditTargetType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  type Row = {
    id: string;
    actorUserId: string | null;
    action: AdminAuditAction;
    targetType: AdminAuditTargetType;
    targetId: string;
    reason: string | null;
    metadata: unknown;
    createdAt: Date;
  };

  it('writes a row with all fields and reads it back via list', async () => {
    const created: Row[] = [];
    let nextId = 1;
    const prisma = {
      adminAuditLog: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row: Row = {
            id: `row-${nextId++}`,
            actorUserId: (data.actorUserId as string | null) ?? null,
            action: data.action as AdminAuditAction,
            targetType: data.targetType as AdminAuditTargetType,
            targetId: data.targetId as string,
            reason: (data.reason as string | null) ?? null,
            metadata: (data.metadata as unknown) ?? null,
            createdAt: new Date(),
          };
          created.push(row);
          return row;
        }),
        findMany: jest.fn(async ({ where, take, cursor, skip }: { where: Record<string, unknown>; take: number; cursor?: { id: string }; skip?: number }) => {
          let items = created.filter((r) => {
            if (where.action && r.action !== where.action) return false;
            if (where.targetType && r.targetType !== where.targetType) return false;
            if (where.actorUserId && r.actorUserId !== where.actorUserId) return false;
            return true;
          });
          if (cursor && skip) {
            const idx = items.findIndex((r) => r.id === cursor.id);
            if (idx >= 0) items = items.slice(idx + 1);
          }
          return items.slice(0, take);
        }),
      },
    };
    const service = new AuditLogService(prisma as unknown as PrismaService);

    await service.write({
      actorUserId: 'admin-1',
      action: AdminAuditAction.MESSAGE_TOMBSTONE,
      targetType: AdminAuditTargetType.MESSAGE,
      targetId: 'msg-1',
      reason: 'spam',
      metadata: { scope: 'platform' },
    });
    await service.write({
      actorUserId: 'admin-1',
      action: AdminAuditAction.REPORT_DISMISS,
      targetType: AdminAuditTargetType.REPORT,
      targetId: 'rep-1',
    });

    const result = await service.list({ limit: 10 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    expect(result.items[0].action).toBe(AdminAuditAction.MESSAGE_TOMBSTONE);
    expect(result.items[1].action).toBe(AdminAuditAction.REPORT_DISMISS);
  });

  it('respects cursor and limit, returning nextCursor when more rows exist', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `row-${i + 1}`,
      actorUserId: 'a',
      action: AdminAuditAction.REPORT_DISMISS,
      targetType: AdminAuditTargetType.REPORT,
      targetId: `rep-${i + 1}`,
      reason: null,
      metadata: null,
      createdAt: new Date(),
    }));
    const prisma = {
      adminAuditLog: {
        create: jest.fn(),
        findMany: jest.fn(async () => rows),
      },
    };
    const service = new AuditLogService(prisma as unknown as PrismaService);

    const result = await service.list({ limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('row-2');
  });

  it('passes tx through to the underlying client when provided', async () => {
    const tx = { adminAuditLog: { create: jest.fn(async () => ({})) } };
    const prisma = { adminAuditLog: { create: jest.fn() } };
    const service = new AuditLogService(prisma as unknown as PrismaService);

    await service.write(
      {
        actorUserId: null,
        action: AdminAuditAction.ROLE_PROMOTE,
        targetType: AdminAuditTargetType.USER,
        targetId: 'u-1',
      },
      tx as never,
    );

    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('filters by searchText with case-insensitive contains on the reason column', async () => {
    const prisma = {
      adminAuditLog: {
        create: jest.fn(),
        findMany: jest.fn(async () => []),
      },
    };
    const service = new AuditLogService(prisma as unknown as PrismaService);

    await service.list({ limit: 10, searchText: 'harassment' });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reason: { contains: 'harassment', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('ignores searchText shorter than 3 characters (no point doing a 1- or 2-char index scan)', async () => {
    const prisma = {
      adminAuditLog: {
        create: jest.fn(),
        findMany: jest.fn(async () => []),
      },
    };
    const service = new AuditLogService(prisma as unknown as PrismaService);

    await service.list({ limit: 10, searchText: 'ab' });

    const call = (prisma.adminAuditLog.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.reason).toBeUndefined();
  });
});
