import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { RefillPrekeysDto } from './dto/refill-prekeys.dto';
import { RotateSignedPrekeyDto } from './dto/rotate-signed-prekey.dto';
import { PreKeysService } from './prekeys.service';

@ApiTags('prekeys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices/:deviceId')
export class PreKeysController {
  constructor(private readonly preKeysService: PreKeysService) {}

  @Post('prekeys/refill')
  refill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: RefillPrekeysDto,
  ) {
    return this.preKeysService.refill(user.userId, deviceId, dto);
  }

  @Put('signed-prekey')
  rotateSignedPrekey(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: RotateSignedPrekeyDto,
  ) {
    return this.preKeysService.rotateSignedPrekey(user.userId, deviceId, dto);
  }
}
