import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from './users.service';

// UsersService now also depends on ConfigService (username cooldown) and
// RedisService (presence). Tests that don't exercise those pass inert mocks.
const makeService = (
  prisma: unknown,
  opts: { config?: Partial<ConfigService>; redis?: Partial<RedisService> } = {},
) =>
  new UsersService(
    prisma as PrismaService,
    (opts.config ?? { get: () => undefined }) as unknown as ConfigService,
    (opts.redis ?? {}) as unknown as RedisService,
  );

describe('UsersService', () => {
  it('returns signed prekey with null one-time prekey when OTPKs are exhausted', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      oneTimePrekey: {
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
    const service = makeService(prisma);

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
    const service = makeService(prisma);

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
      const service = makeService(prisma);

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
      const service = makeService({});
      const phoneHashes = Array.from({ length: 1001 }, (_, i) => `hash-${i}`);
      await expect(service.syncContacts(phoneHashes)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPeerProfile', () => {
    it('returns the profile of an active user without phone fields', async () => {
      const profile = {
        id: 'user-2',
        username: 'alice',
        profileAvatarUrl: 'http://avatar',
        encryptedProfile: { blob: 'ciphertext' },
        profileKeyHash: 'key-hash',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(profile) },
        userBlock: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = makeService(prisma);

      await expect(service.getPeerProfile('user-2', 'user-1')).resolves.toEqual({
        ...profile,
        blockedByMe: false,
        blocksMe: false,
      });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-2', status: 'ACTIVE' },
        select: {
          id: true,
          username: true,
          profileAvatarUrl: true,
          encryptedProfile: true,
          profileKeyHash: true,
          createdAt: true,
        },
      });
    });

    it('sets blockedByMe/blocksMe from the block rows in each direction', async () => {
      const profile = { id: 'user-2', username: 'alice' };
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(profile) },
        userBlock: {
          findMany: jest.fn().mockResolvedValue([
            { blockerId: 'user-1' },
            { blockerId: 'user-2' },
          ]),
        },
      };
      const service = makeService(prisma);

      await expect(service.getPeerProfile('user-2', 'user-1')).resolves.toMatchObject({
        blockedByMe: true,
        blocksMe: true,
      });
      expect(prisma.userBlock.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { blockerId: 'user-1', blockedId: 'user-2' },
            { blockerId: 'user-2', blockedId: 'user-1' },
          ],
        },
        select: { blockerId: true },
      });
    });

    it('throws NotFoundException when the user is missing or not active', async () => {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(null) },
        userBlock: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = makeService(prisma);

      await expect(service.getPeerProfile('ghost', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('blocking', () => {
    it('blockUser creates a block against an active target', async () => {
      const createdAt = new Date('2026-07-01T00:00:00Z');
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-2' }) },
        userBlock: {
          create: jest.fn().mockResolvedValue({ blockedId: 'user-2', createdAt }),
        },
      };
      const service = makeService(prisma);

      await expect(service.blockUser('user-1', 'user-2')).resolves.toEqual({
        userId: 'user-2',
        blocked: true,
        createdAt,
      });
      expect(prisma.userBlock.create).toHaveBeenCalledWith({
        data: { blockerId: 'user-1', blockedId: 'user-2' },
        select: { blockedId: true, createdAt: true },
      });
    });

    it('blockUser rejects blocking yourself', async () => {
      const service = makeService({});
      await expect(service.blockUser('user-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('blockUser throws NotFoundException when target is missing or inactive', async () => {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = makeService(prisma);
      await expect(service.blockUser('user-1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blockUser is idempotent: duplicate block (P2002) returns the existing block', async () => {
      const createdAt = new Date('2026-06-01T00:00:00Z');
      const { Prisma } = jest.requireActual('@prisma/client');
      const duplicateError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['blockerId', 'blockedId'] },
      });
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-2' }) },
        userBlock: {
          create: jest.fn().mockRejectedValue(duplicateError),
          findUnique: jest.fn().mockResolvedValue({ blockedId: 'user-2', createdAt }),
        },
      };
      const service = makeService(prisma);

      await expect(service.blockUser('user-1', 'user-2')).resolves.toEqual({
        userId: 'user-2',
        blocked: true,
        createdAt,
      });
    });

    it('unblockUser is idempotent even when nothing was deleted', async () => {
      const prisma = {
        userBlock: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      const service = makeService(prisma);

      await expect(service.unblockUser('user-1', 'user-2')).resolves.toEqual({
        userId: 'user-2',
        blocked: false,
      });
      expect(prisma.userBlock.deleteMany).toHaveBeenCalledWith({
        where: { blockerId: 'user-1', blockedId: 'user-2' },
      });
    });

    it('listBlockedUsers returns blocked-user summaries with the block timestamp', async () => {
      const createdAt = new Date('2026-07-02T00:00:00Z');
      const prisma = {
        userBlock: {
          findMany: jest.fn().mockResolvedValue([
            {
              createdAt,
              blocked: { id: 'user-2', username: 'alice', profileAvatarUrl: 'http://avatar' },
            },
          ]),
        },
      };
      const service = makeService(prisma);

      await expect(service.listBlockedUsers('user-1')).resolves.toEqual([
        { id: 'user-2', username: 'alice', profileAvatarUrl: 'http://avatar', createdAt },
      ]);
      expect(prisma.userBlock.findMany).toHaveBeenCalledWith({
        where: { blockerId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          blocked: { select: { id: true, username: true, profileAvatarUrl: true } },
        },
      });
    });

    it('isBlockedEitherDirection is true when either side blocked the other', async () => {
      const prisma = {
        userBlock: { findMany: jest.fn().mockResolvedValue([{ blockerId: 'user-2' }]) },
      };
      const service = makeService(prisma);
      await expect(service.isBlockedEitherDirection('user-1', 'user-2')).resolves.toBe(true);
    });
  });

  describe('updateProfile', () => {
    it('updates user profile if username is not taken', async () => {
      const mockUpdated = { id: 'user-1', username: 'bob_new' };
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ username: null, usernameChangedAt: null }),
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue(mockUpdated),
        },
      };
      const service = makeService(prisma);

      await expect(
        service.updateProfile('user-1', { username: 'bob_new', profileAvatarUrl: 'http://avatar' })
      ).resolves.toEqual(mockUpdated);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          username: 'bob_new',
          usernameChangedAt: expect.any(Date),
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

    it('throws BadRequestException on unique constraint violation (race condition)', async () => {
      const prismaError = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['username'] },
      });
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ username: null, usernameChangedAt: null }),
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockRejectedValue(prismaError),
        },
      };
      const service = makeService(prisma);

      await expect(
        service.updateProfile('user-1', { username: 'race_condition_user' })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('searchByUsername', () => {
    it('throws if search query is less than 3 characters', async () => {
      const service = makeService({});
      await expect(service.searchByUsername('ab')).rejects.toThrow(BadRequestException);
    });

    it('finds active users by startsWith match', async () => {
      const mockResult = [{ id: 'user-1', username: 'alice_smith', profileAvatarUrl: null }];
      const prisma = {
        // searchByUsername runs a prefix query then an infix top-up query; the
        // prefix match satisfies the result, infix returns nothing extra.
        user: { findMany: jest.fn().mockResolvedValueOnce(mockResult).mockResolvedValue([]) },
      };
      const service = makeService(prisma);

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
      const service = makeService(prisma);

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
      const service = makeService(prisma);

      await service.searchByUsername('alice');
      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('ACTIVE');
      expect(call.where).not.toHaveProperty('id');
    });
  });

  describe('username cooldown', () => {
    it('rejects a change within the cooldown window', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ username: 'old_name', usernameChangedAt: oneHourAgo }),
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };
      const service = makeService(prisma, { config: { get: () => 1 } as unknown as ConfigService });

      await expect(
        service.updateProfile('user-1', { username: 'new_name' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('re-saving the same username does not enforce cooldown or restamp', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ username: 'same_name', usernameChangedAt: new Date() }),
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({ id: 'user-1', username: 'same_name' }),
        },
      };
      const service = makeService(prisma, { config: { get: () => 1 } as unknown as ConfigService });

      await service.updateProfile('user-1', { username: 'same_name' });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('usernameChangedAt');
    });
  });

  describe('getPresence', () => {
    it('reports online and hides lastSeenAt when a device holds a live socket', async () => {
      const prisma = {
        device: { findMany: jest.fn().mockResolvedValue([{ id: 'd1', lastSeenAt: new Date() }]) },
        userBlock: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const redis = { getDevicesWithSockets: jest.fn().mockResolvedValue(new Set(['d1'])) };
      const service = makeService(prisma, { redis: redis as unknown as RedisService });

      await expect(service.getPresence('user-1', 'user-9')).resolves.toEqual({
        userId: 'user-1',
        online: true,
        lastSeenAt: null,
      });
    });

    it('hides real presence when the target has blocked the requester', async () => {
      const prisma = {
        device: { findMany: jest.fn() },
        userBlock: { findUnique: jest.fn().mockResolvedValue({ id: 'block-1' }) },
      };
      const redis = { getDevicesWithSockets: jest.fn() };
      const service = makeService(prisma, { redis: redis as unknown as RedisService });

      await expect(service.getPresence('user-1', 'user-9')).resolves.toEqual({
        userId: 'user-1',
        online: false,
        lastSeenAt: null,
      });
      expect(prisma.userBlock.findUnique).toHaveBeenCalledWith({
        where: { blockerId_blockedId: { blockerId: 'user-1', blockedId: 'user-9' } },
        select: { id: true },
      });
      // No presence data is even looked up for a blocked requester.
      expect(prisma.device.findMany).not.toHaveBeenCalled();
      expect(redis.getDevicesWithSockets).not.toHaveBeenCalled();
    });

    it('reports offline with the most recent lastSeenAt across devices', async () => {
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-02-01T00:00:00Z');
      const prisma = {
        device: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'd1', lastSeenAt: older },
            { id: 'd2', lastSeenAt: newer },
          ]),
        },
        userBlock: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const redis = { getDevicesWithSockets: jest.fn().mockResolvedValue(new Set()) };
      const service = makeService(prisma, { redis: redis as unknown as RedisService });

      await expect(service.getPresence('user-1', 'user-9')).resolves.toEqual({
        userId: 'user-1',
        online: false,
        lastSeenAt: newer.toISOString(),
      });
    });
  });
});

