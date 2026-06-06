import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import { SuspensionReactivationService } from './suspension-reactivation.service';

function makePrismaStub() {
  return {
    userSuspension: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        userSuspension: { update: jest.fn().mockResolvedValue({ id: 's-1' }) },
        user: { update: jest.fn().mockResolvedValue({ id: 'u-1' }) },
      }),
    ),
  };
}

function makeAuditStub() {
  return {
    write: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };
}

describe('SuspensionReactivationService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let audit: ReturnType<typeof makeAuditStub>;
  let service: SuspensionReactivationService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaStub();
    audit = makeAuditStub();
    service = new SuspensionReactivationService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
    );
  });

  it('returns 0 when no expired suspensions exist', async () => {
    prisma.userSuspension.findMany.mockResolvedValueOnce([]);
    const result = await service.run(new Date('2026-06-01T01:00:00Z'));
    expect(result).toEqual({ reactivated: 0 });
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('queries for suspensions with expiresAt < now and revokedAt IS NULL', async () => {
    const now = new Date('2026-06-01T01:00:00Z');
    await service.run(now);
    expect(prisma.userSuspension.findMany).toHaveBeenCalledWith({
      where: {
        revokedAt: null,
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, userId: true, expiresAt: true },
    });
  });

  it('reactivates each expired user and writes an audit log entry with actorUserId=null', async () => {
    prisma.userSuspension.findMany.mockResolvedValueOnce([
      { id: 's-1', userId: 'u-1', expiresAt: new Date('2026-05-31T23:00:00Z') },
      { id: 's-2', userId: 'u-2', expiresAt: new Date('2026-05-30T12:00:00Z') },
    ]);

    const result = await service.run(new Date('2026-06-01T01:00:00Z'));

    expect(result).toEqual({ reactivated: 2 });
    expect(audit.write).toHaveBeenCalledTimes(2);
    expect(audit.write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorUserId: null,
        action: 'USER_UNSUSPEND',
        targetType: 'USER',
        targetId: 'u-1',
        reason: 'auto: expired',
        metadata: expect.objectContaining({
          source: 'auto-reactivation',
          suspensionId: 's-1',
        }),
      }),
      expect.anything(),
    );
    expect(audit.write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actorUserId: null,
        targetId: 'u-2',
        metadata: expect.objectContaining({ suspensionId: 's-2' }),
      }),
      expect.anything(),
    );
  });

  it('continues re-activating subsequent users when one throws', async () => {
    prisma.userSuspension.findMany.mockResolvedValueOnce([
      { id: 's-1', userId: 'u-1', expiresAt: new Date('2026-05-31T23:00:00Z') },
      { id: 's-2', userId: 'u-2', expiresAt: new Date('2026-05-30T12:00:00Z') },
    ]);

    (audit.write as jest.Mock)
      .mockRejectedValueOnce(new Error('DB transient'))
      .mockResolvedValueOnce({ id: 'audit-2' });

    const result = await service.run(new Date('2026-06-01T01:00:00Z'));

    expect(result).toEqual({ reactivated: 1 });
    expect(audit.write).toHaveBeenCalledTimes(2);
  });

  it('passes the transaction client to audit.write so the revoke + status + audit land atomically', async () => {
    prisma.userSuspension.findMany.mockResolvedValueOnce([
      { id: 's-1', userId: 'u-1', expiresAt: new Date('2026-05-31T23:00:00Z') },
    ]);

    let txSeen: unknown = null;
    prisma.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        userSuspension: { update: jest.fn().mockResolvedValue({ id: 's-1' }) },
        user: { update: jest.fn().mockResolvedValue({ id: 'u-1', status: UserStatus.ACTIVE }) },
      };
      txSeen = fakeTx;
      return cb(fakeTx);
    });

    await service.run(new Date('2026-06-01T01:00:00Z'));

    expect(audit.write).toHaveBeenCalledWith(expect.any(Object), txSeen);
  });
});
