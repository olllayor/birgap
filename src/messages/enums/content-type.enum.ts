import { registerEnumType } from '@nestjs/graphql';

export enum MessageContentType {
  TEXT = 'TEXT',
  LOCATION = 'LOCATION',
  VENUE = 'VENUE',
}

registerEnumType(MessageContentType, {
  name: 'MessageContentType',
  description: 'Type of content in a message',
});
