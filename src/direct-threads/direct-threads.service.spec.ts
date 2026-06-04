import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DirectThreadsService } from './direct-threads.service';

describe('DirectThreadsService', () => {
  it('findById returns thread without messages', async () => {
    const prisma = {
      directThread: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'thread-1',
          userAId: 'user-1',
          userBId: 'user-2',
          latestSequence: 5,
        }),
      },
    };
    const service = new DirectThreadsService(prisma as unknown as PrismaService);

    const result = await service.findById('thread-1');
    expect(result).toMatchObject({ id: 'thread-1' });
    expect(prisma.directThread.findUnique).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
    });
  });

  it('findById throws when thread not found', async () => {
    const prisma = {
      directThread: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new DirectThreadsService(prisma as unknown as PrismaService);

    await expect(service.findById('thread-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByUser returns threads without messages', async () => {
    const prisma = {
      directThread: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'thread-1', userAId: 'user-1', userBId: 'user-2' },
        ]),
      },
    };
    const service = new DirectThreadsService(prisma as unknown as PrismaService);

    const result = await service.findByUser('user-1');
    expect(result).toHaveLength(1);
    expect(prisma.directThread.findMany).toHaveBeenCalledWith({
      where: { OR: [{ userAId: 'user-1' }, { userBId: 'user-1' }] },
      orderBy: { updatedAt: 'desc' },
    });
  });
});
