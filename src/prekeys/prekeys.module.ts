import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreKeysController } from './prekeys.controller';
import { PreKeysService } from './prekeys.service';

@Module({
  imports: [AuthModule],
  controllers: [PreKeysController],
  providers: [PreKeysService],
})
export class PreKeysModule {}
