import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('bootstrap');

  app.use(helmet({ contentSecurityPolicy: false }));
  // Глобальный ValidationPipe не подключается: проверка тела запросов идёт
  // схемами zod (`ZodValidationPipe`), общими с инструментами агентов
  // и клиентом. Держать две системы описания одних и тех же форм данных —
  // прямой путь к их расхождению.

  const origins = (process.env['CORS_ORIGINS'] ?? 'http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Doomatel API')
      .setDescription('Прикладной интерфейс законотворческой платформы')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env['API_PORT'] ?? 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`Прикладной сервис Doomatel слушает порт ${port}`);
}

void bootstrap();
