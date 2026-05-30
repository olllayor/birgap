import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export const ACK_STATUSES = ['DELIVERED', 'READ'] as const;
export type AckStatus = (typeof ACK_STATUSES)[number];

export class AckMessageDto {
  @ApiProperty()
  @IsUUID()
  deviceId!: string;

  @ApiProperty({ enum: ACK_STATUSES })
  @IsIn(ACK_STATUSES)
  status!: AckStatus;
}
