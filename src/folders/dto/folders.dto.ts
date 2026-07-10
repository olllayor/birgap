import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';

export class CreateFolderDto {
  @ApiProperty({ description: 'Folder display name (unique per user).' })
  @IsString()
  @Length(1, 64)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  emoji?: string;

  @ApiProperty({ required: false, description: 'Sort position (ascending).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateFolderDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  emoji?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class FolderThreadDto {
  @ApiProperty({ enum: ['direct', 'group'] })
  @IsIn(['direct', 'group'])
  threadType!: 'direct' | 'group';

  @ApiProperty()
  @IsUUID()
  threadId!: string;
}
