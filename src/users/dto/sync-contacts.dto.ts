import { IsArray, IsOptional, IsString } from 'class-validator';

export class SyncContactsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phoneHashes?: string[];

  /**
   * Raw phone numbers (any formatting). The server normalizes to E.164 and
   * applies the peppered HMAC itself — clients cannot compute `phoneHash`
   * because PHONE_HASH_PEPPER is a server-only secret.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phones?: string[];
}
