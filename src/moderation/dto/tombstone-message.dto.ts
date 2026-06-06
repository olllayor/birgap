import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TombstoneMessageDto {
  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiProperty({ required: false, description: 'If set, the related report is cascade-closed in the same transaction.' })
  @IsOptional()
  @IsString()
  reportId?: string;
}
