import { Module } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({ controllers: [TasksController], providers: [TasksService, AuditService] })
export class TasksModule {}
