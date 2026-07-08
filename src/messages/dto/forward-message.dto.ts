import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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

const toLowerCase = ({ value }: { value: string }) => value?.toLowerCase();

export class ForwardTargetDto {
  @ApiProperty({ enum: ['direct', 'group'] })
  @IsString()
  @IsIn(['direct', 'group'])
  type!: 'direct' | 'group';

  @ApiProperty({ required: false, description: 'Required when type is "direct".' })
  @IsOptional()
  @IsUUID()
  @Transform(toLowerCase)
  recipientUserId?: string;

  @ApiProperty({ required: false, description: 'Required when type is "group".' })
  @IsOptional()
  @IsUUID()
  @Transform(toLowerCase)
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
  @Transform(toLowerCase)
  sourceMessageId!: string;

  @ApiProperty()
  @IsUUID()
  @Transform(toLowerCase)
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
