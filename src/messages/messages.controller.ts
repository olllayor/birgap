import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { AckMessageDto } from './dto/ack-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
import { MarkAllReadDto } from './dto/mark-all-read.dto';
import { PendingQueryDto } from './dto/pending-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SyncQueryDto } from './dto/sync-query.dto';
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

  @Post('forward')
  forward(@CurrentUser() user: AuthenticatedUser, @Body() dto: ForwardMessageDto) {
    return this.messagesService.forward(user.userId, dto);
  }

  @Get('pending')
  getPending(@CurrentUser() user: AuthenticatedUser, @Query() query: PendingQueryDto) {
    return this.messagesService.getPending(user.userId, query.deviceId, query.after, query.limit);
  }

  @Get('unread-counts')
  getUnreadCounts(@CurrentUser() user: AuthenticatedUser) {
    return this.messagesService.getUnreadCounts(user.userId);
  }

  @Post('mark-all-read')
  markAllRead(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkAllReadDto) {
    return this.messagesService.markAllRead(user.userId, dto);
  }

  @Post(':messageId/ack')
  ack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: AckMessageDto,
  ) {
    return this.messagesService.ack(user.userId, messageId, dto);
  }

  @Delete(':messageId')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: DeleteMessageDto,
  ) {
    return this.messagesService.delete(user.userId, messageId, dto);
  }

  @Patch(':messageId')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.messagesService.edit(user.userId, messageId, dto);
  }

  @Get('sync')
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SyncQueryDto,
  ) {
    return this.messagesService.sync(user.userId, query.deviceId, query.since, query.limit);
  }
}
