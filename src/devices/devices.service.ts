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
    const maxActiveDevices = this.config.get<number>('MAX_ACTIVE_DEVICES') ?? 3;

    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.deviceId) {
        const existing = await tx.device.findUnique({ where: { id: dto.deviceId } });
        if (existing && existing.userId !== userId) {
          throw new ForbiddenException('Device belongs to another user');
        }
        if (existing) {
          return tx.device.update({
            where: { id: dto.deviceId },
            data: {
              platform: dto.platform,
              displayName: dto.displayName,
              identityPublicKey: dto.identityPublicKey,
              pushToken: dto.pushToken,
              pushPlatform: dto.pushPlatform,
              pushActive: dto.pushActive ?? false,
              active: true,
              lastSeenAt: new Date(),
            },
          });
        }
      }

      const activeCount = await tx.device.count({ where: { userId, active: true } });
      if (activeCount >= maxActiveDevices) {
        throw new ConflictException(`Maximum active devices reached (${maxActiveDevices})`);
      }

      return tx.device.create({
        data: {
          id: dto.deviceId,
          userId,
          platform: dto.platform,
          displayName: dto.displayName,
          identityPublicKey: dto.identityPublicKey,
          pushToken: dto.pushToken,
          pushPlatform: dto.pushPlatform,
          pushActive: dto.pushActive ?? false,
          lastSeenAt: new Date(),
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
