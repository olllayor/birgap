import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { AdminAuditAction, AdminAuditTargetType } from '@prisma/client';

export class ListAuditLogQueryDto {
  @ApiProperty({ required: false, enum: AdminAuditAction })
  @IsOptional()
  @IsEnum(AdminAuditAction)
  action?: AdminAuditAction;

  @ApiProperty({ required: false, enum: AdminAuditTargetType })
  @IsOptional()
  @IsEnum(AdminAuditTargetType)
  targetType?: AdminAuditTargetType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiProperty({ required: false, description: 'ISO 8601 start of date range (inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false, description: 'ISO 8601 end of date range (inclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiProperty({
    required: false,
    description:
      'Case-insensitive substring match against the `reason` field. Minimum 3 characters when provided.',
  })
  @IsOptional()
  @IsString()
  searchText?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
