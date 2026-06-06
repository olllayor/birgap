import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate, ExecutionContext, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AdminController } from './admin.controller';
import { ReportsService } from '../services/reports.service';
import { ModerationService } from '../services/moderation.service';
import { AnalyticsService } from '../services/analytics.service';
import { AuditLogService } from '../services/audit-log.service';
import { AdminUsersService } from '../services/admin-users.service';
import { DailyMetricsRollupService } from '../services/daily-metrics-rollup.service';
import { UserRole } from '@prisma/client';

class FakeGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

class CapturingGuard implements CanActivate {
  static lastMetadata: unknown = null;
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

function buildAuthUser(role: UserRole): AuthenticatedUser {
  return { userId: 'actor-1', sessionId: 'sess-1', role };
}

describe('AdminController (routing + role metadata only)', () => {
  let controller: AdminController;
  let reports: jest.Mocked<ReportsService>;
  let moderation: jest.Mocked<ModerationService>;
  let analytics: jest.Mocked<AnalyticsService>;
  let audit: jest.Mocked<AuditLogService>;
  let adminUsers: jest.Mocked<AdminUsersService>;
  let rollup: jest.Mocked<DailyMetricsRollupService>;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: ReportsService, useValue: { list: jest.fn(), getById: jest.fn(), markInReview: jest.fn(), dismiss: jest.fn() } },
        {
          provide: ModerationService,
          useValue: {
            tombstoneMessage: jest.fn(),
            untombstoneMessage: jest.fn(),
            suspendUser: jest.fn(),
            unsuspendUser: jest.fn(),
            changeUserRole: jest.fn(),
            resetStrikes: jest.fn(),
            listSuspensions: jest.fn(),
          },
        },
        { provide: AnalyticsService, useValue: { series: jest.fn() } },
        { provide: AuditLogService, useValue: { list: jest.fn(), write: jest.fn() } },
        { provide: AdminUsersService, useValue: { getDetail: jest.fn(), search: jest.fn() } },
        { provide: DailyMetricsRollupService, useValue: { rollupDay: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeGuard)
      .overrideGuard(AdminRoleGuard)
      .useClass(CapturingGuard)
      .compile();

    controller = moduleRef.get(AdminController);
    reports = moduleRef.get(ReportsService);
    moderation = moduleRef.get(ModerationService);
    analytics = moduleRef.get(AnalyticsService);
    audit = moduleRef.get(AuditLogService);
    adminUsers = moduleRef.get(AdminUsersService);
    rollup = moduleRef.get(DailyMetricsRollupService);
  });

  it('returns the actor identity from /admin/me', () => {
    const result = controller.me(buildAuthUser(UserRole.ADMIN));
    expect(result).toEqual({ userId: 'actor-1', role: UserRole.ADMIN });
  });

  it('delegates list reports to ReportsService', async () => {
    (reports.list as jest.Mock).mockResolvedValue({ items: [] });
    await controller.listReports({} as never);
    expect(reports.list).toHaveBeenCalled();
  });

  it('delegates report transitions to ReportsService', async () => {
    await controller.reviewReport(buildAuthUser(UserRole.MODERATOR), 'rep-1');
    expect(reports.markInReview).toHaveBeenCalledWith('actor-1', 'rep-1');

    await controller.dismissReport(buildAuthUser(UserRole.MODERATOR), 'rep-1', { reason: 'spam' } as never);
    expect(reports.dismiss).toHaveBeenCalledWith('actor-1', 'rep-1', { reason: 'spam' });
  });

  it('passes the actor role down to tombstone / untombstone', async () => {
    await controller.tombstone(buildAuthUser(UserRole.MODERATOR), 'm-1', { reason: 'spam' } as never);
    expect(moderation.tombstoneMessage).toHaveBeenCalledWith('actor-1', UserRole.MODERATOR, 'm-1', { reason: 'spam' });

    await controller.untombstone(buildAuthUser(UserRole.ADMIN), 'm-1', { reason: 'reversal' });
    expect(moderation.untombstoneMessage).toHaveBeenCalledWith('actor-1', UserRole.ADMIN, 'm-1', 'reversal');
  });

