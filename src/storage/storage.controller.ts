import { Controller, Post, Get, Delete, Body, Query, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import * as path from 'path';
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

  /**
   * C8 fix: Normalize the bucketKey path and validate its structure against path
   * traversal attacks. Returns the normalized key or throws ForbiddenException.
   *
   * `mode` controls the ownership policy:
   *  - 'read'  : avatars are public (any authenticated user), media is owner-only.
   *  - 'write' : ownership is required for EVERY prefix (incl. avatars), so a user
   *              cannot delete/overwrite another user's avatar.
   */
  private validateBucketKey(
    bucketKey: string,
    user: AuthenticatedUser,
    mode: 'read' | 'write',
  ): string {
    if (!bucketKey) {
      throw new BadRequestException('bucketKey is required');
    }

    // Normalize to remove `/../` and `/./` sequences
    const normalized = path.posix.normalize(bucketKey);

    // Reject any remaining `..` after normalization (defence in depth)
    if (normalized.includes('..')) {
      throw new ForbiddenException('Access denied');
    }

    // Must start with a known prefix
    if (!normalized.startsWith('avatars/') && !normalized.startsWith('media/')) {
      throw new ForbiddenException('Access denied');
    }

    // media/ is always owner-scoped. avatars/ are public to READ but must be
    // owner-scoped for any WRITE/DELETE operation.
    const requiresOwnership = normalized.startsWith('media/') || mode === 'write';
    if (requiresOwnership) {
      const segments = normalized.split('/');
      const keyUserId = segments[1];
      if (keyUserId !== user.userId) {
        throw new ForbiddenException('Access denied');
      }
    }

    return normalized;
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
    const normalizedKey = this.validateBucketKey(bucketKey, user, 'read');

    try {
      const url = await this.r2Service.generateDownloadUrl(normalizedKey);
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
    const normalizedKey = this.validateBucketKey(bucketKey, user, 'write');

    try {
      await this.r2Service.deleteObject(normalizedKey);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete object';
      throw new BadRequestException(message);
    }
  }
}
