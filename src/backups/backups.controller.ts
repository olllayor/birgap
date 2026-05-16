import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { BackupsService } from './backups.service';
import { PutBackupDto } from './dto/put-backup.dto';
import { UploadUrlDto } from './dto/upload-url.dto';

@ApiTags('backups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('backups')
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  @Post('upload-url')
  getUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: UploadUrlDto) {
    return this.backupsService.getUploadUrl(user.userId, dto);
  }

  @Put('current')
  putCurrent(@CurrentUser() user: AuthenticatedUser, @Body() dto: PutBackupDto) {
    return this.backupsService.putCurrent(user.userId, dto);
  }

  @Get('current')
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.backupsService.getCurrent(user.userId);
  }

  @Get('metadata')
  getMetadata(@CurrentUser() user: AuthenticatedUser) {
    return this.backupsService.getMetadata(user.userId);
  }
}
