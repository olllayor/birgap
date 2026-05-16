import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class PendingQueryDto {
  @ApiProperty()
  @IsUUID()
  deviceId: string;

  @ApiProperty({ required: false, description: 'Cursor: fetch envelopes after this sequence number' })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
