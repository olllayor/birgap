import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InitMediaDto {
  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  mediaType!: MediaType;

  @ApiProperty({ example: 'photo.jpg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  filename!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  mimeType!: string;

  @ApiProperty({ example: 245678 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes!: number;

  @ApiProperty({ description: 'Client-computed hash of the encrypted media blob.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  mediaCiphertextHash!: string;

  @ApiProperty({ required: false, description: 'Client-computed hash of the encrypted thumbnail blob.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  thumbnailCiphertextHash?: string;

  @ApiProperty({ required: false, example: 1920 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  width?: number;

  @ApiProperty({ required: false, example: 1080 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  height?: number;

  @ApiProperty({ required: false, example: 12, description: 'Duration in seconds for audio/video.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration?: number;
}
