import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const REQUIRE_ROLE_METADATA_KEY = 'moderation:require-role';

export const RequireRole = (...roles: UserRole[]) => SetMetadata(REQUIRE_ROLE_METADATA_KEY, roles);
