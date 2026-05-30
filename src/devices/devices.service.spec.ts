import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevicesService } from './devices.service';

describe('DevicesService', () => {
  it('blocks registration after max active devices', async () => {
    const tx = {
      device: {
        count: jest.fn().mockResolvedValue(3),
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const config = { get: jest.fn().mockReturnValue(3) } as unknown as ConfigService;
    const service = new DevicesService(prisma as any, config);

    await expect(
      service.register('user-1', {
        platform: 'ANDROID',
        identityPublicKey: 'identity-public-key',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.device.create).not.toHaveBeenCalled();
  });

  it('registers device successfully', async () => {
    const tx = {
      device: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1' }),
        findUnique: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const config = { get: jest.fn().mockReturnValue(3) } as unknown as ConfigService;
    const service = new DevicesService(prisma as any, config);

    const result = await service.register('user-1', {
      platform: 'ANDROID',
      identityPublicKey: 'identity-public-key',
    } as any);

    expect(result).toMatchObject({ id: 'device-1' });
  });

  it('deactivates device successfully', async () => {
    const prisma = {
      device: {
        findUnique: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1' }),
        update: jest.fn().mockResolvedValue({ id: 'device-1', active: false }),
      },
    };
    const config = { get: jest.fn() } as unknown as ConfigService;
    const service = new DevicesService(prisma as any, config);

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
    const service = new DevicesService(prisma as any, config);

    await expect(service.deactivate('user-1', 'device-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
