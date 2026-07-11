import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
    return this.usersService.syncContacts(dto.phoneHashes ?? [], dto.phones ?? []);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.userId);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('search')
  searchByUsername(
    @Query('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.searchByUsername(username, user.userId);
  }
}

