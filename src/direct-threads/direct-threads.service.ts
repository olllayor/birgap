import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DirectThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const thread = await this.prisma.directThread.findUnique({
      where: { id },
    });
    if (!thread) {
      throw new NotFoundException('DirectThread not found');
    }
    return thread;
  }

  async findByUser(userId: string) {
    return this.prisma.directThread.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
