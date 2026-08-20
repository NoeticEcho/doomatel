import { z } from 'zod';

/**
 * Язык фильтров поиска.
 *
 * Существует, чтобы агент не строил фильтр Qdrant напрямую: сформированный
 * моделью JSON структуры хранилища невозможно проверить, и ошибка в нём
 * молча вернёт неверные документы. Вместо этого модель заполняет узкую
 * схему предметной области, схема проверяется, и только затем
 * детерминированно переводится в фильтр Qdrant.
 *
 * Побочная выгода: при смене векторного хранилища меняется только перевод.
 */

export const searchFilterSchema = z
  .object({
    /** Виды документов: закон, кодекс, пояснительная записка и так далее. */
    docKinds: z.array(z.string()).optional(),
    /** Идентификаторы актов (URI уровня Work). */
    workUris: z.array(z.string()).optional(),
    /** Номера актов: «149-ФЗ». */
    actNumbers: z.array(z.string()).optional(),
    /** Номера законопроектов: «149922-8». */
    billNumbers: z.array(z.string()).optional(),
    /** Созывы Государственной Думы. */
    convocations: z.array(z.number().int().min(1).max(20)).optional(),
    /** Номера статей. */
    articleNumbers: z.array(z.string()).optional(),
    /**
     * Дата, на которую должна действовать норма (ISO).
     * Переводится в условие `valid_from <= date < valid_to`.
     */
    inForceOn: z.string().optional(),
    /** Диапазон дат принятия акта. */
    actDateFrom: z.string().optional(),
    actDateTo: z.string().optional(),
    /** Арендатор: фракция, комитет или `public`. */
    tenantIds: z.array(z.string()).optional(),
    /** Ограничение по проектам — для поиска по рабочим материалам. */
    projectIds: z.array(z.string()).optional(),
    /** Уровень видимости. */
    visibility: z.array(z.enum(['public', 'organization', 'project', 'private'])).optional(),
  })
  .strict();

export type SearchFilter = z.infer<typeof searchFilterSchema>;

/** Условие фильтра Qdrant. */
type QdrantCondition = Record<string, unknown>;

export interface QdrantFilter {
  must?: QdrantCondition[];
  should?: QdrantCondition[];
  must_not?: QdrantCondition[];
}

/**
 * Переводит фильтр предметной области в фильтр Qdrant.
 *
 * Пустой фильтр даёт `undefined`, а не пустой объект: Qdrant отвергает
 * фильтр без условий.
 */
export function toQdrantFilter(filter: SearchFilter): QdrantFilter | undefined {
  const must: QdrantCondition[] = [];

  const anyOf = (key: string, values: readonly (string | number)[] | undefined) => {
    if (values && values.length > 0) must.push({ key, match: { any: [...values] } });
  };

  anyOf('doc_kind', filter.docKinds);
  anyOf('work_uri', filter.workUris);
  anyOf('act_number', filter.actNumbers);
  anyOf('bill_number', filter.billNumbers);
  anyOf('convocation', filter.convocations);
  anyOf('article_no', filter.articleNumbers);
  anyOf('tenant_id', filter.tenantIds);
  anyOf('project_id', filter.projectIds);
  anyOf('visibility', filter.visibility);

  if (filter.inForceOn) {
    // Норма действует на дату D, если она вступила в силу не позже D
    // и не утратила силу до D.
    must.push({ key: 'valid_from', range: { lte: filter.inForceOn } });
    must.push({ key: 'valid_to', range: { gt: filter.inForceOn } });
  }

  if (filter.actDateFrom || filter.actDateTo) {
    const range: Record<string, string> = {};
    if (filter.actDateFrom) range['gte'] = filter.actDateFrom;
    if (filter.actDateTo) range['lte'] = filter.actDateTo;
    must.push({ key: 'act_date', range });
  }

  return must.length > 0 ? { must } : undefined;
}

/**
 * Ограничивает фильтр правами пользователя.
 *
 * Вызывается **всегда** на стороне сервера, независимо от того, что пришло
 * от агента: агент может ошибиться или быть склонён к утечке через
 * содержимое документа, а этот фильтр — жёсткая граница.
 */
export function applyAccessScope(
  filter: QdrantFilter | undefined,
  scope: { userId: string; projectIds: string[]; tenantIds: string[] },
): QdrantFilter {
  const accessCondition: QdrantCondition = {
    should: [
      { key: 'visibility', match: { value: 'public' } },
      { key: 'owner_user_id', match: { value: scope.userId } },
      ...(scope.projectIds.length > 0
        ? [{ key: 'project_id', match: { any: scope.projectIds } }]
        : []),
      ...(scope.tenantIds.length > 0 ? [{ key: 'tenant_id', match: { any: scope.tenantIds } }] : []),
    ],
  };

  return { must: [...(filter?.must ?? []), accessCondition] };
}