  it('passes the actor role down to suspend / unsuspend / changeRole / resetStrikes', async () => {
    await controller.suspend(buildAuthUser(UserRole.ADMIN), 'u-1', { reason: 'spam' } as never);
    expect(moderation.suspendUser).toHaveBeenCalledWith('actor-1', UserRole.ADMIN, 'u-1', { reason: 'spam' });

    await controller.unsuspend(buildAuthUser(UserRole.ADMIN), 'u-1', { reason: 'appeal-granted' } as never);
    expect(moderation.unsuspendUser).toHaveBeenCalledWith('actor-1', UserRole.ADMIN, 'u-1', { reason: 'appeal-granted' });

    await controller.changeRole(buildAuthUser(UserRole.ADMIN), 'u-1', { role: UserRole.MODERATOR, reason: 'need' } as never);
    expect(moderation.changeUserRole).toHaveBeenCalledWith('actor-1', UserRole.ADMIN, 'u-1', UserRole.MODERATOR, 'need');

    await controller.resetStrikes(buildAuthUser(UserRole.ADMIN), 'u-1', { reason: 'false positive' });
    expect(moderation.resetStrikes).toHaveBeenCalledWith('actor-1', UserRole.ADMIN, 'u-1', 'false positive');
  });

  it('passes through admin-users search and detail queries', async () => {
    (adminUsers.search as jest.Mock).mockResolvedValue({ items: [] });
    await controller.searchUsers('alice', UserRole.USER, 'ACTIVE', '25');
    expect(adminUsers.search).toHaveBeenCalledWith({ q: 'alice', role: 'USER', status: 'ACTIVE', limit: 25 });

    (adminUsers.getDetail as jest.Mock).mockResolvedValue({ user: {} });
    await controller.getUser('u-1');
    expect(adminUsers.getDetail).toHaveBeenCalledWith('u-1');

    (moderation.listSuspensions as jest.Mock).mockResolvedValue([]);
    await controller.listSuspensions('u-1');
    expect(moderation.listSuspensions).toHaveBeenCalledWith('u-1', 50);
  });

  it('translates analytics query and rolls back the searchText path of the audit log', async () => {
    (analytics.series as jest.Mock).mockResolvedValue({ items: [] });
    await controller.analyticsQuery({} as never);
    expect(analytics.series).toHaveBeenCalled();

    (audit.list as jest.Mock).mockResolvedValue({ items: [] });
    await controller.auditLog({
      from: '2026-06-01T00:00:00Z',
      to: '2026-06-02T00:00:00Z',
      searchText: 'spam',
      limit: 25,
    } as never);
    expect(audit.list).toHaveBeenCalledWith(
      expect.objectContaining({
        searchText: 'spam',
        from: new Date('2026-06-01T00:00:00Z'),
        to: new Date('2026-06-02T00:00:00Z'),
        limit: 25,
      }),
    );
  });

  it('rolls up a manual day, returns the count, and writes a STRIKE_RESET-style audit row', async () => {
    (rollup.rollupDay as jest.Mock).mockResolvedValue({ date: '2026-06-01', written: 7 });
    const result = await controller.rollupDay(buildAuthUser(UserRole.ADMIN), { date: '2026-06-01' });

    expect(result).toEqual({ date: '2026-06-01', written: 7 });
    expect(rollup.rollupDay).toHaveBeenCalledWith(new Date('2026-06-01T00:00:00.000Z'));
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'actor-1',
        action: 'METRICS_ROLLUP',
        reason: 'manual_rollup',
        metadata: { date: '2026-06-01', written: 7 },
      }),
    );
  });

  it('uses class-validator to reject a malformed rollup date', async () => {
    const { validateSync } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { RollupDateDto } = await import('../dto/rollup-date.dto');

    const bad = plainToInstance(RollupDateDto, { date: '06/01/2026' });
    const errors = validateSync(bad);
    expect(errors.length).toBeGreaterThan(0);

    const good = plainToInstance(RollupDateDto, { date: '2026-06-01' });
    expect(validateSync(good)).toHaveLength(0);
  });
});
