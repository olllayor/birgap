import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ReportReason, ReportResolution, ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from './audit-log.service';
import { CreateReportDto } from '../dto/create-report.dto';
import { ListReportsQueryDto } from '../dto/list-reports-query.dto';
import { DismissReportDto } from '../dto/dismiss-report.dto';

const REPORTS_QUEUE_COLLUSION_KEY = (messageId: string) => `reports:collusion:${messageId}`;
const REPORTS_DAILY_KEY = (userId: string, yyyymmdd: string) => `reports:daily:${userId}:${yyyymmdd}`;
const REPORTS_IP_MINUTE_KEY = (ip: string, yyyyMMddHHmm: string) =>
  `reports:ip:${ip}:${yyyyMMddHHmm}`;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  async create(reporterUserId: string, dto: CreateReportDto, clientIp?: string) {
    const reporter = await this.prisma.user.findUnique({
      where: { id: reporterUserId },
      select: { status: true, role: true },
    });
    if (!reporter) {
      throw new NotFoundException('Reporter user not found');
    }
    if (reporter.status === 'SUSPENDED') {
      throw new ForbiddenException('Suspended users cannot file reports');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: dto.messageId },
      select: {
        id: true,
        threadId: true,
        groupId: true,
        senderUserId: true,
        deletedAt: true,
        thread: { select: { userAId: true, userBId: true } },
      },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.deletedAt) {
      throw new BadRequestException('Cannot report a deleted message');
    }
    if (message.senderUserId === reporterUserId) {
      throw new BadRequestException('Cannot report your own message');
    }

    if (message.threadId) {
      const isParticipant =
        message.thread?.userAId === reporterUserId || message.thread?.userBId === reporterUserId;
      if (!isParticipant) {
        throw new ForbiddenException('Only thread participants can report messages in a direct thread');
      }
    } else if (message.groupId) {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: message.groupId, userId: reporterUserId } },
        select: { userId: true },
      });
      if (!member) {
        throw new ForbiddenException('Only group members can report messages in a group');
      }
    }

    if (reporter.role === UserRole.USER) {
      const dailyLimit = this.config.get<number>('REPORTS_DAILY_LIMIT', 50);
      const allowed = await this.checkDailyLimit(reporterUserId, dailyLimit);
      if (!allowed) {
        throw new ConflictException(`Daily report limit of ${dailyLimit} reached`);
      }

      if (clientIp) {
        const ipLimit = this.config.get<number>('REPORTS_PER_IP_PER_MINUTE', 10);
        const ipAllowed = await this.checkIpRateLimit(clientIp, ipLimit);
        if (!ipAllowed) {
          throw new ConflictException(`Report rate limit of ${ipLimit}/minute reached for this IP`);
        }
      }
    }

    const report = await this.prisma.report.upsert({
      where: { reporterUserId_messageId: { reporterUserId, messageId: dto.messageId } },
      update: {},
      create: {
        reporterUserId,
        messageId: dto.messageId,
        reason: dto.reason,
        freeText: dto.freeText ?? null,
      },
    });

    if (report.createdAt.getTime() === report.updatedAt.getTime()) {
      await this.trackCollusion(dto.messageId).catch(() => undefined);
    }

    return report;
  }

  async listMine(userId: string, limit: number) {
    return this.prisma.report.findMany({
      where: { reporterUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async list(query: ListReportsQueryDto) {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const where: Prisma.ReportWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.reason && { reason: query.reason }),
    };
    const items = await this.prisma.report.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      include: {
        reporter: { select: { id: true, username: true } },
        message: {
          select: {
            id: true,
            senderUserId: true,
            threadId: true,
            groupId: true,
            createdAt: true,
            deletedAt: true,
          },
        },
      },
    });
    const hasMore = items.length > limit;
    const slice = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? slice[slice.length - 1].id : null;
    return { items: slice, nextCursor };
  }

  async getById(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        reporter: { select: { id: true, username: true } },
        message: {
          select: {
            id: true,
            senderUserId: true,
            senderDeviceId: true,
            threadId: true,
            groupId: true,
            contentType: true,
            createdAt: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  async markInReview(actorUserId: string, reportId: string) {
    const existing = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException('Report not found');
    }
    if (existing.status === ReportStatus.CLOSED) {
      throw new BadRequestException('Report is already closed');
    }
    if (existing.status === ReportStatus.IN_REVIEW) {
      return this.getById(reportId);
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.IN_REVIEW,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.write({
      actorUserId,
      action: 'REPORT_REVIEW_START',
      targetType: 'REPORT',
      targetId: reportId,
    });

    return updated;
  }

  async dismiss(actorUserId: string, reportId: string, dto: DismissReportDto) {
    const existing = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException('Report not found');
    }
    if (existing.status === ReportStatus.CLOSED) {
      throw new BadRequestException('Report is already closed');
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.CLOSED,
        resolution: ReportResolution.DISMISSED,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.write({
      actorUserId,
      action: 'REPORT_DISMISS',
      targetType: 'REPORT',
      targetId: reportId,
      reason: dto.reason,
    });

    return updated;
  }

  private async checkDailyLimit(userId: string, limit: number): Promise<boolean> {
    const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const key = REPORTS_DAILY_KEY(userId, dateKey);
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, 36 * 60 * 60);
    }
    return count <= limit;
  }

  private async checkIpRateLimit(ip: string, limit: number): Promise<boolean> {
    const minuteKey = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const key = REPORTS_IP_MINUTE_KEY(ip, minuteKey);
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, 90);
    }
    return count <= limit;
  }

  private async trackCollusion(messageId: string): Promise<void> {
    const threshold = this.config.get<number>('REPORTS_COLLUSION_THRESHOLD', 10);
    const windowHours = this.config.get<number>('REPORTS_COLLUSION_WINDOW_HOURS', 1);
    const key = REPORTS_QUEUE_COLLUSION_KEY(messageId);
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, windowHours * 60 * 60);
    }
  }
}
