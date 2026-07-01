import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';

export enum DeleteMessageScope {
  FOR_ME = 'FOR_ME',
  FOR_EVERYONE = 'FOR_EVERYONE',
}

export class DeleteMessageDto {
  @ApiProperty({ description: 'Device ID performing the delete' })
  @IsUUID()
  deviceId!: string;

  @ApiProperty({ enum: DeleteMessageScope, default: DeleteMessageScope.FOR_ME })
  @IsEnum(DeleteMessageScope)
  scope: DeleteMessageScope = DeleteMessageScope.FOR_ME;
}
