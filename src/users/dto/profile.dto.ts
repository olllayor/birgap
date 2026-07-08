import { IsOptional, IsString, Length, IsObject, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

// Telegram-style username rules: 5-32 chars, letters/digits/underscore,
// must start with a letter, must end with a letter or digit.
export const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{3,30}[a-zA-Z0-9]$/;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/^@/, '') : value))
  @Length(5, 32)
  @Matches(USERNAME_REGEX, {
    message:
      'Username must be 5-32 characters of a-z, 0-9 and underscores, start with a letter, and end with a letter or number',
  })
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
