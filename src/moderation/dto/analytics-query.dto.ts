import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { DailyMetricKind } from '@prisma/client';

export class AnalyticsQueryDto {
  @ApiProperty({ enum: DailyMetricKind })
  @IsEnum(DailyMetricKind)
  kind!: DailyMetricKind;

  @ApiProperty({ required: false, description: 'ISO 8601 start of date range (inclusive). Defaults to 30 days ago.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false, description: 'ISO 8601 end of date range (inclusive). Defaults to today.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiProperty({ required: false, description: 'Optional dimension filter, e.g. "DIRECT" or "GROUP" for MESSAGES_SENT_*.', maxLength: 64 })
  @IsOptional()
  dimension?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 366, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;
}
