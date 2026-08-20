import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodBody } from '../common/zod.pipe.js';
import { BillsService } from './bills.service.js';

const searchSchema = z.object({
  query: z.string().optional(),
  number: z.string().optional(),
  convocation: z.number().int().optional(),
  statusCodes: z.array(z.number().int()).optional(),
  committeeId: z.number().int().optional(),
  introducedFrom: z.string().optional(),
  introducedTo: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(20),
});

@ApiTags('Законопроекты')
@Controller('api/bills')
@UseGuards(AuthGuard)
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Post('search')
  @ApiOperation({ summary: 'Поиск законопроектов' })
  search(@ZodBody(searchSchema) body: z.infer<typeof searchSchema>) {
    return this.bills.search(body);
  }

  @Get(':number')
  @ApiOperation({ summary: 'Карточка законопроекта с хронологией' })
  get(@Param('number') number: string, @Query('documents') documents?: string) {
    return this.bills.get(number, documents !== 'false');
  }

  @Get('documents/:sha256')
  @ApiOperation({ summary: 'Извлечённый текст документа законопроекта' })
  documentText(@Param('sha256') sha256: string) {
    return this.bills.documentText(sha256);
  }
}
