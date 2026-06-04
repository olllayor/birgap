import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class EditGroupMessageDto {
  @ApiProperty()
  @IsUUID()
  senderDeviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ description: 'Updated opaque group-key-encrypted payload.' })
  @IsDefined()
  ciphertext: unknown;
}
