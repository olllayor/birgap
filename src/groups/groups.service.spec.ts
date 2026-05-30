import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupsService } from './groups.service';

describe('GroupsService', () => {
  let prisma: any;
  let redis: any;
  let queue: any;
  let service: GroupsService;

  beforeEach(() => {
    prisma = {
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
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    redis = {
      setGroupMemberIds: jest.fn().mockResolvedValue(undefined),
      invalidateGroupMemberIds: jest.fn().mockResolvedValue(undefined),
    };

    queue = {
      add: jest.fn(),
    };

    service = new GroupsService(prisma, redis, queue);
  });

  describe('createGroup', () => {
    it('creates group and members inside transaction', async () => {
      const mockGroup = { id: 'group-1', members: [] };
      prisma.group.create.mockResolvedValue(mockGroup);

      const dto = {
        encryptedMetadata: { name: 'Encrypted Group' },
        members: ['user-2', 'user-3'],
      };

      await expect(service.createGroup('user-1', dto)).resolves.toEqual(mockGroup);

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
      prisma.groupMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // User is member but not admin

      await expect(
        service.addMembers('user-2', 'group-1', ['user-4'])
      ).rejects.toThrow(ForbiddenException);
    });

    it('adds only non-existing members', async () => {
      prisma.groupMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
      prisma.groupMember.findMany.mockResolvedValue([{ userId: 'user-2' }]); // user-2 already in group
      prisma.groupMember.createMany.mockResolvedValue({ count: 1 });

      const res = await service.addMembers('user-1', 'group-1', ['user-2', 'user-3']);
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
      prisma.groupMember.findUnique
        .mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' }) // requesting user
        .mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' }); // target user
      prisma.groupMember.delete.mockResolvedValue({ userId: 'user-2' });

      await expect(service.removeMember('user-2', 'group-1', 'user-2')).resolves.toBeDefined();
      expect(prisma.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'group-1', userId: 'user-2' } },
      });
    });

    it('allows admin to remove a member', async () => {
      prisma.groupMember.findUnique
        .mockResolvedValueOnce({ userId: 'user-1', role: 'ADMIN' }) // requesting user (admin)
        .mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' }); // target user
      prisma.groupMember.delete.mockResolvedValue({ userId: 'user-2' });

      await expect(service.removeMember('user-1', 'group-1', 'user-2')).resolves.toBeDefined();
    });

    it('throws ForbiddenException if non-admin tries to remove someone else', async () => {
      prisma.groupMember.findUnique
        .mockResolvedValueOnce({ userId: 'user-2', role: 'MEMBER' }); // requesting user (non-admin)

      await expect(
        service.removeMember('user-2', 'group-1', 'user-3')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('queueGroupMessage', () => {
    it('throws ForbiddenException if sender is not member', async () => {
      prisma.groupMember.findUnique.mockResolvedValue(null);

      await expect(
        service.queueGroupMessage('user-1', 'group-1', {
          senderDeviceId: 'dev-1',
          idempotencyKey: 'key-12345678',
          ciphertext: 'cipher',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns immediately if message already exists (idempotency)', async () => {
      prisma.groupMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      prisma.message.findUnique.mockResolvedValue({ id: 'msg-1' });

      await expect(
        service.queueGroupMessage('user-1', 'group-1', {
          senderDeviceId: 'dev-1',
          idempotencyKey: 'key-12345678',
          ciphertext: 'cipher',
        })
      ).resolves.toEqual({ success: true, messageId: 'msg-1', queued: false });
    });

    it('creates message with incremented sequence and queues job', async () => {
      prisma.groupMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.message.findFirst.mockResolvedValue({ threadSequence: 5 }); // previous max sequence
      const mockCreated = { id: 'msg-2', threadSequence: 6, createdAt: new Date('2026-01-01T00:00:00Z') };
      prisma.message.create.mockResolvedValue(mockCreated);

      const dto = {
        senderDeviceId: 'dev-1',
        idempotencyKey: 'key-12345678',
        ciphertext: 'cipher',
      };

      await expect(
        service.queueGroupMessage('user-1', 'group-1', dto)
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
        createdAt: mockCreated.createdAt.toISOString(),
      });
    });
  });
});
