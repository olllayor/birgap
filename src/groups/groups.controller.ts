import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { EditGroupMessageDto } from './dto/edit-group-message.dto';

class GroupMessagesQueryDto {
  @ApiProperty({ required: false, description: 'Max messages to return (default 50, max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, description: 'Only messages with threadSequence less than this' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  beforeSequence?: number;

  @ApiProperty({ required: false, description: 'Only messages with threadSequence greater than this' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  afterSequence?: number;
}

@ApiTags('groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'List groups the current user belongs to' })
  listGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.groupsService.findByUser(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a group by ID with resolved member details' })
  async getGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.groupsService.findByIdWithMembers(id, user.userId);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages in a group with pagination' })
  async getGroupMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: GroupMessagesQueryDto,
  ) {
    const messages = await this.groupsService.getMessages(id, user.userId, {
      limit: query.limit,
      beforeSequence: query.beforeSequence,
      afterSequence: query.afterSequence,
    });
    return { messages };
  }

  @Post()
  createGroup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGroupDto) {
    return this.groupsService.createGroup(user.userId, dto);
  }

  @Post(':id/members')
  addMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Body('memberIds') memberIds: string[],
  ) {
    return this.groupsService.addMembers(user.userId, groupId, memberIds);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.groupsService.removeMember(user.userId, groupId, targetUserId);
  }

  @Post(':id/envelopes')
  queueGroupMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Body() dto: SendGroupMessageDto,
  ) {
    return this.groupsService.queueGroupMessage(user.userId, groupId, dto);
  }

  @Patch(':id/messages/:messageId')
  editGroupMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditGroupMessageDto,
  ) {
    return this.groupsService.editGroupMessage(user.userId, groupId, messageId, dto);
  }
}
