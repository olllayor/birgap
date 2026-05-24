import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from '../types/authenticated-request';

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
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
      select: { id: true, userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true } } },
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
      throw new ForbiddenException('Account is suspended');
    }

    request.user = {
      userId: payload.sub,
      sessionId: payload.sid,
    };

    return true;
  }
}
