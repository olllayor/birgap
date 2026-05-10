import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class OneTimePrekeyDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  keyId: number;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  publicKey: string;
}

export class RefillPrekeysDto {
  @ApiProperty({ type: [OneTimePrekeyDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OneTimePrekeyDto)
  prekeys: OneTimePrekeyDto[];
}
