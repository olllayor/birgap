import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { ContactsService } from './contacts.service';
import { SyncContactsBookDto, UpsertContactsDto } from './dto/contacts.dto';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @ApiOperation({ summary: 'List the contact book (registered users resolved)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.contactsService.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Add or update contacts by phone hash (Telegram-style discovery)' })
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertContactsDto) {
    return this.contactsService.upsertContacts(user.userId, dto.contacts);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Full address-book sync: upsert uploaded hashes, prune the rest' })
  sync(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncContactsBookDto) {
    return this.contactsService.sync(user.userId, dto.phoneHashes);
  }

  @Delete(':contactId')
  @ApiOperation({ summary: 'Remove a contact' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('contactId') contactId: string) {
    return this.contactsService.remove(user.userId, contactId);
  }
}
