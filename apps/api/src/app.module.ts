import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentsModule } from './agents/agents.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillsModule } from './bills/bills.module.js';
import { CommonModule } from './common/common.module.js';
import { DraftsModule } from './drafts/drafts.module.js';
import { HealthController } from './common/health.controller.js';
import { ProjectsModule } from './projects/projects.module.js';
import { SearchModule } from './search/search.module.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    // Ограничение частоты запросов: обращения к моделям стоят дорого,
    // и одна неудачная страница интерфейса не должна расходовать квоту.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 20 },
      { name: 'long', ttl: 60_000, limit: 300 },
    ]),
    CommonModule,
    AuthModule,
    ProjectsModule,
    DraftsModule,
    BillsModule,
    SearchModule,
    TasksModule,
    AgentsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
