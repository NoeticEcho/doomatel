import { Module } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, AuditService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
