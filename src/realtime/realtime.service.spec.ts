import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  it('creates socket tickets only for active owned devices', async () => {
    const prisma = {
      device: {
        findFirst: jest.fn().mockResolvedValue({ id: 'device-1' }),
      },
      socketTicket: {
        create: jest.fn().mockResolvedValue({ expiresAt: new Date('2026-01-01T00:01:00Z') }),
      },
    };
    const config = { get: jest.fn().mockReturnValue(60) } as unknown as ConfigService;
    const service = new RealtimeService(prisma as unknown as PrismaService, config);

    const result = await service.createSocketTicket({ userId: 'user-1', sessionId: 'session-1', role: 'USER' }, 'device-1');

    expect(result.ticket).toEqual(expect.any(String));
    expect(prisma.socketTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          deviceId: 'device-1',
          sessionId: 'session-1',
        }),
      }),
    );
  });

  it('rejects consumed socket tickets', async () => {
    const tx = {
      socketTicket: {
        findUnique: jest.fn().mockResolvedValue({
          consumedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: Record<string, unknown>) => unknown) => callback(tx as Record<string, unknown>)),
    };
    const config = { get: jest.fn().mockReturnValue(60) } as unknown as ConfigService;
    const service = new RealtimeService(prisma as unknown as PrismaService, config);

    await expect(service.consumeSocketTicket('ticket', 'socket-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
