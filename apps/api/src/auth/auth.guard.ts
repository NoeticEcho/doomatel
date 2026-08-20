import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SupabaseJwtService } from './supabase-jwt.service.js';

/** Помечает обработчик как доступный без авторизации. */
export const PUBLIC_ROUTE = 'doomatel:public-route';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export interface AuthenticatedUser {
  id: string;
  email?: string;
  /** Исходный токен — пробрасывается сервису агентов для его же запросов. */
  token: string;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Проверка токена на входе.
 *
 * Guard не принимает решений о правах: он лишь устанавливает, кто обратился.
 * Права проверяются в обработчиках через `AccessService`, потому что они
 * зависят от объекта запроса, а не только от личности.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: SupabaseJwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Требуется заголовок Authorization: Bearer <токен>');
    }

    const token = header.slice('Bearer '.length);
    const payload = await this.jwt.verify(token);
    if (!payload.sub) {
      throw new UnauthorizedException('В токене отсутствует идентификатор пользователя');
    }

    request.user = {
      id: payload.sub,
      ...(typeof payload['email'] === 'string' ? { email: payload['email'] } : {}),
      token,
    };
    return true;
  }
}
