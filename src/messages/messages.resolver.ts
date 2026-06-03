import { UseGuards } from '@nestjs/common';
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { MessageLoader } from '../common/loaders/message.loader';
import { PrismaService } from '../prisma/prisma.service';
import { MessageType } from './models/message.model';
import { MessageMediaType } from './models/message-media.model';

@UseGuards(GqlAuthGuard)
@Resolver(() => MessageType)
export class MessagesResolver {
  constructor(
    private readonly messageLoader: MessageLoader,
    private readonly prisma: PrismaService,
  ) {}

  @ResolveField('replyTo', () => MessageType, { nullable: true })
  async replyTo(@Parent() message: MessageType) {
    if (!message.replyToMessageId) return null;
    return this.messageLoader.load(message.replyToMessageId);
  }

  @ResolveField('media', () => [MessageMediaType!]!)
  async media(@Parent() message: MessageType) {
    if (!message.id) return [];
    return this.prisma.messageMedia.findMany({
      where: { messageId: message.id },
      orderBy: { createdAt: 'asc' },
    });
  }
}
