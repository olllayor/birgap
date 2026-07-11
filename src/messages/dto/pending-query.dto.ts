import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const toLowerCase = ({ value }: { value: string }) => value?.toLowerCase();

export class PendingQueryDto {
  @ApiProperty()
  @IsUUID()
  @Transform(toLowerCase)
  deviceId!: string;

  @ApiProperty({ required: false, description: 'Cursor: fetch envelopes after this sequence number' })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
