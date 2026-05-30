import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
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

  @ApiProperty({ type: [MessageEnvelopeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MessageEnvelopeDto)
  envelopes!: MessageEnvelopeDto[];
}
