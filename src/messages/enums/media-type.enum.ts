import { registerEnumType } from '@nestjs/graphql';

export enum MediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
}

registerEnumType(MediaType, {
  name: 'MediaType',
  description: 'Type of media attached to a message',
});
