import { HttpException, HttpStatus } from '@nestjs/common';

export interface AccountSuspendedBody {
  error: 'ACCOUNT_SUSPENDED';
  reason: string;
  suspendedAt: string;
  expiresAt: string | null;
  appealUrl: string | null;
}

export class AccountSuspendedException extends HttpException {
  constructor(body: Omit<AccountSuspendedBody, 'error'>) {
    const payload: AccountSuspendedBody = {
      error: 'ACCOUNT_SUSPENDED',
      reason: body.reason,
      suspendedAt: body.suspendedAt,
      expiresAt: body.expiresAt,
      appealUrl: body.appealUrl,
    };
    super(payload, HttpStatus.FORBIDDEN);
  }
}
