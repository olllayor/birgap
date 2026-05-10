import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '+998901112233' })
  @IsString()
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({ example: '000000' })
  @IsString()
  @Length(4, 8)
  code: string;
}
