import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class PutBackupDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ description: 'R2 bucket key returned from the upload-url endpoint.' })
  @IsString()
  @MinLength(1)
  bucketKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  sha256!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}
