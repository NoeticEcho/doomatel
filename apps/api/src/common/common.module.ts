import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { QdrantService } from './qdrant.service.js';

@Global()
@Module({
  providers: [DatabaseService, QdrantService],
  exports: [DatabaseService, QdrantService],
})
export class CommonModule {}
