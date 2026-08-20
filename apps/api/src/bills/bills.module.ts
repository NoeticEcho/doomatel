import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';

@Module({ controllers: [BillsController], providers: [BillsService], exports: [BillsService] })
export class BillsModule {}
