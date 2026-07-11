import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

export class UpdateGroupDto {
  @ApiProperty({ description: 'Encrypted group name, avatar, description, and per-device key wraps.' })
  @IsDefined()
  encryptedMetadata: unknown;
}
