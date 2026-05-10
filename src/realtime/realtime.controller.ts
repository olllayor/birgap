import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateRealtimeTokenDto } from './dto/create-realtime-token.dto';
import { RealtimeService } from './realtime.service';

@ApiTags('realtime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @Post('token')
  createToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRealtimeTokenDto) {
    return this.realtimeService.createSocketTicket(user, dto.deviceId);
  }
}
