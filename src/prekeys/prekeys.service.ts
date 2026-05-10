import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RefillPrekeysDto } from './dto/refill-prekeys.dto';
import { RotateSignedPrekeyDto } from './dto/rotate-signed-prekey.dto';

@Injectable()
export class PreKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async refill(userId: string, deviceId: string, dto: RefillPrekeysDto) {
    await this.assertDeviceOwner(userId, deviceId);

    const result = await this.prisma.oneTimePrekey.createMany({
      data: dto.prekeys.map((prekey) => ({
        deviceId,
        keyId: prekey.keyId,
        publicKey: prekey.publicKey,
      })),
      skipDuplicates: true,
    });

    return { inserted: result.count };
  }

  async rotateSignedPrekey(userId: string, deviceId: string, dto: RotateSignedPrekeyDto) {
    await this.assertDeviceOwner(userId, deviceId);

    return this.prisma.$transaction(async (tx) => {
      await tx.signedPrekey.updateMany({
        where: { deviceId, active: true },
        data: { active: false },
      });

      return tx.signedPrekey.upsert({
        where: { deviceId_keyId: { deviceId, keyId: dto.keyId } },
        update: {
          publicKey: dto.publicKey,
          signature: dto.signature,
          active: true,
          createdAt: new Date(),
        },
        create: {
          deviceId,
          keyId: dto.keyId,
          publicKey: dto.publicKey,
          signature: dto.signature,
        },
      });
    });
  }

  private async assertDeviceOwner(userId: string, deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || !device.active) {
      throw new NotFoundException('Active device not found');
    }
    if (device.userId !== userId) {
      throw new ForbiddenException('Device belongs to another user');
    }
  }
}
