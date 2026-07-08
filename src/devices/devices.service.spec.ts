import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

describe('DevicesService', () => {
  it('blocks registration after max active devices', async () => {
    const tx = {
      device: {
        count: jest.fn().mockResolvedValue(3),
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) => callback(tx as Record<string, unknown>)),
    };
    const config = { get: jest.fn().mockReturnValue(3) } as unknown as ConfigService;
    const service = new DevicesService(prisma as unknown as PrismaService, config);

    await expect(
      service.register('user-1', {
        platform: 'ANDROID',
        identityPublicKey: 'identity-public-key',
      } as unknown as RegisterDeviceDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.device.create).not.toHaveBeenCalled();
  });

  it('registers device successfully', async () => {
    const tx = {
      device: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1' }),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) => callback(tx as Record<string, unknown>)),
    };
    const config = { get: jest.fn().mockReturnValue(3) } as unknown as ConfigService;
    const service = new DevicesService(prisma as unknown as PrismaService, config);

    const result = await service.register('user-1', {
      platform: 'ANDROID',
      identityPublicKey: 'identity-public-key',
    } as unknown as RegisterDeviceDto);

    expect(result).toMatchObject({ id: 'device-1' });
  });

  it('reclaims existing device by identity key when cap is reached, bypassing the limit', async () => {
    const tx = {
      device: {
        count: jest.fn().mockResolvedValue(3),
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'old-device', userId: 'user-1' }),
        update: jest.fn().mockResolvedValue({ id: 'old-device', userId: 'user-1', active: true }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) => callback(tx as Record<string, unknown>)),
    };
    const config = { get: jest.fn().mockReturnValue(3) } as unknown as ConfigService;
    const service = new DevicesService(prisma as unknown as PrismaService, config);

    const result = await service.register('user-1', {
      platform: 'ANDROID',
      identityPublicKey: 'identity-public-key',
    } as unknown as RegisterDeviceDto);

    expect(result).toMatchObject({ id: 'old-device', active: true });
    expect(tx.device.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'old-device' } }),
    );
    expect(tx.device.count).not.toHaveBeenCalled();
    expect(tx.device.create).not.toHaveBeenCalled();
  });

  it('deactivates device successfully', async () => {
    const prisma = {
      device: {
        findUnique: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1' }),
        update: jest.fn().mockResolvedValue({ id: 'device-1', active: false }),
      },
    };
    const config = { get: jest.fn() } as unknown as ConfigService;
    const service = new DevicesService(prisma as unknown as PrismaService, config);

    const result = await service.deactivate('user-1', 'device-1');

    expect(result).toMatchObject({ id: 'device-1', active: false });
  });

  it('fails to deactivate when device not found', async () => {
    const prisma = {
      device: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const config = { get: jest.fn() } as unknown as ConfigService;
    const service = new DevicesService(prisma as unknown as PrismaService, config);

    await expect(service.deactivate('user-1', 'device-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
