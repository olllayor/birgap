import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      const bundles: Array<{
        deviceId: string;
        userId: string;
        platform: string;
        identityPublicKey: string;
        signedPrekey: {
          id: string;
          keyId: number;
          publicKey: string;
          signature: string;
          createdAt: Date;
        } | null;
        oneTimePrekey: {
          keyId: number;
          publicKey: string;
        } | null;
      }> = [];

      for (const device of devices) {
        const oneTimePrekey = await tx.oneTimePrekey.findFirst({
          where: { deviceId: device.id, consumedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, keyId: true, publicKey: true },
        });

        if (oneTimePrekey) {
          await tx.oneTimePrekey.update({
            where: { id: oneTimePrekey.id },
            data: { consumedAt: new Date() },
          });
        }

        bundles.push({
          deviceId: device.id,
          userId: device.userId,
          platform: device.platform,
          identityPublicKey: device.identityPublicKey,
          signedPrekey: device.signedPrekeys[0] ?? null,
          oneTimePrekey: oneTimePrekey
            ? {
                keyId: oneTimePrekey.keyId,
                publicKey: oneTimePrekey.publicKey,
              }
            : null,
        });
      }

      return { userId, devices: bundles };
    });
  }
}
