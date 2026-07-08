import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

const toLowerCase = ({ value }: { value: string }) => value?.toLowerCase();

export class PinMessageDto {
  @ApiProperty({ description: 'Active device performing the pin/unpin.' })
  @IsUUID()
  @Transform(toLowerCase)
  deviceId!: string;
}
