import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PendingQueryDto {
  @ApiProperty()
  @IsUUID()
  deviceId: string;
}
