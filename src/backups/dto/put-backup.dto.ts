import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class PutBackupDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version: number;

  @ApiProperty({ description: 'Opaque encrypted backup blob, usually base64 or base64url.' })
  @IsString()
  @MinLength(1)
  blob: string;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  checksum: string;
}
