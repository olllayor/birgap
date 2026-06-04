import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export const THREAD_TYPES = ['direct', 'group'] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

export class MarkAllReadDto {
  @ApiProperty()
  @IsUUID()
  threadId!: string;

  @ApiProperty({ enum: THREAD_TYPES })
  @IsIn(THREAD_TYPES)
  threadType!: ThreadType;

  @ApiProperty()
  @IsUUID()
  deviceId!: string;
}
