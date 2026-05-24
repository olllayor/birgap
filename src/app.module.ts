import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'node:path';
import depthLimit = require('graphql-depth-limit');
import { AuthModule } from './auth/auth.module';
import { BackupsModule } from './backups/backups.module';
import { DevicesModule } from './devices/devices.module';
import { envValidationSchema } from './common/config/env.validation';
import { HealthModule } from './health/health.module';
import { MessagesModule } from './messages/messages.module';
import { PreKeysModule } from './prekeys/prekeys.module';
import { PrismaModule } from './prisma/prisma.module';
import { PushModule } from './push/push.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { GroupsModule } from './groups/groups.module';
import { DirectThreadsModule } from './direct-threads/direct-threads.module';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';
import { PruneService } from './common/tasks/prune.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 60,
      },
      {
        name: 'auth',
        ttl: 60_000,
        limit: 5,
      },
    ]),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port, 10) || 6379,
            username: url.username || undefined,
            password: url.password || undefined,
            db: url.pathname ? parseInt(url.pathname.substring(1), 10) || 0 : 0,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get('NODE_ENV') === 'production';
        return {
          autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
          sortSchema: true,
          playground: !isProd,
          introspection: !isProd,
          validationRules: [depthLimit(5)],
          context: ({ req }) => ({ req }),
        };
      },
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    DevicesModule,
    PreKeysModule,
    MessagesModule,
    RealtimeModule,
    PushModule,
    BackupsModule,
    StorageModule,
    GroupsModule,
    DirectThreadsModule,
    HealthModule,
  ],
  providers: [
    PruneService,
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },
  ],
})
export class AppModule {}
