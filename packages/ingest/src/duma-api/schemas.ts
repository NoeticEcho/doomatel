import { z } from 'zod';

/**
 * Схемы ответов ИС «Законотворчество» (`api.duma.gov.ru`).
 *
 * Построены по документации портала и реальным дампам ответов из открытых
 * клиентов API. Все необязательные поля помечены `.nullish()`, потому что
 * API возвращает `null` там, где данных ещё нет (например, `committees.responsible`
 * до назначения ответственного комитета).
 *
 * Схемы намеренно «мягкие» (`.catchall`/`.nullish`): при изменении API
 * ингест не должен падать целиком — расхождения фиксируются в отчёте валидации.
 */

export const dumaReference = z.object({
  id: z.number().int(),
  name: z.string(),
});
export type DumaReference = z.infer<typeof dumaReference>;

export const dumaOrgan = z.object({
  id: z.number().int(),
  name: z.string(),
  isCurrent: z.boolean().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
});
export type DumaOrgan = z.infer<typeof dumaOrgan>;

export const dumaLastEvent = z.object({
  stage: dumaReference.nullish(),
  phase: dumaReference.nullish(),
  solution: z.string().nullish(),
  date: z.string().nullish(),
  document: z
    .object({
      name: z.string().nullish(),
      type: z.string().nullish(),
      date: z.string().nullish(),
      number: z.string().nullish(),
    })
    .nullish(),
});
export type DumaLastEvent = z.infer<typeof dumaLastEvent>;

export const dumaSubject = z.object({
  deputies: z.array(dumaOrgan).default([]),
  departments: z.array(dumaOrgan).default([]),
  factions: z.array(dumaOrgan).default([]),
});

export const dumaCommittees = z.object({
  responsible: dumaOrgan.nullish(),
  profile: z.array(dumaOrgan).default([]),
  soexecutor: z.array(dumaOrgan).default([]),
});

export const dumaLaw = z.object({
  id: z.number().int(),
  /** Естественный ключ законопроекта: «{порядковый номер}-{созыв}», напр. «149922-8». */
  number: z.string(),
  name: z.string(),
  comments: z.string().nullish(),
  introductionDate: z.string().nullish(),
  url: z.string().nullish(),
  transcriptUrl: z.string().nullish(),
  lastEvent: dumaLastEvent.nullish(),
  subject: dumaSubject.nullish(),
  committees: dumaCommittees.nullish(),
  type: dumaReference.nullish(),
});
export type DumaLaw = z.infer<typeof dumaLaw>;

export const dumaSearchResponse = z.object({
  count: z.number().int(),
  page: z.number().int().nullish(),
  wording: z.string().nullish(),
  laws: z.array(dumaLaw).default([]),
});
export type DumaSearchResponse = z.infer<typeof dumaSearchResponse>;

export const dumaDeputy = z.object({
  id: z.number().int(),
  name: z.string(),
  position: z.string().nullish(),
  isCurrent: z.boolean().nullish(),
  factions: z.array(dumaOrgan).nullish(),
  credentialsStart: z.string().nullish(),
  credentialsEnd: z.string().nullish(),
});
export type DumaDeputy = z.infer<typeof dumaDeputy>;

export const dumaReferenceList = z.array(dumaReference);

/**
 * Коды статусов законопроекта для параметра `status` метода `/search`.
 * Значения подтверждены по открытым парсерам, использующим этот API.
 */
export const BILL_STATUS_CODES = {
  1: 'внесён в Государственную Думу',
  2: 'находится на рассмотрении в Государственной Думе',
  4: 'в примерной программе комитета',
  5: 'в примерной программе',
  6: 'рассмотрение завершено',
  7: 'подписан Президентом Российской Федерации',
  8: 'отклонён (снят) Государственной Думой',
  9: 'отозван или возвращён субъекту права законодательной инициативы',
  10: 'действующие',
  99: 'рассмотрение завершено по прочим причинам',
} as const;

export type BillStatusCode = keyof typeof BILL_STATUS_CODES;
