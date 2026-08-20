import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessService } from './access.service.js';
import { SupabaseJwtService } from './supabase-jwt.service.js';
import { AuthGuard } from './auth.guard.js';

/**
 * Проверка личности и прав.
 *
 * Пользователь входит через Supabase Auth и приходит в этот сервис с токеном.
 * Сервис проверяет подпись токена и, что важнее, **сам вычисляет права**:
 * идентификатор пользователя берётся из токена, а перечень доступных проектов
 * и организаций — из базы. Содержимое токена, кроме подписанного `sub`,
 * правами не управляет: иначе достаточно было бы подделать одно поле.
 */
@Global()
@Module({
  providers: [SupabaseJwtService, AccessService, AuthGuard, ConfigService],
  exports: [SupabaseJwtService, AccessService, AuthGuard],
})
export class AuthModule {}
