import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { AllowAnyRole, RequireRole } from '../../common/decorators/require-role.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ReportsService } from '../services/reports.service';
import { ModerationService } from '../services/moderation.service';
import { AnalyticsService } from '../services/analytics.service';
import { AuditLogService } from '../services/audit-log.service';
import { AdminUsersService } from '../services/admin-users.service';
import { ListReportsQueryDto } from '../dto/list-reports-query.dto';
import { DismissReportDto } from '../dto/dismiss-report.dto';
import { TombstoneMessageDto } from '../dto/tombstone-message.dto';
import { SuspendUserDto } from '../dto/suspend-user.dto';
import { UnsuspendUserDto } from '../dto/unsuspend-user.dto';
import { ChangeUserRoleDto } from '../dto/change-user-role.dto';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { ListAuditLogQueryDto } from '../dto/list-audit-log-query.dto';
import { RollupDateDto } from '../dto/rollup-date.dto';
import { ResetStrikesDto } from '../dto/reset-strikes.dto';
import { DailyMetricsRollupService } from '../services/daily-metrics-rollup.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly reports: ReportsService,
    private readonly moderation: ModerationService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditLogService,
    private readonly adminUsers: AdminUsersService,
    private readonly rollup: DailyMetricsRollupService,
  ) {}

  @AllowAnyRole()
  @Get('me')
  @ApiOperation({ summary: 'Return the authenticated admin actor identity.' })
  @ApiResponse({ status: 200, description: 'Returns { userId, role }.' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { userId: user.userId, role: user.role };
  }

  @RequireRole(UserRole.MODERATOR, UserRole.ADMIN)
  @Get('reports')
  @ApiOperation({ summary: 'List the report queue (OPEN and IN_REVIEW reports, oldest first).' })
  listReports(@Query() query: ListReportsQueryDto) {
    return this.reports.list(query);
  }

  @RequireRole(UserRole.MODERATOR, UserRole.ADMIN)
  @Get('reports/:reportId')
  @ApiOperation({ summary: 'Get one report with its message projection (no ciphertext).' })
  @ApiParam({ name: 'reportId', format: 'uuid' })
  getReport(@Param('reportId') reportId: string) {
    return this.reports.getById(reportId);
  }

  @RequireRole(UserRole.MODERATOR, UserRole.ADMIN)
  @Post('reports/:reportId/review')
  @ApiOperation({ summary: 'Mark a report as IN_REVIEW; idempotent.' })
  reviewReport(@CurrentUser() user: AuthenticatedUser, @Param('reportId') reportId: string) {
    return this.reports.markInReview(user.userId, reportId);
  }

  @RequireRole(UserRole.MODERATOR, UserRole.ADMIN)
  @Post('reports/:reportId/dismiss')
  @ApiOperation({ summary: 'Dismiss a report; sets status=CLOSED, resolution=DISMISSED.' })
  dismissReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Body() dto: DismissReportDto,
  ) {
    return this.reports.dismiss(user.userId, reportId, dto);
  }

  @RequireRole(UserRole.MODERATOR, UserRole.ADMIN)
  @Post('messages/:messageId/tombstone')
  @ApiOperation({ summary: 'Tombstone a message and cascade-close any open reports on it.' })
  tombstone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: TombstoneMessageDto,
  ) {
    return this.moderation.tombstoneMessage(user.userId, user.role, messageId, dto);
  }

  @RequireRole(UserRole.ADMIN)
  @Post('messages/:messageId/untombstone')
  @ApiOperation({ summary: 'Restore a tombstoned message. ADMIN-only.' })
  untombstone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() body: { reason?: string },
  ) {
    return this.moderation.untombstoneMessage(user.userId, user.role, messageId, body.reason);
  }

  @RequireRole(UserRole.ADMIN)
  @Post('users/:userId/suspend')
  @ApiOperation({
    summary:
      'Suspend a user: revokes refresh tokens, tombstones their messages, kicks them from realtime.',
  })
  @ApiResponse({ status: 403, description: 'Cannot suspend an admin or yourself.' })
  @ApiResponse({ status: 409, description: 'User is already suspended.' })
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.moderation.suspendUser(user.userId, user.role, userId, dto);
  }

  @RequireRole(UserRole.ADMIN)
  @Post('users/:userId/unsuspend')
  @ApiOperation({ summary: 'Manually lift a suspension. Strikes are NOT decremented.' })
  unsuspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UnsuspendUserDto,
  ) {
    return this.moderation.unsuspendUser(user.userId, user.role, userId, dto);
  }

  @RequireRole(UserRole.ADMIN)
  @Get('users/:userId/suspensions')
  @ApiOperation({ summary: 'List suspension history for a user, newest first.' })
  listSuspensions(@Param('userId') userId: string) {
    return this.moderation.listSuspensions(userId, 50);
  }

  @RequireRole(UserRole.ADMIN)
  @Get('users/:userId')
  @ApiOperation({
    summary: 'User detail: profile fields, strike count, recent filed/received reports, suspension history.',
  })
  getUser(@Param('userId') userId: string) {
    return this.adminUsers.getDetail(userId);
  }

  @RequireRole(UserRole.ADMIN)
  @Get('users')
  @ApiOperation({
    summary: 'Search users by username/phone, filter by role/status. Ordered by strikeCount desc.',
  })
  searchUsers(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminUsers.search({ q, role, status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @RequireRole(UserRole.ADMIN)
  @Patch('users/:userId/role')
  @ApiOperation({ summary: 'Promote or demote a user; logged in audit log as ROLE_PROMOTE or ROLE_DEMOTE.' })
  changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: ChangeUserRoleDto,
  ) {
    return this.moderation.changeUserRole(user.userId, user.role, userId, dto.role, dto.reason);
  }

  @RequireRole(UserRole.ADMIN)
  @Post('users/:userId/strikes/reset')
  @ApiOperation({ summary: 'Zero out a user\'s strike count. Reason is mandatory and audited.' })
  resetStrikes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: ResetStrikesDto,
  ) {
    return this.moderation.resetStrikes(user.userId, user.role, userId, dto.reason);
  }

  @RequireRole(UserRole.MODERATOR, UserRole.ADMIN)
  @Get('analytics')
  @ApiOperation({ summary: 'Time series for one DailyMetricKind, with optional dimension filter.' })
  analyticsQuery(@Query() query: AnalyticsQueryDto) {
    const kind = query.kind ?? query.metricKind;
    return this.analytics.series({ ...query, kind });
  }

  @RequireRole(UserRole.ADMIN)
  @Get('audit-log')
  @ApiOperation({
    summary: 'Cursor-paginated audit log read. Supports filter by action, target, actor, date range, and free-text search on `reason`.',
  })
  auditLog(@Query() query: ListAuditLogQueryDto) {
    return this.audit.list({
      action: query.action,
      targetType: query.targetType,
      actorUserId: query.actorUserId,
      targetId: query.targetId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      searchText: query.searchText,
      cursor: query.cursor,
      limit: query.limit ?? 50,
    });
  }

  @RequireRole(UserRole.ADMIN)
  @Post('analytics/rollup')
  @ApiOperation({
    summary: 'Manually re-run the daily metrics rollup for a given date. Audited.',
  })
  async rollupDay(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RollupDateDto,
  ) {
    const day = new Date(`${dto.date}T00:00:00.000Z`);
    const result = await this.rollup.rollupDay(day);
    await this.audit.write({
      actorUserId: user.userId,
      action: 'METRICS_ROLLUP',
      targetType: 'USER',
      targetId: user.userId,
      reason: 'manual_rollup',
      metadata: { date: result.date, written: result.written },
    });
    return result;
  }
}
