import { Module } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({ controllers: [AgentsController], providers: [AgentsService, AuditService] })
export class AgentsModule {}
