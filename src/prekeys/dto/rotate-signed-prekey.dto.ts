import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class RotateSignedPrekeyDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  keyId: number;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  publicKey: string;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  signature: string;
}
