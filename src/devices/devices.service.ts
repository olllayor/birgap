import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async register(userId: string, dto: RegisterDeviceDto) {
    // Active-device cap: 0 / unset = unlimited. Env values arrive as strings,
    // so coerce explicitly (a bare string would break the numeric comparison).
    const maxActiveDevices = Number(this.config.get('MAX_ACTIVE_DEVICES') ?? 0) || 0;

    const result = await this.prisma.$transaction(async (tx) => {
      const upsertData = {
        platform: dto.platform,
        displayName: dto.displayName,
        identityPublicKey: dto.identityPublicKey,
        pushToken: dto.pushToken,
        pushPlatform: dto.pushPlatform,
        pushActive: dto.pushActive ?? false,
        active: true,
        lastSeenAt: new Date(),
      };

      // 1. Reactivate by explicit client-known deviceId.
      if (dto.deviceId) {
        const existing = await tx.device.findUnique({ where: { id: dto.deviceId } });
        if (existing && existing.userId !== userId) {
          throw new ForbiddenException('Device belongs to another user');
        }
        if (existing) {
          return tx.device.update({ where: { id: dto.deviceId }, data: upsertData });
        }
      }

      // 2. Self-heal: a returning device that regenerated its deviceId but kept
      // its long-term identity keypair reclaims its existing record instead of
      // counting as a brand-new device. Without this, a client that does not
      // persist deviceId across logins exhausts the active-device cap and locks
      // itself out. The response carries the reclaimed id so the client adopts it.
      const byKey = await tx.device.findFirst({
        where: { userId, identityPublicKey: dto.identityPublicKey },
        orderBy: { createdAt: 'desc' },
      });
      if (byKey) {
        return tx.device.update({ where: { id: byKey.id }, data: upsertData });
      }

      // 3. Genuinely new device. Cap enforced only when maxActiveDevices > 0.
      if (maxActiveDevices > 0) {
        const activeCount = await tx.device.count({ where: { userId, active: true } });
        if (activeCount >= maxActiveDevices) {
          throw new ConflictException(`Maximum active devices reached (${maxActiveDevices})`);
        }
      }

      return tx.device.create({
        data: {
          id: dto.deviceId,
          userId,
          ...upsertData,
        },
      });
    });

    return result;
  }

  async list(userId: string) {
    return this.prisma.device.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        platform: true,
        displayName: true,
        pushPlatform: true,
        pushActive: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
  }

  async deactivate(userId: string, deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    if (device.userId !== userId) {
      throw new ForbiddenException('Device belongs to another user');
    }

    return this.prisma.device.update({
      where: { id: deviceId },
      data: { active: false, pushActive: false },
      select: { id: true, active: true },
    });
  }
}
