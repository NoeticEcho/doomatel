import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SearchService } from './search.service.js';
import { ZodBody } from '../common/zod.pipe.js';

const searchRequestSchema = z.object({
  query: z.string().min(2),
  filter: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  expandToArticle: z.boolean().default(true),
});

@ApiTags('Поиск')
@Controller('api/search')
@UseGuards(AuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post('legal')
  @ApiOperation({
    summary: 'Поиск по корпусу законодательства',
    description:
      'Гибридный поиск: смысловая близость, совпадение слов и точное совпадение ' +
      'реквизитов. Выдача ограничена правами пользователя.',
  })
  async searchLegal(
    @ZodBody(searchRequestSchema) body: z.infer<typeof searchRequestSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.search.searchLegal(user.id, body);
  }
}
