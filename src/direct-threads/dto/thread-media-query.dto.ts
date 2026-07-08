import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MediaType } from '../../messages/enums/media-type.enum';

export class ThreadMediaQueryDto {
  @ApiProperty({
    required: false,
    enum: MediaType,
    description: 'Filter by media type. Omit to return all types.',
  })
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @ApiProperty({
    required: false,
    description:
      'Opaque pagination cursor from a previous response (nextCursor). Omit for the first page.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({ required: false, default: 30, description: 'Max items to return (default 30, max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
