import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  it('does nothing when ADMIN_PHONE_HASHES is unset', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } } as unknown as PrismaService;
    const audit = { write: jest.fn() } as unknown as AuditLogService;
    const service = new AdminBootstrapService(config, prisma, audit);

    await service.onApplicationBootstrap();

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('promotes matching users and writes audit log entries', async () => {
    const config = {
      get: jest.fn().mockReturnValue('hash-a,hash-b,hash-c'),
    } as unknown as ConfigService;
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'u-a', role: UserRole.USER })
          .mockResolvedValueOnce({ id: 'u-b', role: UserRole.ADMIN })
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({ id: 'u-a', role: UserRole.ADMIN }),
      },
    } as unknown as PrismaService;
    const audit = { write: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;

    const service = new AdminBootstrapService(config, prisma, audit);
    await service.onApplicationBootstrap();

    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        action: 'ROLE_PROMOTE',
        targetType: 'USER',
        targetId: 'u-a',
        metadata: expect.objectContaining({ source: 'env', from: UserRole.USER, to: UserRole.ADMIN }),
      }),
    );
  });

  it('skips already-admin users and unknown hashes', async () => {
    const config = {
      get: jest.fn().mockReturnValue('hash-a,hash-b'),
    } as unknown as ConfigService;
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'u-a', role: UserRole.ADMIN })
          .mockResolvedValueOnce(null),
        update: jest.fn(),
      },
    } as unknown as PrismaService;
    const audit = { write: jest.fn() } as unknown as AuditLogService;

    const service = new AdminBootstrapService(config, prisma, audit);
    await service.onApplicationBootstrap();

    expect(audit.write).not.toHaveBeenCalled();
  });
});
