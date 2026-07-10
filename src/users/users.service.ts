import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { isUniqueViolationOn } from '../common/utils/prisma-retry.util';
import { UpdateProfileDto, USERNAME_REGEX } from './dto/profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  async getDeviceKeyBundles(userId: string) {
    const devices = await this.prisma.device.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        platform: true,
        identityPublicKey: true,
        signedPrekeys: {
          where: { active: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            keyId: true,
            publicKey: true,
            signature: true,
            createdAt: true,
          },
        },
      },
    });

    if (devices.length === 0) {
      throw new NotFoundException('No active devices found for user');
    }

    return this.prisma.$transaction(async (tx) => {
      const deviceIds = devices.map((d) => d.id);

      // C10 fix: Use SELECT ... FOR UPDATE SKIP LOCKED to atomically select the
      // oldest unconsumed one-time prekey per device. This prevents two concurrent
      // callers from obtaining the same prekey — rows locked by another transaction
      // are silently skipped.
      const prekeys = deviceIds.length > 0
        ? await tx.$queryRawUnsafe<Array<{ id: string; deviceId: string; keyId: number; publicKey: string }>>(
            `SELECT p.id, p."deviceId", p."keyId", p."publicKey"
             FROM unnest($1::uuid[]) AS d("deviceId")
             CROSS JOIN LATERAL (
               SELECT otp.id, otp."deviceId", otp."keyId", otp."publicKey"
               FROM "OneTimePrekey" otp
               WHERE otp."deviceId" = d."deviceId"
                 AND otp."consumedAt" IS NULL
               ORDER BY otp."createdAt" ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED
             ) p`,
            deviceIds,
          )
        : [];

      const prekeyByDevice = new Map<string, (typeof prekeys)[0]>();
      for (const prekey of prekeys) {
        prekeyByDevice.set(prekey.deviceId, prekey);
      }

      // Mark the selected prekeys as consumed
      if (prekeyByDevice.size > 0) {
        await tx.oneTimePrekey.updateMany({
          where: {
            id: {
              in: Array.from(prekeyByDevice.values()).map((p) => p.id),
            },
          },
          data: { consumedAt: new Date() },
        });
      }

      const bundles = devices.map((device) => {
        const oneTimePrekey = prekeyByDevice.get(device.id) ?? null;
        return {
          deviceId: device.id,
          userId: device.userId,
          platform: device.platform,
          identityPublicKey: device.identityPublicKey,
          signedPrekey: device.signedPrekeys[0] ?? null,
          oneTimePrekey: oneTimePrekey
            ? { keyId: oneTimePrekey.keyId, publicKey: oneTimePrekey.publicKey }
            : null,
        };
      });

      return { userId, devices: bundles };
    });
  }

  async syncContacts(phoneHashes: string[], currentUserId?: string) {
    const MAX_BATCH = 1000;
    if (phoneHashes.length > MAX_BATCH) {
      throw new BadRequestException(`Contact batch too large. Max ${MAX_BATCH} allowed.`);
    }
    return this.prisma.user.findMany({
      where: {
        phoneHash: { in: phoneHashes },
        status: 'ACTIVE',
        // Don't return the caller as their own "contact".
        ...(currentUserId && { id: { not: currentUserId } }),
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
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneMasked: true,
        username: true,
        profileAvatarUrl: true,
        // E2EE profile: the Signal-style display name (first/last) lives inside
        // encryptedProfile, decrypted client-side with the key hashed as
        // profileKeyHash. Return both so the client can render its own name.
        encryptedProfile: true,
        profileKeyHash: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // Peer profile for the chat header / contact card. Only ACTIVE users are
  // visible to peers; phone fields are deliberately excluded. The E2EE display
  // name lives inside encryptedProfile and is decrypted client-side.
  async getPeerProfile(targetUserId: string, requesterId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, status: 'ACTIVE' },
      select: {
        id: true,
        username: true,
        profileAvatarUrl: true,
        encryptedProfile: true,
        profileKeyHash: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { blockedByMe, blocksMe } = await this.getBlockStatus(requesterId, targetUserId);
    return { ...user, blockedByMe, blocksMe };
  }

  // ---------------------------------------------------------------------------
  // User blocking (Telegram-style). Blocking is one-directional in storage but
  // most enforcement (message send, typing) applies in either direction.
  // ---------------------------------------------------------------------------

  async blockUser(blockerId: string, targetUserId: string) {
    if (blockerId === targetUserId) {
      throw new BadRequestException('Cannot block yourself');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    try {
      const block = await this.prisma.userBlock.create({
        data: { blockerId, blockedId: targetUserId },
        select: { blockedId: true, createdAt: true },
      });
      return { userId: block.blockedId, blocked: true, createdAt: block.createdAt };
    } catch (error) {
      // Idempotent: blocking an already-blocked user succeeds with the
      // existing block instead of surfacing a 409/500.
      if (isUniqueViolationOn(error, 'blockerId')) {
        const existing = await this.prisma.userBlock.findUnique({
          where: { blockerId_blockedId: { blockerId, blockedId: targetUserId } },
          select: { blockedId: true, createdAt: true },
        });
        if (existing) {
          return { userId: existing.blockedId, blocked: true, createdAt: existing.createdAt };
        }
      }
      throw error;
    }
  }

  // Idempotent: unblocking someone who was never blocked is still a success.
  async unblockUser(blockerId: string, targetUserId: string) {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId, blockedId: targetUserId },
    });
    return { userId: targetUserId, blocked: false };
  }

  async listBlockedUsers(userId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        blocked: {
          select: { id: true, username: true, profileAvatarUrl: true },
        },
      },
    });
    return blocks.map((block) => ({
      id: block.blocked.id,
      username: block.blocked.username,
      profileAvatarUrl: block.blocked.profileAvatarUrl,
      createdAt: block.createdAt,
    }));
  }

  // One indexed query answering both directions at once.
  async getBlockStatus(meId: string, otherId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: meId, blockedId: otherId },
          { blockerId: otherId, blockedId: meId },
        ],
      },
      select: { blockerId: true },
    });
    return {
      blockedByMe: blocks.some((b) => b.blockerId === meId),
      blocksMe: blocks.some((b) => b.blockerId === otherId),
    };
  }

  async isBlockedEitherDirection(userIdA: string, userIdB: string): Promise<boolean> {
    const status = await this.getBlockStatus(userIdA, userIdB);
    return status.blockedByMe || status.blocksMe;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // H5 fix: Remove the pre-flight check for username uniqueness — it has an
    // unavoidable race condition. The `@@unique([username])` constraint on the
    // User model is the source of truth; the P2002 handler below catches the
    // race correctly and returns a consistent error to the user.

    // Only stamp usernameChangedAt (and enforce the cooldown) when the username
    // actually changes, so re-saving the same profile does not reset the clock.
    let usernameChanged = false;
    if (dto.username !== undefined) {
      usernameChanged = await this.assertUsernameChangeAllowed(userId, dto.username);
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.username !== undefined && { username: dto.username }),
          ...(usernameChanged && { usernameChangedAt: new Date() }),
          ...(dto.profileAvatarUrl !== undefined && { profileAvatarUrl: dto.profileAvatarUrl }),
          ...(dto.encryptedProfile !== undefined && { encryptedProfile: dto.encryptedProfile as Prisma.InputJsonValue }),
          ...(dto.profileKeyHash !== undefined && { profileKeyHash: dto.profileKeyHash }),
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
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('Username is already taken');
      }
      throw error;
    }
  }

  // Exact-match username resolve (QR codes / birgap://user/<username> deep
  // links). Case-insensitive, ACTIVE users only, same public subset as search.
  async resolveByUsername(usernameRaw: string) {
    const username = (usernameRaw ?? '').trim().replace(/^@/, '');
    if (!USERNAME_REGEX.test(username)) {
      throw new BadRequestException('Invalid username');
    }
    const user = await this.prisma.user.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        username: true,
        profileAvatarUrl: true,
        encryptedProfile: true,
        profileKeyHash: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async searchByUsername(usernameQuery: string, currentUserId?: string) {
    // Telegram-style: a leading @ is part of how people write usernames, not
    // part of the username itself.
    const query = (usernameQuery ?? '').trim().replace(/^@/, '');
    if (query.length < 3) {
      throw new BadRequestException('Search query must be at least 3 characters');
    }

    const LIMIT = 10;
    const select = { id: true, username: true, profileAvatarUrl: true };
    const baseWhere = {
      status: 'ACTIVE' as const,
      ...(currentUserId && { id: { not: currentUserId } }),
    };

    // Prefix matches rank first (how Telegram orders global username results),
    // then infix matches fill the remainder.
    const prefixMatches = await this.prisma.user.findMany({
      where: {
        ...baseWhere,
        username: { startsWith: query, mode: 'insensitive' },
      },
      orderBy: { username: 'asc' },
      take: LIMIT,
      select,
    });
    if (prefixMatches.length >= LIMIT) {
      return prefixMatches;
    }

    const infixMatches = await this.prisma.user.findMany({
      where: {
        ...baseWhere,
        username: { contains: query, mode: 'insensitive' },
        id: { notIn: prefixMatches.map((u) => u.id).concat(currentUserId ? [currentUserId] : []) },
      },
      orderBy: { username: 'asc' },
      take: LIMIT - prefixMatches.length,
      select,
    });

    return [...prefixMatches, ...infixMatches];
  }

  async checkUsernameAvailable(usernameQuery: string, currentUserId: string) {
    const username = (usernameQuery ?? '').trim().replace(/^@/, '');
    if (!USERNAME_REGEX.test(username)) {
      return { valid: false, available: false };
    }
    const existing = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    return { valid: true, available: !existing || existing.id === currentUserId };
  }

  // Returns true when the username genuinely changes (caller should stamp
  // usernameChangedAt). Returns false when it is unchanged. Throws when a
  // configured cooldown (USERNAME_CHANGE_COOLDOWN_DAYS) has not yet elapsed —
  // Telegram-style anti-flap / anti-squatting.
  private async assertUsernameChangeAllowed(userId: string, newUsername: string): Promise<boolean> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, usernameChangedAt: true },
    });

    if (current?.username && current.username.toLowerCase() === newUsername.toLowerCase()) {
      return false;
    }

    const cooldownDays = Number(this.config.get('USERNAME_CHANGE_COOLDOWN_DAYS') ?? 0) || 0;
    if (cooldownDays > 0 && current?.usernameChangedAt) {
      const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
      const nextAllowed = current.usernameChangedAt.getTime() + cooldownMs;
      const now = Date.now();
      if (nextAllowed > now) {
        const daysLeft = Math.ceil((nextAllowed - now) / (24 * 60 * 60 * 1000));
        throw new BadRequestException(
          `Username was changed recently. Try again in ${daysLeft} day(s).`,
        );
      }
    }

    return true;
  }

  // Coarse presence for "last seen" under the chat title. online = any active
  // device currently holds a live socket (tracked in Redis); otherwise we
  // surface the most recent device lastSeenAt.
  async getPresence(userId: string, requesterId: string) {
    // If the target has blocked the requester, present them as permanently
    // offline instead of leaking real presence (Telegram behaviour).
    const blockedRequester = await this.prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: requesterId } },
      select: { id: true },
    });
    if (blockedRequester) {
      return { userId, online: false, lastSeenAt: null };
    }

    const devices = await this.prisma.device.findMany({
      where: { userId, active: true },
      select: { id: true, lastSeenAt: true },
    });

    if (devices.length === 0) {
      return { userId, online: false, lastSeenAt: null };
    }

    const online = (await this.redis.getDevicesWithSockets(devices.map((d) => d.id))).size > 0;

    const lastSeenAt = devices.reduce<Date | null>((latest, d) => {
      if (!d.lastSeenAt) return latest;
      return !latest || d.lastSeenAt > latest ? d.lastSeenAt : latest;
    }, null);

    return {
      userId,
      online,
      // Hide the exact timestamp while online — the client shows "online" instead.
      lastSeenAt: online ? null : lastSeenAt?.toISOString() ?? null,
    };
  }
}

