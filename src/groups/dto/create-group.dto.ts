import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDefined, IsUUID } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ description: 'Encrypted group name, avatar, and description.' })
  @IsDefined()
  encryptedMetadata: unknown;

  @ApiProperty({ description: 'Initial group member user IDs.' })
  @IsArray()
  @IsUUID('all', { each: true })
  members!: string[];
}
