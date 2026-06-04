import { Injectable, Scope } from '@nestjs/common';
import { Message } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchLoader } from './batch-loader';

@Injectable({ scope: Scope.REQUEST })
export class MessageLoader extends BatchLoader<Message> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  protected fetchBatch(ids: string[]): Promise<Message[]> {
    return this.prisma.message.findMany({ where: { id: { in: ids } } });
  }
}
