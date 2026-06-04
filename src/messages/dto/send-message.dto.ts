import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MessageEnvelopeDto {
  @ApiProperty()
  @IsUUID()
  recipientDeviceId!: string;

  @ApiProperty({ description: 'Opaque client-encrypted payload.' })
  @IsDefined()
  ciphertext!: unknown;
}

export class SendMessageDto {
  @ApiProperty()
  @IsUUID()
  senderDeviceId!: string;

  @ApiProperty()
  @IsUUID()
  recipientUserId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ required: false, description: 'ID of the message being replied to (must be in the same thread).' })
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

  @ApiProperty({ type: [MessageEnvelopeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MessageEnvelopeDto)
  envelopes!: MessageEnvelopeDto[];
}
