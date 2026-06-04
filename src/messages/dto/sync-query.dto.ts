import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class SyncQueryDto {
  @ApiProperty({ description: 'Device UUID to sync envelopes for' })
  @IsUUID()
  deviceId!: string;

  @ApiProperty({ description: 'ISO 8601 timestamp. Only envelopes updated after this time are returned.' })
  @IsDateString()
  since!: string;

  @ApiProperty({ required: false, description: 'Maximum envelopes to return (default 200, max 500)' })
  @IsOptional()
  limit?: number;
}
