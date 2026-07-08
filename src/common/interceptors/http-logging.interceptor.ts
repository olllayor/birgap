import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const { method, url } = req;
    const userId = req.user?.userId ?? 'anonymous';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(`${method} ${url} ${res.statusCode} ${Date.now() - start}ms user=${userId}`);
        },
        error: (err) => {
          // The exception filter has not run yet, so res.statusCode still holds
          // the framework default (200/201). Derive the real status from the
          // exception instead of logging a misleading success code.
          const status = err instanceof HttpException ? err.getStatus() : 500;
          this.logger.error(
            `${method} ${url} ${status} ${Date.now() - start}ms user=${userId} err=${err.message}`,
          );
        },
      }),
    );
  }
}
