import { IsOptional, IsString, Length, IsObject } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(3, 30)
  username?: string;

  @IsOptional()
  @IsString()
  profileAvatarUrl?: string;

  @IsOptional()
  @IsObject()
  encryptedProfile?: unknown;

  @IsOptional()
  @IsString()
  profileKeyHash?: string;
}
