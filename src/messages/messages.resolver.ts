import { UseGuards } from '@nestjs/common';
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { MessageLoader } from '../common/loaders/message.loader';
import { MessageType } from './models/message.model';

@UseGuards(GqlAuthGuard)
@Resolver(() => MessageType)
export class MessagesResolver {
  constructor(private readonly messageLoader: MessageLoader) {}

  @ResolveField('replyTo', () => MessageType, { nullable: true })
  async replyTo(@Parent() message: MessageType) {
    if (!message.replyToMessageId) return null;
    return this.messageLoader.load(message.replyToMessageId);
  }
}
