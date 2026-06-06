import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ReportsController } from './reports.controller';
import { ReportsService } from '../services/reports.service';
import { UserRole } from '@prisma/client';

class FakeGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

function buildAuthUser(role: UserRole = UserRole.USER): AuthenticatedUser {
  return { userId: 'u-1', sessionId: 'sess-1', role };
}

describe('ReportsController', () => {
  let controller: ReportsController;
  let reports: jest.Mocked<ReportsService>;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: { create: jest.fn(), listMine: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeGuard)
      .compile();

    controller = moduleRef.get(ReportsController);
    reports = moduleRef.get(ReportsService);
  });

  it('delegates POST /reports to ReportsService.create with the actor userId and client IP', async () => {
    (reports.create as jest.Mock).mockResolvedValue({ id: 'rep-1' });
    const dto = { messageId: 'm-1', reason: 'SPAM' as const, freeText: 'junk' };
    const req = { ip: '203.0.113.42' } as unknown as Request;

    const result = await controller.create(buildAuthUser(), dto as never, req);

    expect(result).toEqual({ id: 'rep-1' });
    expect(reports.create).toHaveBeenCalledWith('u-1', dto, '203.0.113.42');
  });

  it('passes undefined for IP when req.ip is missing', async () => {
    (reports.create as jest.Mock).mockResolvedValue({ id: 'rep-1' });
    const req = { ip: '' } as unknown as Request;
    await controller.create(buildAuthUser(), { messageId: 'm-1', reason: 'SPAM' as const } as never, req);
    expect(reports.create).toHaveBeenCalledWith('u-1', expect.anything(), undefined);
  });

  it('delegates GET /reports/mine with a default limit of 20 when none is provided', async () => {
    (reports.listMine as jest.Mock).mockResolvedValue({ items: [] });
    await controller.listMine(buildAuthUser(), {} as never);
    expect(reports.listMine).toHaveBeenCalledWith('u-1', 20);
  });

  it('honours a caller-supplied limit on /reports/mine', async () => {
    (reports.listMine as jest.Mock).mockResolvedValue({ items: [] });
    await controller.listMine(buildAuthUser(), { limit: 50 } as never);
    expect(reports.listMine).toHaveBeenCalledWith('u-1', 50);
  });

  it('lets moderators file reports the same way regular users do (no role gate on POST /reports)', async () => {
    (reports.create as jest.Mock).mockResolvedValue({ id: 'rep-2' });
    const req = { ip: '198.51.100.1' } as unknown as Request;
    await controller.create(buildAuthUser(UserRole.MODERATOR), { messageId: 'm-2', reason: 'OTHER' as const } as never, req);
    expect(reports.create).toHaveBeenCalledWith('u-1', expect.objectContaining({ messageId: 'm-2' }), '198.51.100.1');
  });
});
