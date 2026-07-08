import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateThreadSettingsDto {
  @ApiProperty({ description: 'Mute (true) or unmute (false) push notifications for this thread' })
  @IsBoolean()
  muted!: boolean;
}
