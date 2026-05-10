import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('returns signed prekey with null one-time prekey when OTPKs are exhausted', async () => {
    const tx = {
      oneTimePrekey: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'device-1',
            userId: 'user-1',
            platform: 'ANDROID',
            identityPublicKey: 'identity-key',
            signedPrekeys: [
              {
                id: 'signed-1',
                keyId: 10,
                publicKey: 'signed-public',
                signature: 'signature',
                createdAt: new Date('2026-01-01T00:00:00Z'),
              },
            ],
          },
        ]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new UsersService(prisma as any);

    await expect(service.getDeviceKeyBundles('user-1')).resolves.toMatchObject({
      userId: 'user-1',
      devices: [
        {
          deviceId: 'device-1',
          oneTimePrekey: null,
          signedPrekey: { keyId: 10 },
        },
      ],
    });
  });

  it('throws when recipient has no active devices', async () => {
    const prisma = {
      device: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new UsersService(prisma as any);

    await expect(service.getDeviceKeyBundles('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
