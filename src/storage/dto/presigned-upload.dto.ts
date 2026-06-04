import { IsString, IsNumber, IsIn, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PresignedUploadDto {
  @ApiProperty({ example: 'photo.jpg', description: 'The original name of the file' })
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @ApiProperty({ example: 'image/jpeg', description: 'The MIME type of the file' })
  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @ApiProperty({ example: 10245, description: 'Size of the file in bytes' })
  @IsNumber()
  @Min(1)
  sizeBytes!: number;

  @ApiProperty({ example: 'avatar', enum: ['avatar', 'media'], description: 'The purpose of the upload' })
  @IsString()
  @IsIn(['avatar', 'media'])
  purpose!: 'avatar' | 'media';
}
