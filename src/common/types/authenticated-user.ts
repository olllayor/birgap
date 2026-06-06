import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  role: UserRole;
}
