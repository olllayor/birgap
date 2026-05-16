import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UploadUrlDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version: number;
}
