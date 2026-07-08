import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsUUID } from 'class-validator';
import { THREAD_TYPES, ThreadType } from './mark-all-read.dto';

const toLowerCase = ({ value }: { value: string }) => value?.toLowerCase();

export class PinnedQueryDto {
  @ApiProperty({ enum: THREAD_TYPES })
  @IsIn(THREAD_TYPES)
  threadType!: ThreadType;

  @ApiProperty()
  @IsUUID()
  @Transform(toLowerCase)
  threadId!: string;

  @ApiProperty({ description: 'Active device making the request.' })
  @IsUUID()
  @Transform(toLowerCase)
  deviceId!: string;
}
