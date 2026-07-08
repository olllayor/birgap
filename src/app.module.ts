import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './auth/auth.module';
import { BackupsModule } from './backups/backups.module';
import { DevicesModule } from './devices/devices.module';
import { envValidationSchema } from './common/config/env.validation';
import { HealthModule } from './health/health.module';
import { MessagesModule } from './messages/messages.module';
import { ModerationModule } from './moderation/moderation.module';
import { PreKeysModule } from './prekeys/prekeys.module';
import { PrismaModule } from './prisma/prisma.module';
import { PushModule } from './push/push.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { GroupsModule } from './groups/groups.module';
import { DirectThreadsModule } from './direct-threads/direct-threads.module';
import { MetricsModule } from './metrics/metrics.module';
import { QueuesModule } from './queues/queues.module';
import { PruneService } from './common/tasks/prune.service';
import { PruneProcessor } from './common/tasks/prune.processor';
import { MediaCleanupService } from './common/tasks/media-cleanup.service';
import { MediaCleanupProcessor } from './common/tasks/media-cleanup.processor';
import { UnreadModule } from './unread/unread.module';
import { ReactionsModule } from './reactions/reactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    // Rate-limit counters live in Redis, not in-process memory. In-memory storage
    // is per-instance and resets on every restart/deploy, which makes the auth
    // (OTP/login) bucket trivially bypassable and useless across >1 node.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 60 },
          { name: 'auth', ttl: 60_000, limit: 5 },
        ],
        storage: new ThrottlerStorageRedisService(config.getOrThrow<string>('REDIS_URL')),
      }),
    }),
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
    BullModule.registerQueue({
      name: 'database-prune',
      defaultJobOptions: {
        removeOnComplete: { count: 10, age: 7 * 24 * 3600 },
        removeOnFail: { count: 50, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      },
    }),
    BullModule.registerQueue({
      name: 'media-cleanup',
      defaultJobOptions: {
        removeOnComplete: { count: 10, age: 7 * 24 * 3600 },
        removeOnFail: { count: 50, age: 7 * 24 * 3600 },
        attempts: 1,
      },
    }),
    PrismaModule,
    RedisModule,
    MetricsModule,
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
    QueuesModule,
    UnreadModule,
    ReactionsModule,
    ModerationModule,
  ],
  providers: [
    PruneService,
    PruneProcessor,
    MediaCleanupService,
    MediaCleanupProcessor,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
