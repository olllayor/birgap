import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-internal-api-key'];

    if (!header || typeof header !== 'string') {
      throw new ForbiddenException('Missing internal API key');
    }

    const expected = this.config.getOrThrow<string>('INTERNAL_API_KEY');
    const headerBuf = Buffer.from(header);
    const expectedBuf = Buffer.from(expected);

    if (
      headerBuf.length !== expectedBuf.length ||
      !timingSafeEqual(headerBuf, expectedBuf)
    ) {
      throw new ForbiddenException('Invalid internal API key');
    }

    return true;
  }
}
