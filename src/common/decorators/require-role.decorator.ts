import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const REQUIRE_ROLE_METADATA_KEY = 'moderation:require-role';

export const RequireRole = (...roles: UserRole[]) => SetMetadata(REQUIRE_ROLE_METADATA_KEY, roles);

/**
 * Explicit opt-out for AdminRoleGuard's default-deny policy: marks a handler as
 * reachable by any authenticated user regardless of role. Required because the
 * guard now denies handlers that carry no @RequireRole metadata.
 */
export const ALLOW_ANY_ROLE_METADATA_KEY = 'moderation:allow-any-role';

export const AllowAnyRole = () => SetMetadata(ALLOW_ANY_ROLE_METADATA_KEY, true);
