import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber, IsString } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ example: '+998901112233' })
  @IsString()
  @IsPhoneNumber()
  phone!: string;
}
