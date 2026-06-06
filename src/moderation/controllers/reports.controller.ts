import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateReportDto } from '../dto/create-report.dto';
import { ReportsService } from '../services/reports.service';

class ListMineQueryDto {
  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'File a report against a single message.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
    @Req() req: Request,
  ) {
    const ip = this.extractIp(req);
    return this.reports.create(user.userId, dto, ip);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List reports filed by the current user.' })
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMineQueryDto) {
    return this.reports.listMine(user.userId, query.limit ?? 20);
  }

  private extractIp(req: Request): string | undefined {
    const ip = req.ip;
    if (typeof ip !== 'string' || ip.length === 0) return undefined;
    return ip;
  }
}
