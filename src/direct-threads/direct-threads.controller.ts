import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { DirectThreadsService } from './direct-threads.service';
import { ThreadMediaQueryDto } from './dto/thread-media-query.dto';
import { UpdateThreadSettingsDto } from './dto/update-thread-settings.dto';

class ThreadMessagesQueryDto {
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

@ApiTags('threads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('threads')
export class DirectThreadsController {
  constructor(private readonly directThreadsService: DirectThreadsService) {}

  @Get()
  async getUserThreads(@CurrentUser() user: AuthenticatedUser) {
    const threads = await this.directThreadsService.findByUserWithDetails(user.userId);
    return { threads };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a direct thread by ID with resolved user details' })
  async getThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.directThreadsService.findByIdWithDetails(id, user.userId);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages in a direct thread with pagination' })
  async getThreadMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ThreadMessagesQueryDto,
  ) {
    const messages = await this.directThreadsService.getMessages(id, user.userId, {
      limit: query.limit,
      beforeSequence: query.beforeSequence,
      afterSequence: query.afterSequence,
    });
    return { messages };
  }

  @Patch(':id/settings')
  @ApiOperation({ summary: 'Update per-user settings for a direct thread (mute/unmute push)' })
  async updateThreadSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateThreadSettingsDto,
  ) {
    return this.directThreadsService.updateThreadSettings(user.userId, id, {
      muted: body.muted,
    });
  }

  @Get(':id/media')
  @ApiOperation({ summary: 'Get media gallery for a direct thread with cursor pagination' })
  async getThreadMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ThreadMediaQueryDto,
  ) {
    return this.directThreadsService.getThreadMedia(user.userId, id, {
      type: query.type,
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
