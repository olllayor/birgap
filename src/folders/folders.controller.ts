import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateFolderDto, FolderThreadDto, UpdateFolderDto } from './dto/folders.dto';
import { FoldersService } from './folders.service';

@ApiTags('folders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('folders')
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get()
  @ApiOperation({ summary: 'List chat folders with their thread mappings' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.foldersService.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a chat folder' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFolderDto) {
    return this.foldersService.create(user.userId, dto);
  }

  @Patch(':folderId')
  @ApiOperation({ summary: 'Rename / reorder a folder' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('folderId') folderId: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.foldersService.update(user.userId, folderId, dto);
  }

  @Delete(':folderId')
  @ApiOperation({ summary: 'Delete a folder (threads themselves are untouched)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('folderId') folderId: string) {
    return this.foldersService.remove(user.userId, folderId);
  }

  @Post(':folderId/threads')
  @ApiOperation({ summary: 'Add a direct thread or group to a folder' })
  addThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('folderId') folderId: string,
    @Body() dto: FolderThreadDto,
  ) {
    return this.foldersService.addThread(user.userId, folderId, dto);
  }

  @Delete(':folderId/threads/:threadType/:threadId')
  @ApiOperation({ summary: 'Remove a thread from a folder' })
  removeThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('folderId') folderId: string,
    @Param('threadType') threadType: string,
    @Param('threadId') threadId: string,
  ) {
    return this.foldersService.removeThread(user.userId, folderId, threadType, threadId);
  }
}
