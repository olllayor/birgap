import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
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
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    EventEmitterModule.forRoot(),
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
    HealthModule,
  ],
})
export class AppModule {}
