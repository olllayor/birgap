import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ContactEntryDto {
  @ApiProperty({ description: 'Salted phone hash (same scheme as auth/users sync).' })
  @IsString()
  @MaxLength(128)
  phoneHash!: string;

  @ApiProperty({
    required: false,
    description: 'Opaque client-encrypted display label (name). Server never sees plaintext.',
  })
  @IsOptional()
  encryptedLabel?: unknown;
}

export class UpsertContactsDto {
  @ApiProperty({ type: [ContactEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ContactEntryDto)
  contacts!: ContactEntryDto[];
}

export class SyncContactsBookDto {
  @ApiProperty({
    type: [String],
    description: 'Full device address book as phone hashes. Server upserts and prunes to match.',
  })
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  phoneHashes!: string[];
}
