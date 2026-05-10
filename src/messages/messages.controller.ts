import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { AckMessageDto } from './dto/ack-message.dto';
import { PendingQueryDto } from './dto/pending-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendMessageDto) {
    return this.messagesService.send(user.userId, dto);
  }

  @Get('pending')
  getPending(@CurrentUser() user: AuthenticatedUser, @Query() query: PendingQueryDto) {
    return this.messagesService.getPending(user.userId, query.deviceId);
  }

  @Post(':messageId/ack')
  ack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: AckMessageDto,
  ) {
    return this.messagesService.ack(user.userId, messageId, dto);
  }
}
