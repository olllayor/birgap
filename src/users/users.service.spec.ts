import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('returns signed prekey with null one-time prekey when OTPKs are exhausted', async () => {
    const tx = {
      oneTimePrekey: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'device-1',
            userId: 'user-1',
            platform: 'ANDROID',
            identityPublicKey: 'identity-key',
            signedPrekeys: [
              {
                id: 'signed-1',
                keyId: 10,
                publicKey: 'signed-public',
                signature: 'signature',
                createdAt: new Date('2026-01-01T00:00:00Z'),
              },
            ],
          },
        ]),
      },
      $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) => callback(tx as Record<string, unknown>)),
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(service.getDeviceKeyBundles('user-1')).resolves.toMatchObject({
      userId: 'user-1',
      devices: [
        {
          deviceId: 'device-1',
          oneTimePrekey: null,
          signedPrekey: { keyId: 10 },
        },
      ],
    });
    expect(tx.oneTimePrekey.updateMany).not.toHaveBeenCalled();
  });

  it('throws when recipient has no active devices', async () => {
    const prisma = {
      device: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(service.getDeviceKeyBundles('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('syncContacts', () => {
    it('queries active users with matching phone hashes', async () => {
      const matchedUsers = [
        { id: 'user-1', phoneHash: 'hash-1', username: 'alice' },
      ];
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue(matchedUsers) },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await expect(service.syncContacts(['hash-1', 'hash-2'])).resolves.toEqual(matchedUsers);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          phoneHash: { in: ['hash-1', 'hash-2'] },
          status: 'ACTIVE',
        },
        select: {
          id: true,
          phoneHash: true,
          username: true,
          profileAvatarUrl: true,
          encryptedProfile: true,
          profileKeyHash: true,
        },
      });
    });

    it('throws BadRequestException when batch exceeds 1000 phone hashes', async () => {
      const service = new UsersService({} as unknown as PrismaService);
      const phoneHashes = Array.from({ length: 1001 }, (_, i) => `hash-${i}`);
      await expect(service.syncContacts(phoneHashes)).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateProfile', () => {
    it('updates user profile if username is not taken', async () => {
      const mockUpdated = { id: 'user-1', username: 'bob_new' };
      const prisma = {
        user: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue(mockUpdated),
        },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await expect(
        service.updateProfile('user-1', { username: 'bob_new', profileAvatarUrl: 'http://avatar' })
      ).resolves.toEqual(mockUpdated);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          username: { equals: 'bob_new', mode: 'insensitive' },
          id: { not: 'user-1' },
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          username: 'bob_new',
          profileAvatarUrl: 'http://avatar',
        },
        select: {
          id: true,
          phoneHash: true,
          username: true,
          profileAvatarUrl: true,
          encryptedProfile: true,
          profileKeyHash: true,
          updatedAt: true,
        },
      });
    });

    it('throws BadRequestException if username is already taken by someone else', async () => {
      const prisma = {
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'user-2', username: 'bob_new' }),
        },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await expect(
        service.updateProfile('user-1', { username: 'bob_new' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on unique constraint violation (race condition)', async () => {
      const prismaError = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['username'] },
      });
      const prisma = {
        user: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockRejectedValue(prismaError),
        },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await expect(
        service.updateProfile('user-1', { username: 'race_condition_user' })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('searchByUsername', () => {
    it('throws if search query is less than 3 characters', async () => {
      const service = new UsersService({} as unknown as PrismaService);
      await expect(service.searchByUsername('ab')).rejects.toThrow(BadRequestException);
    });

    it('finds active users by startsWith match', async () => {
      const mockResult = [{ id: 'user-1', username: 'alice_smith', profileAvatarUrl: null }];
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue(mockResult) },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      const result = await service.searchByUsername('ali');
      expect(result).toEqual(mockResult);
      expect(result[0]).not.toHaveProperty('encryptedProfile');
      expect(result[0]).not.toHaveProperty('profileKeyHash');

      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.where.username.mode).toBe('insensitive');
      expect(call.where.status).toBe('ACTIVE');
      expect(call.take).toBe(10);
      expect(call.select).toEqual({
        id: true,
        username: true,
        profileAvatarUrl: true,
      });
    });

    it('excludes the requesting user from results', async () => {
      const mockResult = [
        { id: 'user-1', username: 'alice' },
        { id: 'user-2', username: 'alice_wonder' },
      ];
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue(mockResult) },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await service.searchByUsername('alice', 'user-1');
      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.where.id).toEqual({ not: 'user-1' });
      expect(call.where.status).toBe('ACTIVE');
    });

    it('returns all results when currentUserId is not provided', async () => {
      const mockResult = [{ id: 'user-1', username: 'alice' }];
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue(mockResult) },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await service.searchByUsername('alice');
      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('ACTIVE');
      expect(call.where).not.toHaveProperty('id');
    });
  });
});

