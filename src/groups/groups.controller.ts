import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { EditGroupMessageDto } from './dto/edit-group-message.dto';

@ApiTags('groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

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
