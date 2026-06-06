import { Injectable } from '@nestjs/common';
import { Prisma, AdminAuditAction, AdminAuditTargetType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditWriteInput {
  actorUserId: string | null;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditWriteInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.adminAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  async list(filters: {
    action?: AdminAuditAction;
    targetType?: AdminAuditTargetType;
    actorUserId?: string;
    targetId?: string;
    from?: Date;
    to?: Date;
    searchText?: string;
    cursor?: string;
    limit: number;
  }) {
    const trimmed = filters.searchText?.trim();
    const searchText = trimmed && trimmed.length >= 3 ? trimmed : undefined;

    const where: Prisma.AdminAuditLogWhereInput = {
      ...(filters.action && { action: filters.action }),
      ...(filters.targetType && { targetType: filters.targetType }),
      ...(filters.actorUserId && { actorUserId: filters.actorUserId }),
      ...(filters.targetId && { targetId: filters.targetId }),
      ...(searchText && { reason: { contains: searchText, mode: 'insensitive' } }),
      ...((filters.from || filters.to) && {
        createdAt: {
          ...(filters.from && { gte: filters.from }),
          ...(filters.to && { lte: filters.to }),
        },
      }),
    };

    const items = await this.prisma.adminAuditLog.findMany({
      where,
      orderBy: [{ id: 'desc' }],
      take: filters.limit + 1,
      ...(filters.cursor && { cursor: { id: filters.cursor }, skip: 1 }),
    });

    const hasMore = items.length > filters.limit;
    const slice = hasMore ? items.slice(0, filters.limit) : items;
    const nextCursor = hasMore ? slice[slice.length - 1].id : null;

    return { items: slice, nextCursor };
  }
}
