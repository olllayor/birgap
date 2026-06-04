import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CompleteMediaDto } from './dto/complete-media.dto';
import { InitMediaDto } from './dto/init-media.dto';
import { MediaService } from './media.service';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('init')
  @ApiOperation({
    summary: 'Initialize a media upload',
    description: 'Creates a pending MessageMedia row owned by the current user and returns a presigned PUT URL for the encrypted blob.',
  })
  @ApiResponse({ status: 201, description: 'Media initialized, presigned upload URL returned.' })
  @ApiResponse({ status: 400, description: 'Invalid mime/size or mime does not match the declared mediaType.' })
  init(@CurrentUser() user: AuthenticatedUser, @Body() dto: InitMediaDto) {
    return this.mediaService.initUpload(user.userId, dto);
  }

  @Post(':mediaId/complete')
  @ApiOperation({
    summary: 'Finalize a media upload',
    description: 'Verifies the PUT succeeded with the expected size and flips the row to COMPLETE.',
  })
  @ApiResponse({ status: 200, description: 'Media marked as complete.' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner of the media.' })
  @ApiResponse({ status: 404, description: 'Media not found.' })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mediaId') mediaId: string,
    @Body() dto: CompleteMediaDto,
  ) {
    return this.mediaService.completeUpload(user.userId, mediaId, dto);
  }

  @Get(':mediaId/download-url')
  @ApiOperation({
    summary: 'Get a presigned download URL for a media attachment',
    description: 'Caller must be a thread participant or group member of the parent message.',
  })
  @ApiResponse({ status: 200, description: 'Presigned download URL returned.' })
  @ApiResponse({ status: 403, description: 'Caller cannot access the parent message.' })
  @ApiResponse({ status: 404, description: 'Media not found.' })
  downloadUrl(@CurrentUser() user: AuthenticatedUser, @Param('mediaId') mediaId: string) {
    return this.mediaService.getDownloadUrl(user.userId, mediaId);
  }
}
