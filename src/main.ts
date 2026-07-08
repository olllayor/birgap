import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import {
  INTERNAL_API_KEY_HEADER,
  INTERNAL_API_KEY_MESSAGES,
  validateInternalApiKey,
} from './common/guards/internal-api-key.validator';

// Express' JSON.stringify throws on BigInt. Postgres autoincrement columns
// (e.g. MessageEnvelope.envelopeSequence) surface as BigInt, so serialize them
// as strings globally — matches how pending/sync already emit the field and
// prevents any endpoint from 500-ing on an unconverted BigInt.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);

  const isProd = config.get('NODE_ENV') === 'production';

  const trustProxyHops = config.get<number>('TRUST_PROXY_HOPS', 0);
  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }

  app.use(
    helmet(
      isProd
        ? undefined
        : {
            // GraphQL Playground relies on inline scripts/styles.
            contentSecurityPolicy: false,
          },
    ),
  );
  // Never pair a reflected/`true` origin with credentials:true — that lets any
  // site read credentialed responses. Use an explicit allowlist (comma-separated
  // APP_ORIGIN); in production a missing allowlist fails closed rather than open.
  const appOrigin = config.get<string>('APP_ORIGIN');
  const allowedOrigins = appOrigin
    ? appOrigin.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : isProd ? false : true,
    credentials: true,
  });
  if (isProd && allowedOrigins.length === 0) {
    logger.warn('APP_ORIGIN is unset in production — CORS is closed to all cross-origin requests.');
  }

  // Bull-board mounts its own Express handler at /queues outside of Nest's
  // controller pipeline, so @UseGuards on QueuesController never fires.
  // Reuse the shared validator so policy can't drift between guard and edge.
  const internalApiKey = config.getOrThrow<string>('INTERNAL_API_KEY');
  const internalApiKeyEdge = (req: Request, res: Response, next: NextFunction) => {
    const result = validateInternalApiKey(
      req.headers[INTERNAL_API_KEY_HEADER],
      internalApiKey,
    );
    if (!result.ok) {
      res.status(403).json({
        statusCode: 403,
        message: INTERNAL_API_KEY_MESSAGES[result.reason],
      });
      return;
    }
    next();
  };
  // /queues (bull-board) and /metrics (Prometheus) both mount their own Express
  // handlers outside Nest's controller pipeline, so guard them at the edge with
  // the internal API key rather than leaving operational internals public.
  app.use('/queues', internalApiKeyEdge);
  app.use('/metrics', internalApiKeyEdge);

  // Distribute Socket.IO room emits across instances via Redis pub/sub so live
  // delivery works when running more than one node.
  const redisIoAdapter = new RedisIoAdapter(app, config.getOrThrow<string>('REDIS_URL'));
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger UI exposes the full API surface; do not serve it publicly in prod.
  if (!isProd) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('BirGap Backend API')
        .setDescription('E2EE-ready chat-only messenger backend contracts.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  logger.log(`Server running on port ${port}`);

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      logger.log(`${signal} received, starting graceful shutdown...`);
      await app.close();
      process.exit(0);
    });
  }
}

bootstrap();
