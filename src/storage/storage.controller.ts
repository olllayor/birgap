import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
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
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to generate presigned upload URL');
    }
  }
}
