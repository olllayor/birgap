import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GroupsService } from './groups.service';

describe('GroupsService', () => {
  let service: GroupsService;

  beforeEach(() => {
    const mockPrisma: {
      group: { create: jest.Mock };
      groupMember: {
        findUnique: jest.Mock;
        findMany: jest.Mock;
        createMany: jest.Mock;
        delete: jest.Mock;
      };
      message: {
        findUnique: jest.Mock;
        findFirst: jest.Mock;
        create: jest.Mock;
      };
      $transaction: jest.Mock;
    } = {
      group: {
        create: jest.fn(),
      },
      groupMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        createMany: jest.fn(),
        delete: jest.fn(),
      },
      message: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) =>
        callback(mockPrisma as Record<string, unknown>),
      ),
    };
    const prisma = mockPrisma as unknown as PrismaService;

    const redis = {
      setGroupMemberIds: jest.fn().mockResolvedValue(undefined),
      invalidateGroupMemberIds: jest.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;

    const queue = {
      add: jest.fn(),
    } as unknown as Queue;

    service = new GroupsService(prisma, redis, queue);
  });

  describe('createGroup', () => {
    it('creates group and members inside transaction', async () => {
      // Re-create with accessible mocks for this test
      const mockPrisma: {
        group: { create: jest.Mock };
        $transaction: jest.Mock;
      } = {
        group: {
          create: jest.fn().mockResolvedValue({ id: 'group-1', members: [] }),
        },
        $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) =>
          callback(mockPrisma as Record<string, unknown>),
        ),
      };
      const prisma = mockPrisma as unknown as PrismaService;
      const redis = {
        setGroupMemberIds: jest.fn().mockResolvedValue(undefined),
        invalidateGroupMemberIds: jest.fn().mockResolvedValue(undefined),
      } as unknown as RedisService;
      const queue = { add: jest.fn() } as unknown as Queue;
      const testService = new GroupsService(prisma, redis, queue);

      const dto = {
        encryptedMetadata: { name: 'Encrypted Group' },
        members: ['user-2', 'user-3'],
      };

      await expect(testService.createGroup('user-1', dto)).resolves.toEqual({ id: 'group-1', members: [] });

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: {
          encryptedMetadata: dto.encryptedMetadata,
          members: {
            create: [
              { userId: 'user-1', role: 'ADMIN' },
              { userId: 'user-2', role: 'MEMBER' },
              { userId: 'user-3', role: 'MEMBER' },
            ],
          },
        },
        include: {
          members: true,
        },
      });
    });
  });

  describe('addMembers', () => {
    it('throws ForbiddenException if requesting user is not admin', async () => {
      const prisma = {
        groupMember: {
          findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }),
        },
      } as unknown as PrismaService;
      const testService = new GroupsService(prisma, {} as unknown as RedisService, {} as unknown as Queue);

      await expect(
        testService.addMembers('user-2', 'group-1', ['user-4'])
      ).rejects.toThrow(ForbiddenException);
    });

    it('adds only non-existing members', async () => {
      const prisma = {
        groupMember: {
          findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
          findMany: jest.fn().mockResolvedValue([{ userId: 'user-2' }]),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as PrismaService;
      const redis = {
        invalidateGroupMemberIds: jest.fn().mockResolvedValue(undefined),
      } as unknown as RedisService;
      const testService = new GroupsService(prisma, redis, {} as unknown as Queue);

      const res = await testService.addMembers('user-1', 'group-1', ['user-2', 'user-3']);
      expect(res).toEqual({ count: 1 });

      expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
        data: [
          { groupId: 'group-1', userId: 'user-3', role: 'MEMBER' },
        ],
      });
    });
  });

  describe('removeMember', () => {
    it('allows a user to leave the group themselves', async () => {
      const prisma = {
        groupMember: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' })
            .mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' }),
          delete: jest.fn().mockResolvedValue({ userId: 'user-2' }),
        },
      } as unknown as PrismaService;
      const redis = {
        invalidateGroupMemberIds: jest.fn().mockResolvedValue(undefined),
      } as unknown as RedisService;
      const testService = new GroupsService(prisma, redis, {} as unknown as Queue);

      await expect(testService.removeMember('user-2', 'group-1', 'user-2')).resolves.toBeDefined();
      expect(prisma.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'group-1', userId: 'user-2' } },
      });
    });

    it('allows admin to remove a member', async () => {
      const prisma = {
        groupMember: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ userId: 'user-1', role: 'ADMIN' })
            .mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' }),
          delete: jest.fn().mockResolvedValue({ userId: 'user-2' }),
        },
      } as unknown as PrismaService;
      const redis = {
        invalidateGroupMemberIds: jest.fn().mockResolvedValue(undefined),
      } as unknown as RedisService;
      const testService = new GroupsService(prisma, redis, {} as unknown as Queue);

      await expect(testService.removeMember('user-1', 'group-1', 'user-2')).resolves.toBeDefined();
    });

    it('throws ForbiddenException if non-admin tries to remove someone else', async () => {
      const prisma = {
        groupMember: {
          findUnique: jest.fn().mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' }),
        },
      } as unknown as PrismaService;
      const testService = new GroupsService(prisma, {} as unknown as RedisService, {} as unknown as Queue);

      await expect(
        testService.removeMember('user-2', 'group-1', 'user-3')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('queueGroupMessage', () => {
    it('throws ForbiddenException if sender is not member', async () => {
      const prisma = {
        groupMember: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaService;
      const testService = new GroupsService(prisma, {} as unknown as RedisService, {} as unknown as Queue);

      await expect(
        testService.queueGroupMessage('user-1', 'group-1', {
          senderDeviceId: 'dev-1',
          idempotencyKey: 'key-12345678',
          ciphertext: 'cipher',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns immediately if message already exists (idempotency)', async () => {
      const prisma = {
        groupMember: {
          findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }),
        },
        message: {
          findUnique: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        },
      } as unknown as PrismaService;
      const testService = new GroupsService(prisma, {} as unknown as RedisService, {} as unknown as Queue);

      await expect(
        testService.queueGroupMessage('user-1', 'group-1', {
          senderDeviceId: 'dev-1',
          idempotencyKey: 'key-12345678',
          ciphertext: 'cipher',
        })
      ).resolves.toEqual({ success: true, messageId: 'msg-1', queued: false });
    });

    it('creates message with incremented sequence and queues job', async () => {
      const mockPrisma: {
        groupMember: { findUnique: jest.Mock };
        message: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
        $transaction: jest.Mock;
      } = {
        groupMember: {
          findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }),
        },
        message: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue({ threadSequence: 5 }),
          create: jest.fn().mockResolvedValue({ id: 'msg-2', threadSequence: 6, createdAt: new Date('2026-01-01T00:00:00Z') }),
        },
        $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) =>
          callback(mockPrisma as Record<string, unknown>),
        ),
      };
      const prisma = mockPrisma as unknown as PrismaService;
      const queue = {
        add: jest.fn(),
      } as unknown as Queue;
      const testService = new GroupsService(prisma, {} as unknown as RedisService, queue);

      const dto = {
        senderDeviceId: 'dev-1',
        idempotencyKey: 'key-12345678',
        ciphertext: 'cipher',
      };

      await expect(
        testService.queueGroupMessage('user-1', 'group-1', dto)
      ).resolves.toEqual({ success: true, messageId: 'msg-2', queued: true });

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-1',
          senderUserId: 'user-1',
          senderDeviceId: 'dev-1',
          idempotencyKey: 'key-12345678',
          threadSequence: 6,
        },
      });

      expect(queue.add).toHaveBeenCalledWith('fanout', {
        messageId: 'msg-2',
        groupId: 'group-1',
        senderUserId: 'user-1',
        senderDeviceId: 'dev-1',
        ciphertext: 'cipher',
        threadSequence: 6,
        createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      });
    });
  });
});
