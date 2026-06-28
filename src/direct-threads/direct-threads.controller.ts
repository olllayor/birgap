import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { DirectThreadsService } from './direct-threads.service';

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
}
