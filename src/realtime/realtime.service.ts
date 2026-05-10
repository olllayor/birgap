import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { randomToken, sha256 } from '../common/utils/crypto.util';

@Injectable()
export class RealtimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createSocketTicket(user: AuthenticatedUser, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId: user.userId, active: true },
      select: { id: true },
    });
    if (!device) {
      throw new ForbiddenException('Device is not active for this user');
    }

    const ttlSeconds = this.config.get<number>('WEBSOCKET_TICKET_TTL_SECONDS') ?? 60;
    const ticket = randomToken(32);
    const created = await this.prisma.socketTicket.create({
      data: {
        userId: user.userId,
        deviceId,
        sessionId: user.sessionId,
        tokenHash: sha256(ticket),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });

    return {
      ticket,
      expiresAt: created.expiresAt,
    };
  }

  async consumeSocketTicket(ticket: string, socketId: string) {
    const tokenHash = sha256(ticket);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const socketTicket = await tx.socketTicket.findUnique({
        where: { tokenHash },
      });

      if (!socketTicket || socketTicket.consumedAt || socketTicket.expiresAt <= now) {
        throw new UnauthorizedException('Socket ticket is invalid');
      }

      const session = await tx.refreshToken.findUnique({
        where: { id: socketTicket.sessionId },
      });
      if (!session || session.revokedAt || session.expiresAt <= now) {
        throw new UnauthorizedException('Session is no longer active');
      }

      const device = await tx.device.findFirst({
        where: { id: socketTicket.deviceId, userId: socketTicket.userId, active: true },
      });
      if (!device) {
        throw new UnauthorizedException('Device is no longer active');
      }

      await tx.socketTicket.update({
        where: { id: socketTicket.id },
        data: { consumedAt: now, consumedBy: socketId },
      });
      await tx.device.update({
        where: { id: device.id },
        data: { lastSeenAt: now },
      });

      return {
        userId: socketTicket.userId,
        deviceId: socketTicket.deviceId,
        sessionId: socketTicket.sessionId,
      };
    });
  }
}
