import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MessageContentType } from '../enums/content-type.enum';

const toLowerCase = ({ value }: { value: string }) => value?.toLowerCase();

export class MessageEnvelopeDto {
  @ApiProperty()
  @IsUUID()
  @Transform(toLowerCase)
  recipientDeviceId!: string;

  @ApiProperty({ description: 'Opaque client-encrypted payload.' })
  @IsDefined()
  ciphertext!: unknown;
}

export class SendMessageDto {
  @ApiProperty()
  @IsUUID()
  @Transform(toLowerCase)
  senderDeviceId!: string;

  @ApiProperty()
  @IsUUID()
  @Transform(toLowerCase)
  recipientUserId!: string;

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

  @ApiProperty({ required: false, description: 'ID of the message being replied to (must be in the same thread).' })
  @IsOptional()
  @IsUUID()
  @Transform(toLowerCase)
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
  @Transform(({ value }: { value: string[] }) => value?.map((v: string) => v.toLowerCase()))
  mediaIds?: string[];

  @ApiProperty({ type: [MessageEnvelopeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MessageEnvelopeDto)
  envelopes!: MessageEnvelopeDto[];
}
