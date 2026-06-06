import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { AccountSuspendedException } from '../../moderation/exceptions/account-suspended.exception';

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  protected getRequest(context: ExecutionContext): AuthenticatedRequest {
    return context.switchToHttp().getRequest();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = this.getRequest(context);
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice('Bearer '.length);
    let payload: AccessTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const session = await this.prisma.refreshToken.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: { status: true, role: true },
        },
      },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Session is no longer active');
    }

    if (session.user.status === 'SUSPENDED') {
      const suspension = await this.prisma.userSuspension.findFirst({
        where: { userId: session.userId, revokedAt: null },
        orderBy: { suspendedAt: 'desc' },
        select: { reason: true, suspendedAt: true, expiresAt: true },
      });
      throw new AccountSuspendedException({
        reason: suspension?.reason ?? 'No reason provided',
        suspendedAt: (suspension?.suspendedAt ?? new Date()).toISOString(),
        expiresAt: suspension?.expiresAt ? suspension.expiresAt.toISOString() : null,
        appealUrl: this.config.get<string>('SUSPENSION_APPEAL_URL') ?? null,
      });
    }

    request.user = {
      userId: payload.sub,
      sessionId: payload.sid,
      role: session.user.role,
    };

    return true;
  }
}

