import { IsUUID } from 'class-validator';

export class TypingDto {
  @IsUUID()
  recipientUserId: string;
}
