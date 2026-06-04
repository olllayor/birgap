import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendGroupMessageDto {
  @ApiProperty()
  @IsUUID()
  senderDeviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ required: false, description: 'ID of the message being replied to (must be in the same group).' })
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;

  @ApiProperty({
    type: [String],
    required: false,
    description: 'Pre-uploaded mediaIds to attach to this message. Each must be owned by the sender, COMPLETE, and not yet bound to a message.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  mediaIds?: string[];

  @ApiProperty({ description: 'Opaque group-key-encrypted payload.' })
  @IsDefined()
  ciphertext: unknown;
}
