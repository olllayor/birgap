import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CallHistoryQueryDto {
  @ApiProperty({ required: false, enum: ['missed', 'all'], description: "Filter: 'missed' returns only missed incoming calls." })
  @IsOptional()
  @IsIn(['missed', 'all'])
  filter?: 'missed' | 'all';

  @ApiProperty({ required: false, description: 'Keyset cursor from the previous page (nextCursor).' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({ required: false, description: 'Max calls to return (default 30, max 100).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
