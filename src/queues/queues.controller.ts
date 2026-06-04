import { Controller, UseGuards } from '@nestjs/common';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';

@Controller('queues')
@UseGuards(InternalApiKeyGuard)
export class QueuesController {}
