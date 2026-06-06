import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ResetStrikesDto {
  @ApiProperty({ description: 'Mandatory justification, recorded in the audit log.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
