import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CallsService } from './calls.service';
import { CallHistoryQueryDto } from './dto/call-history-query.dto';

@ApiTags('calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @ApiOperation({ summary: 'Call history (terminal calls only) with keyset pagination' })
  history(@CurrentUser() user: AuthenticatedUser, @Query() query: CallHistoryQueryDto) {
    return this.callsService.history(user.userId, {
      filter: query.filter,
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
