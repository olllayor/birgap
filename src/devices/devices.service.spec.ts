import { ConflictException } from '@nestjs/common';
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
});
