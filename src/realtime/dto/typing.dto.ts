import { IsOptional, IsUUID } from 'class-validator';

export class TypingDto {
  @IsOptional()
  @IsUUID()
  recipientUserId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}

