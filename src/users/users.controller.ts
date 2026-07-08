import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
  syncContacts(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncContactsDto) {
    return this.usersService.syncContacts(dto.phoneHashes, user.userId);
  }

  @Get(':userId/presence')
  getPresence(@Param('userId') userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getPresence(userId, user.userId);
  }

  // Two-segment param route: cannot shadow the single-segment static routes
  // (/users/me, /users/search, /users/username-available, /users/blocked) below.
  @Get(':userId/profile')
  getPeerProfile(@Param('userId') userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getPeerProfile(userId, user.userId);
  }

  // Static single-segment route: declared before any single-segment param route
  // could ever be added, alongside /users/me and /users/search.
  @Get('blocked')
  listBlockedUsers(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listBlockedUsers(user.userId);
  }

  @Post(':userId/block')
  blockUser(@Param('userId') userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.blockUser(user.userId, userId);
  }

  @Delete(':userId/block')
  unblockUser(@Param('userId') userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.unblockUser(user.userId, userId);
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
  @Get('username-available')
  checkUsernameAvailable(
    @Query('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.checkUsernameAvailable(username, user.userId);
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

