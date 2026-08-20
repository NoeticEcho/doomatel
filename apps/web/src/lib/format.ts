/** Форматирование дат и чисел для русского интерфейса. */

const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date);
}

/**
 * Склонение существительного при числительном.
 * «1 законопроект», «2 законопроекта», «5 законопроектов».
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function withCount(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`;
}

/** Человекочитаемое название вида документа. */
export const DRAFT_KIND_LABELS: Record<string, string> = {
  bill: 'Текст законопроекта',
  explanatory_note: 'Пояснительная записка',
  financial_justification: 'Финансово-экономическое обоснование',
  repeal_list: 'Перечень актов',
  amendment_table: 'Таблица поправок',
  conclusion: 'Заключение',
  review: 'Отзыв',
  speech: 'Выступление',
  presentation: 'Презентация',
  analytical_note: 'Аналитическая записка',
  inquiry: 'Депутатский запрос',
  other: 'Иной документ',
};

export const PROJECT_SCOPE_LABELS: Record<string, string> = {
  organization: 'Проект партии',
  faction: 'Проект фракции',
  workgroup: 'Проект рабочей группы',
  personal: 'Личный проект',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  backlog: 'Отложено',
  todo: 'К выполнению',
  in_progress: 'В работе',
  in_review: 'На проверке',
  blocked: 'Заблокировано',
  done: 'Выполнено',
  cancelled: 'Отменено',
};
