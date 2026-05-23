import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
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
    HealthModule,
  ],
  providers: [
    PruneService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

