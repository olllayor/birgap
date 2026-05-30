import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async syncContacts(phoneHashes: string[]) {
    const MAX_BATCH = 1000;
    if (phoneHashes.length > MAX_BATCH) {
      throw new BadRequestException(`Contact batch too large. Max ${MAX_BATCH} allowed.`);
    }
    return this.prisma.user.findMany({
      where: {
        phoneHash: { in: phoneHashes },
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

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.username !== undefined && { username: dto.username }),
        ...(dto.profileAvatarUrl !== undefined && { profileAvatarUrl: dto.profileAvatarUrl }),
        ...(dto.encryptedProfile !== undefined && { encryptedProfile: dto.encryptedProfile }),
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
  }

  async searchByUsername(usernameQuery: string) {
    if (!usernameQuery || usernameQuery.trim().length < 3) {
      throw new BadRequestException('Search query must be at least 3 characters');
    }
    return this.prisma.user.findMany({
      where: {
        username: {
          startsWith: usernameQuery,
          mode: 'insensitive',
        },
        status: 'ACTIVE',
      },
      take: 10,
      select: {
        id: true,
        username: true,
        profileAvatarUrl: true,
        encryptedProfile: true,
        profileKeyHash: true,
      },
    });
  }
}

