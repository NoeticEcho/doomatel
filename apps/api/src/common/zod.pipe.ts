import { BadRequestException, Body, PipeTransform, type ArgumentMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Проверка тела запроса схемой zod.
 *
 * Схемы описаны на zod, а не на декораторах class-validator, потому что те же
 * схемы используются в инструментах агентов и в клиенте: одно описание формы
 * данных на весь проект вместо трёх расходящихся.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Тело запроса не соответствует схеме',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

/** Сокращение: `@ZodBody(schema) body: T`. */
export const ZodBody = <T>(schema: ZodType<T>) => Body(new ZodValidationPipe(schema));
