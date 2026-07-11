import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/profile.dto';
import { hmacSha256, normalizePhone } from '../common/utils/crypto.util';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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

      const prekeys = await tx.oneTimePrekey.findMany({
        where: {
          deviceId: { in: deviceIds },
          consumedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, deviceId: true, keyId: true, publicKey: true },
      });

      // Take the oldest unconsumed prekey per device
      const prekeyByDevice = new Map<string, typeof prekeys[0]>();
      for (const prekey of prekeys) {
        if (!prekeyByDevice.has(prekey.deviceId)) {
          prekeyByDevice.set(prekey.deviceId, prekey);
        }
      }

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

  async syncContacts(phoneHashes: string[] = [], phones: string[] = []) {
    const MAX_BATCH = 1000;
    if (phoneHashes.length + phones.length > MAX_BATCH) {
      throw new BadRequestException(`Contact batch too large. Max ${MAX_BATCH} allowed.`);
    }
    // Stored hashes are HMAC-SHA256(E.164, PHONE_HASH_PEPPER) — the pepper is
    // server-only, so raw phones are hashed here rather than by the client.
    const pepper = this.config.getOrThrow<string>('PHONE_HASH_PEPPER');
    const hashes = new Set(phoneHashes);
    // Remember which submitted phone produced each hash so matches can be
    // echoed back with the phone the CLIENT sent — that's how it re-joins a
    // match to the local address-book entry (it can't compute the hash).
    const hashToPhone = new Map<string, string>();
    for (const phone of phones) {
      const normalized = normalizePhone(phone);
      if (normalized) {
        const hash = hmacSha256(normalized, pepper);
        hashes.add(hash);
        hashToPhone.set(hash, normalized);
      }
    }
    if (hashes.size === 0) {
      return [];
    }
    const users = await this.prisma.user.findMany({
      where: {
        phoneHash: { in: [...hashes] },
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
    return users.map((user) => ({
      ...user,
      matchedPhone: user.phoneHash ? (hashToPhone.get(user.phoneHash) ?? null) : null,
    }));
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneMasked: true,
        username: true,
        profileAvatarUrl: true,
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

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          username: { equals: dto.username, mode: 'insensitive' },
          id: { not: userId },
        },
      });
      if (existingUser) {
        throw new BadRequestException('Username is already taken');
      }
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.username !== undefined && { username: dto.username }),
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

  async searchByUsername(usernameQuery: string, currentUserId?: string) {
    if (!usernameQuery || usernameQuery.trim().length < 3) {
      throw new BadRequestException('Search query must be at least 3 characters');
    }
    return this.prisma.user.findMany({
      where: {
        username: {
          contains: usernameQuery,
          mode: 'insensitive',
        },
        status: 'ACTIVE',
        ...(currentUserId && { id: { not: currentUserId } }),
      },
      take: 10,
      select: {
        id: true,
        username: true,
        profileAvatarUrl: true,
      },
    });
  }
}

