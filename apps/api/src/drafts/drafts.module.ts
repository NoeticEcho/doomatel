import { Module } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { DraftsController } from './drafts.controller.js';
import { DraftsService } from './drafts.service.js';

@Module({ controllers: [DraftsController], providers: [DraftsService, AuditService] })
export class DraftsModule {}
