import { Injectable, Scope } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchLoader } from './batch-loader';

@Injectable({ scope: Scope.REQUEST })
export class UserLoader extends BatchLoader<User> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  protected fetchBatch(ids: string[]): Promise<User[]> {
    return this.prisma.user.findMany({ where: { id: { in: ids } } });
  }
}
