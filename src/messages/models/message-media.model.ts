import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { MediaType } from '../enums/media-type.enum';
import { UploadStatus } from '../enums/upload-status.enum';

@ObjectType('MessageMedia')
export class MessageMediaType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  messageId!: string;

  @Field(() => MediaType)
  mediaType!: MediaType;

  @Field()
  mimeType!: string;

  @Field(() => Int)
  sizeBytes!: number;

  @Field()
  filename!: string;

  @Field({ nullable: true })
  thumbnailBucketKey?: string | null;

  @Field(() => Int, { nullable: true })
  width?: number | null;

  @Field(() => Int, { nullable: true })
  height?: number | null;

  @Field(() => Int, { nullable: true })
  duration?: number | null;

  @Field()
  mediaCiphertextHash!: string;

  @Field({ nullable: true })
  thumbnailCiphertextHash?: string | null;

  @Field(() => UploadStatus)
  uploadStatus!: UploadStatus;

  @Field({ nullable: true })
  uploadedAt?: Date | null;

  @Field({ nullable: true })
  uploadSessionId?: string | null;

  @Field()
  createdAt!: Date;
}
