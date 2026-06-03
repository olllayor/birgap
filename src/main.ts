import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);

  const isProd = config.get('NODE_ENV') === 'production';

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
  app.enableCors({
    origin: config.get<string>('APP_ORIGIN') ?? true,
    credentials: true,
  });

  // Bull-board mounts its own Express handler at /queues outside of Nest's
  // controller pipeline, so @UseGuards on QueuesController never fires.
  // Protect the route here with the same internal API key contract.
  const internalApiKey = config.getOrThrow<string>('INTERNAL_API_KEY');
  const expectedKeyBuf = Buffer.from(internalApiKey);
  app.use('/queues', (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers['x-internal-api-key'];
    if (typeof header !== 'string' || header.length === 0) {
      res.status(403).json({ statusCode: 403, message: 'Missing internal API key' });
      return;
    }
    const headerBuf = Buffer.from(header);
    if (
      headerBuf.length !== expectedKeyBuf.length ||
      !timingSafeEqual(headerBuf, expectedKeyBuf)
    ) {
      res.status(403).json({ statusCode: 403, message: 'Invalid internal API key' });
      return;
    }
    next();
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

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

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  logger.log(`Server running on port ${port}`);

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      logger.log(`${signal} received, starting graceful shutdown...`);
    });
  }
}

bootstrap();
