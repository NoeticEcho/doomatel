import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.guard.js';

/** Извлекает проверенного пользователя из запроса. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) {
      throw new Error('CurrentUser использован в обработчике без AuthGuard');
    }
    return request.user;
  },
);
