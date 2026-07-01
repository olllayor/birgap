import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
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
          this.logger.error(
            `${method} ${url} ${res.statusCode} ${Date.now() - start}ms user=${userId} err=${err.message}`,
          );
        },
      }),
    );
  }
}
