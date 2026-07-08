import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MessageContentType } from '../../messages/enums/content-type.enum';

class GroupMessageEnvelopeDto {
  @ApiProperty()
  @IsUUID()
  recipientDeviceId!: string;

  @ApiProperty({ description: 'Opaque client-encrypted payload for this device.' })
  @IsDefined()
  ciphertext!: unknown;
}

export class SendGroupMessageDto {
  @ApiProperty()
  @IsUUID()
  senderDeviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({
    required: false,
    enum: MessageContentType,
    description: 'Content type of the message. Defaults to TEXT.',
  })
  @IsOptional()
  @IsEnum(MessageContentType)
  contentType?: MessageContentType;

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

  // C6 fix: accept per-device envelopes for E2EE, replacing the single ciphertext.
  @ApiProperty({
    type: [GroupMessageEnvelopeDto],
    description: 'Per-device encrypted envelopes. Required for E2EE group messages.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GroupMessageEnvelopeDto)
  envelopes!: GroupMessageEnvelopeDto[];
}
