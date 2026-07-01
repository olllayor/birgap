import { Controller, Post, Get, Delete, Body, Query, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { R2Service } from './r2.service';
import { PresignedUploadDto } from './dto/presigned-upload.dto';

@ApiTags('storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storage')
export class StorageController {
  constructor(private readonly r2Service: R2Service) {}

  @Post('presigned-upload')
  @ApiOperation({ summary: 'Generate a presigned PUT upload URL for an avatar or media file' })
  @ApiResponse({ status: 201, description: 'Presigned URL generated successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid parameters or file size/type constraints violated.' })
  async getPresignedUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PresignedUploadDto,
  ) {
    try {
      const result = await this.r2Service.generatePresignedUploadUrl(
        user.userId,
        dto.filename,
        dto.mimeType,
        dto.sizeBytes,
        dto.purpose,
      );
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to generate presigned upload URL';
      throw new BadRequestException(message);
    }
  }

  @Get('download-url')
  @ApiOperation({ summary: 'Generate a presigned GET download URL for an object' })
  @ApiResponse({ status: 200, description: 'Presigned download URL generated.' })
  @ApiResponse({ status: 400, description: 'Missing or invalid bucketKey.' })
  @ApiResponse({ status: 403, description: 'Access denied.' })
  async getDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Query('bucketKey') bucketKey: string,
  ) {
    if (!bucketKey) {
      throw new BadRequestException('bucketKey is required');
    }

    if (!bucketKey.startsWith('avatars/') && !bucketKey.startsWith('media/')) {
      throw new ForbiddenException('Access denied');
    }

    if (bucketKey.startsWith('media/')) {
      const keyUserId = bucketKey.split('/')[1];
      if (keyUserId !== user.userId) {
        throw new ForbiddenException('Access denied');
      }
    }

    try {
      const url = await this.r2Service.generateDownloadUrl(bucketKey);
      return { url };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to generate download URL';
      throw new BadRequestException(message);
    }
  }

  @Delete('object')
  @ApiOperation({ summary: 'Delete an object from storage by bucket key' })
  @ApiResponse({ status: 200, description: 'Object deleted successfully.' })
  @ApiResponse({ status: 400, description: 'Missing or invalid bucketKey.' })
  @ApiResponse({ status: 403, description: 'Access denied.' })
  async deleteObject(
    @CurrentUser() user: AuthenticatedUser,
    @Query('bucketKey') bucketKey: string,
  ) {
    if (!bucketKey) {
      throw new BadRequestException('bucketKey is required');
    }

    if (!bucketKey.startsWith('avatars/') && !bucketKey.startsWith('media/')) {
      throw new ForbiddenException('Access denied');
    }

    const keyUserId = bucketKey.split('/')[1];
    if (keyUserId !== user.userId) {
      throw new ForbiddenException('Access denied');
    }

    try {
      await this.r2Service.deleteObject(bucketKey);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete object';
      throw new BadRequestException(message);
    }
  }
}
