import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MessageEnvelopeDto } from './send-message.dto';

export class ForwardTargetDto {
  @ApiProperty({ enum: ['direct', 'group'] })
  @IsString()
  @IsIn(['direct', 'group'])
  type!: 'direct' | 'group';

  @ApiProperty({ required: false, description: 'Required when type is "direct".' })
  @IsOptional()
  @IsUUID()
  recipientUserId?: string;

  @ApiProperty({ required: false, description: 'Required when type is "group".' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiProperty({ type: [MessageEnvelopeDto], required: false, description: 'Required when type is "direct".' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MessageEnvelopeDto)
  envelopes?: MessageEnvelopeDto[];

  @ApiProperty({ required: false, description: 'Opaque group-key-encrypted payload. Required when type is "group".' })
  @IsOptional()
  @IsDefined()
  ciphertext?: unknown;
}

export class ForwardMessageDto {
  @ApiProperty({ description: 'ID of the source message to forward.' })
  @IsUUID()
  sourceMessageId!: string;

  @ApiProperty()
  @IsUUID()
  senderDeviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ type: [ForwardTargetDto], description: 'Targets to forward the message to (max 20).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ForwardTargetDto)
  targets!: ForwardTargetDto[];
}
