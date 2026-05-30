import { IsArray, IsString } from 'class-validator';

export class SyncContactsDto {
  @IsArray()
  @IsString({ each: true })
  phoneHashes!: string[];
}
