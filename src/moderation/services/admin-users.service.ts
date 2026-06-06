import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneHash: true,
        phoneMasked: true,
        username: true,
        profileAvatarUrl: true,
        status: true,
        role: true,
        strikeCount: true,
        lastStrikeAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [filedReports, receivedReports, suspensions] = await Promise.all([
      this.prisma.report.findMany({
        where: { reporterUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          messageId: true,
          reason: true,
          status: true,
          resolution: true,
          createdAt: true,
          reviewedAt: true,
        },
      }),
      this.prisma.report.findMany({
        where: { message: { senderUserId: userId } },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          reporterUserId: true,
          messageId: true,
          reason: true,
          status: true,
          resolution: true,
          createdAt: true,
          reviewedAt: true,
        },
      }),
      this.prisma.userSuspension.findMany({
        where: { userId },
        orderBy: { suspendedAt: 'desc' },
        take: 25,
        include: {
          suspendedBy: { select: { id: true, username: true } },
          revokedBy: { select: { id: true, username: true } },
        },
      }),
    ]);

    return { user, filedReports, receivedReports, suspensions };
  }

  async search(query: { q?: string; role?: string; status?: string; limit?: number }) {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const where: Prisma.UserWhereInput = {
      ...(query.role && { role: query.role as Prisma.EnumUserRoleFilter['equals'] }),
      ...(query.status && { status: query.status as Prisma.EnumUserStatusFilter['equals'] }),
    };
    if (query.q) {
      const trimmed = query.q.trim();
      if (trimmed.length === 0) {
        return { items: [], nextCursor: null };
      }
      where.OR = [
        { username: { contains: trimmed, mode: 'insensitive' } },
        { phoneMasked: { contains: trimmed } },
      ];
    }
    const items = await this.prisma.user.findMany({
      where,
      orderBy: [{ strikeCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        username: true,
        phoneMasked: true,
        role: true,
        status: true,
        strikeCount: true,
        lastStrikeAt: true,
        createdAt: true,
      },
    });
    return { items };
  }
}
