import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SuspendUserDto {
  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiProperty({ required: false, description: 'ISO 8601 expiry. Omit for permanent suspension.' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiProperty({ required: false, description: 'If set, the related report is cascade-closed in the same transaction.' })
  @IsOptional()
  @IsUUID()
  reportId?: string;
}
