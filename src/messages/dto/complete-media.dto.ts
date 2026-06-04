import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CompleteMediaDto {
  @ApiProperty({ example: 245678, description: 'Size of the uploaded blob in bytes, used to verify the PUT succeeded with the expected size.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}
