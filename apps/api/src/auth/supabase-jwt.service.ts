import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Проверка токена Supabase Auth.
 *
 * Supabase выпускает токены двух видов: подписанные симметричным секретом
 * (устаревающий вариант) и подписанные асимметричным ключом с публикацией
 * набора ключей по адресу `/auth/v1/.well-known/jwks.json`. Поддерживаются оба,
 * потому что развёртывания различаются, а требовать миграции перед запуском
 * продукта нельзя.
 */
@Injectable()
export class SupabaseJwtService {
  private readonly logger = new Logger(SupabaseJwtService.name);
  private readonly secret?: Uint8Array;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer?: string;

  constructor(config: ConfigService) {
    const secret = config.get<string>('SUPABASE_JWT_SECRET');
    const supabaseUrl = config.get<string>('SUPABASE_URL');

    if (secret) {
      this.secret = new TextEncoder().encode(secret);
    }
    if (supabaseUrl) {
      this.issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
      this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    }
    if (!secret && !supabaseUrl) {
      this.logger.error(
        'Не настроена проверка токенов: задайте SUPABASE_JWT_SECRET или SUPABASE_URL. ' +
          'Сервис откажет во всех запросах, требующих авторизации.',
      );
    }
  }

  /** Проверяет токен и возвращает его полезную нагрузку. */
  async verify(token: string): Promise<JWTPayload> {
    const errors: string[] = [];

    if (this.jwks) {
      try {
        const { payload } = await jwtVerify(token, this.jwks, {
          ...(this.issuer ? { issuer: this.issuer } : {}),
        });
        return payload;
      } catch (error) {
        errors.push(`асимметричная проверка: ${(error as Error).message}`);
      }
    }

    if (this.secret) {
      try {
        const { payload } = await jwtVerify(token, this.secret, {
          ...(this.issuer ? { issuer: this.issuer } : {}),
        });
        return payload;
      } catch (error) {
        errors.push(`симметричная проверка: ${(error as Error).message}`);
      }
    }

    throw new UnauthorizedException(
      errors.length > 0 ? `Токен не прошёл проверку (${errors.join('; ')})` : 'Проверка токенов не настроена',
    );
  }
}
