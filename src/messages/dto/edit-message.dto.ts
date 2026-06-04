import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsDefined, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class EditMessageEnvelopeDto {
  @ApiProperty()
  @IsUUID()
  recipientDeviceId!: string;

  @ApiProperty({ description: 'Updated opaque client-encrypted payload.' })
  @IsDefined()
  ciphertext!: unknown;
}

export class EditMessageDto {
  @ApiProperty()
  @IsUUID()
  senderDeviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ type: [EditMessageEnvelopeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EditMessageEnvelopeDto)
  envelopes!: EditMessageEnvelopeDto[];
}
