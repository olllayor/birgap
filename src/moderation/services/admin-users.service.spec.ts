import { PrismaService } from '../../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

function buildPrisma() {
  return {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    report: { findMany: jest.fn() },
    userSuspension: { findMany: jest.fn() },
    device: { findMany: jest.fn() },
  };
}

describe('AdminUsersService.getDetail', () => {
  it('returns user + last 25 filed reports + last 25 received reports + last 25 suspensions', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u-1',
      phoneHash: 'h',
      phoneMasked: '+90***1234',
      username: 'alice',
      profileAvatarUrl: null,
      status: 'ACTIVE',
      role: 'USER',
      strikeCount: 0,
      lastStrikeAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    (prisma.report.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'rep-1' }])
      .mockResolvedValueOnce([{ id: 'rep-2' }]);
    (prisma.userSuspension.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'susp-1' }]);
    (prisma.device.findMany as jest.Mock).mockResolvedValueOnce([]);

    const service = new AdminUsersService(prisma as unknown as PrismaService);
    const result = await service.getDetail('u-1');

    expect(result.user.id).toBe('u-1');
    expect(result.filedReports).toHaveLength(1);
    expect(result.receivedReports).toHaveLength(1);
    expect(result.suspensions).toHaveLength(1);

    expect(prisma.report.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { reporterUserId: 'u-1' } }),
    );
    expect(prisma.report.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { message: { senderUserId: 'u-1' } } }),
    );
  });

  it('throws NotFound when the user does not exist', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new AdminUsersService(prisma as unknown as PrismaService);

    await expect(service.getDetail('missing')).rejects.toThrow(/User not found/);
  });
});

describe('AdminUsersService.search', () => {
  it('returns an empty list when the query string is blank', async () => {
    const prisma = buildPrisma();
    const service = new AdminUsersService(prisma as unknown as PrismaService);

    const result = await service.search({ q: '   ' });
    expect(result.items).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('filters by role and status when provided', async () => {
    const prisma = buildPrisma();
    (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([]);
    const service = new AdminUsersService(prisma as unknown as PrismaService);

    await service.search({ role: 'ADMIN', status: 'SUSPENDED', limit: 10 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'ADMIN', status: 'SUSPENDED' }),
        take: 10,
      }),
    );
  });

  it('clamps the limit to [1, 100] and defaults to 20', async () => {
    const prisma = buildPrisma();
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    const service = new AdminUsersService(prisma as unknown as PrismaService);

    await service.search({ limit: 500 });
    expect(prisma.user.findMany.mock.calls[0][0].take).toBe(100);

    await service.search({ limit: 0 });
    expect(prisma.user.findMany.mock.calls[1][0].take).toBe(1);

    await service.search({});
    expect(prisma.user.findMany.mock.calls[2][0].take).toBe(20);
  });

  it('orders results by strikeCount desc, then createdAt desc', async () => {
    const prisma = buildPrisma();
    (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([]);
    const service = new AdminUsersService(prisma as unknown as PrismaService);

    await service.search({});

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ strikeCount: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  });

  it('adds case-insensitive OR conditions on username and phoneMasked when q is provided', async () => {
    const prisma = buildPrisma();
    (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([]);
    const service = new AdminUsersService(prisma as unknown as PrismaService);

    await service.search({ q: 'alice' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { username: { contains: 'alice', mode: 'insensitive' } },
            { phoneMasked: { contains: 'alice' } },
          ],
        }),
      }),
    );
  });
});
