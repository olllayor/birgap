import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { SendReactionDto } from './dto/send-reaction.dto';
import { ReactionsService } from './reactions.service';

@ApiTags('reactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  @Post(':messageId/reactions')
  toggle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: SendReactionDto,
  ) {
    return this.reactionsService.toggle(user.userId, messageId, dto.emoji);
  }

  @Delete(':messageId/reactions')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
  ) {
    return this.reactionsService.remove(user.userId, messageId);
  }

  @Get(':messageId/reactions')
  getAggregated(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
  ) {
    return this.reactionsService.getAggregated(user.userId, messageId);
  }
}
