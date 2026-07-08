import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../../common/types/authenticated-request';
import {
  ALLOW_ANY_ROLE_METADATA_KEY,
  REQUIRE_ROLE_METADATA_KEY,
} from '../../common/decorators/require-role.decorator';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Explicit opt-out: handler is reachable by any authenticated user.
    const allowAnyRole = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_ANY_ROLE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowAnyRole) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      REQUIRE_ROLE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Default-deny: a handler under this guard with no @RequireRole and no
    // @AllowAnyRole is treated as forbidden rather than silently public. This
    // prevents a newly-added /admin route from leaking to every authenticated user.
    if (!required || required.length === 0) {
      throw new ForbiddenException('Insufficient role');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Requires one of: ${required.join(', ')} (caller has ${user.role})`,
      );
    }

    return true;
  }
}
