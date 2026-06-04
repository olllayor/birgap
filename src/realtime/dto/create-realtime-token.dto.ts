import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateRealtimeTokenDto {
  @ApiProperty()
  @IsUUID()
  deviceId!: string;
}
