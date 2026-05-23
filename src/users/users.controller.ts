import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { UsersService } from './users.service';
import { SyncContactsDto } from './dto/sync-contacts.dto';
import { UpdateProfileDto } from './dto/profile.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userId/devices/key-bundles')
  getDeviceKeyBundles(@Param('userId') userId: string) {
    return this.usersService.getDeviceKeyBundles(userId);
  }

  @Post('sync')
  syncContacts(@Body() dto: SyncContactsDto) {
    return this.usersService.syncContacts(dto.phoneHashes);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @Get('search')
  searchByUsername(@Query('username') username: string) {
    return this.usersService.searchByUsername(username);
  }
}

