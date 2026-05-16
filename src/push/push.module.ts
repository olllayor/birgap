import { Global, Module } from '@nestjs/common';
import { FcmProvider } from './fcm.provider';
import { PushService } from './push.service';

@Global()
@Module({
  providers: [FcmProvider, PushService],
  exports: [PushService],
})
export class PushModule {}
