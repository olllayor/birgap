import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INTERNAL_API_KEY_HEADER,
  INTERNAL_API_KEY_MESSAGES,
  validateInternalApiKey,
} from './internal-api-key.validator';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const expected = this.config.getOrThrow<string>('INTERNAL_API_KEY');
    const result = validateInternalApiKey(
      request.headers[INTERNAL_API_KEY_HEADER],
      expected,
    );
    if (!result.ok) {
      throw new ForbiddenException(INTERNAL_API_KEY_MESSAGES[result.reason]);
    }
    return true;
  }
}
