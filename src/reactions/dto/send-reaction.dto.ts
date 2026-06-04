import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export const ALLOWED_EMOJIS = [
  '👍', '👎', '❤️', '🔥', '😂', '😮', '😢', '🎉', '🙏', '💯',
  '👏', '🤔', '😍', '🥳', '😎', '💪', '✨', '🚀', '👀', '💀',
] as const;

export type AllowedEmoji = (typeof ALLOWED_EMOJIS)[number];

export class SendReactionDto {
  @ApiProperty({ enum: ALLOWED_EMOJIS })
  @IsString()
  @IsIn(ALLOWED_EMOJIS)
  emoji!: AllowedEmoji;
}
