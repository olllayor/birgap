import { Module } from '@nestjs/common';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { AdminBootstrapService } from './services/admin-bootstrap.service';
import { AdminUsersService } from './services/admin-users.service';
import { AnalyticsService } from './services/analytics.service';
import { AuditLogService } from './services/audit-log.service';
import { ModerationService } from './services/moderation.service';
import { ReportsService } from './services/reports.service';
import { DailyMetricsRollupService } from './services/daily-metrics-rollup.service';
import { SuspensionReactivationService } from './services/suspension-reactivation.service';
import { AdminController } from './controllers/admin.controller';
import { ReportsController } from './controllers/reports.controller';

@Module({
  controllers: [AdminController, ReportsController],
  providers: [
    AdminRoleGuard,
    AdminBootstrapService,
    AdminUsersService,
    AnalyticsService,
    AuditLogService,
    ModerationService,
    ReportsService,
    DailyMetricsRollupService,
    SuspensionReactivationService,
  ],
  exports: [AuditLogService, ModerationService, AdminRoleGuard, DailyMetricsRollupService, SuspensionReactivationService],
})
export class ModerationModule {}
