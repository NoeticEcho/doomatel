/**
 * Разбор поля решений в событии хронологии.
 *
 * Поле `solution` выглядит как одно значение, но на деле содержит
 * **несколько атомарных решений, разделённых «; »**, причём порядок
 * элементов между записями не постоянен. Сравнивать поле целиком нельзя:
 * «принять законопроект в первом чтении; представить поправки»
 * и «представить поправки; принять законопроект в первом чтении» —
 * одно и то же событие, а строковое сравнение сочтёт их разными.
 *
 * Неизвестное решение не отбрасывается, а возвращается отдельным списком:
 * словарь пополняется, и молчаливая потеря нового вида решения означала бы,
 * что часть хронологии перестала отображаться и никто этого не заметил.
 */

export interface SolutionEntry {
  /** Устойчивый код решения. */
  code: string;
  /** Дословный текст решения из источника. */
  text: string;
  /** Стадия, на которой решение встречается. */
  stageId?: number;
}

/** Словарь решений, подтверждённый по дампам ответов API. */
export const SOLUTION_DICTIONARY: SolutionEntry[] = [
  // Стадия 2 — предварительное рассмотрение, Совет Государственной Думы.
  { code: 'assign_responsible_committee', text: 'назначить ответственный комитет', stageId: 2 },
  {
    code: 'submit_feedback',
    text: 'представить отзывы, предложения и замечания к законопроекту',
    stageId: 2,
  },
  { code: 'include_in_program', text: 'включить законопроект в примерную программу', stageId: 2 },
  {
    code: 'send_to_legal_department',
    text: 'направить законопроект на заключение в Правовое управление',
    stageId: 2,
  },
  {
    code: 'prepare_for_consideration',
    text: 'подготовить законопроект к рассмотрению Государственной Думой',
    stageId: 2,
  },
  {
    code: 'propose_accept_for_consideration',
    text: 'предложить принять законопроект к рассмотрению',
    stageId: 2,
  },
  {
    code: 'return_to_initiator',
    text: 'вернуть законопроект субъекту права законодательной инициативы для выполнения требований Конституции Российской Федерации и Регламента Государственной Думы',
    stageId: 2,
  },

  // Стадия 3 — первое чтение.
  {
    code: 'propose_first_reading',
    text: 'предложить принять законопроект в первом чтении',
    stageId: 3,
  },
  {
    code: 'propose_first_reading_and_whole',
    text: 'предложить принять законопроект в первом чтении и в целом',
    stageId: 3,
  },
  { code: 'adopted_first_reading', text: 'принять законопроект в первом чтении', stageId: 3 },
  { code: 'submit_amendments', text: 'представить поправки к законопроекту', stageId: 3 },
  { code: 'rejected', text: 'отклонить законопроект', stageId: 3 },
  {
    code: 'rejected_and_removed',
    text: 'отклонить законопроект и снять с дальнейшего рассмотрения',
    stageId: 3,
  },
  {
    code: 'postponed_to_other_session',
    text: 'перенести рассмотрение законопроекта на другое пленарное заседание',
    stageId: 3,
  },
  { code: 'postponed', text: 'отложить рассмотрение законопроекта', stageId: 3 },

  // Стадия 4 — второе чтение.
  {
    code: 'approve_amendment_table_accepted',
    text: 'утвердить таблицу поправок, рекомендуемых ответственным комитетом к принятию',
    stageId: 4,
  },
  {
    code: 'approve_amendment_table_rejected',
    text: 'утвердить таблицу поправок, рекомендуемых ответственным комитетом к отклонению',
    stageId: 4,
  },
  {
    code: 'propose_second_reading',
    text: 'предложить принять законопроект во втором чтении',
    stageId: 4,
  },

  // Стадия 5 — третье чтение.
  { code: 'law_adopted', text: 'принять закон', stageId: 5 },
  { code: 'law_approved', text: 'принять (одобрить) закон', stageId: 5 },

  // Стадия 6 — Совет Федерации.
  {
    code: 'council_review_mandatory',
    text: 'рассмотрение закона Советом Федерации является обязательным',
    stageId: 6,
  },
  {
    code: 'council_review_optional',
    text: 'рассмотрение закона Советом Федерации не является обязательным',
    stageId: 6,
  },
  { code: 'propose_approve', text: 'предложить одобрить закон', stageId: 6 },

  // Стадия 8 — Президент.
  { code: 'signed_by_president', text: 'закон подписан', stageId: 8 },

  // Любая стадия.
  {
    code: 'withdrawn_by_initiator',
    text: 'снять законопроект с рассмотрения Государственной Думы в связи с отзывом субъектом права законодательной инициативы',
  },
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/\s+/gu, ' ')
    .replace(/[.;]+$/u, '')
    .trim();
}

const BY_TEXT = new Map(SOLUTION_DICTIONARY.map((entry) => [normalize(entry.text), entry]));

export interface ParsedSolutions {
  /** Распознанные решения. */
  matched: SolutionEntry[];
  /** Нераспознанные фрагменты — подлежат добавлению в словарь. */
  unmatched: string[];
  /** Устойчивый ключ события: коды, отсортированные по алфавиту. */
  key: string;
}

/**
 * Разбирает поле решений в набор атомарных.
 *
 * Ключ события строится из отсортированных кодов, поэтому события,
 * различающиеся только порядком перечисления решений, дают один ключ.
 */
export function parseSolutions(solution: string | null | undefined): ParsedSolutions {
  if (!solution || solution.trim().length === 0) {
    return { matched: [], unmatched: [], key: '' };
  }

  const parts = solution
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const matched: SolutionEntry[] = [];
  const unmatched: string[] = [];

  for (const part of parts) {
    const entry = BY_TEXT.get(normalize(part));
    if (entry) matched.push(entry);
    else unmatched.push(part);
  }

  const key = [...matched.map((entry) => entry.code), ...unmatched.map((text) => `?${normalize(text)}`)]
    .sort()
    .join('+');

  return { matched, unmatched, key };
}

/** Проверяет, содержится ли решение с указанным кодом. */
export function hasSolution(solution: string | null | undefined, code: string): boolean {
  return parseSolutions(solution).matched.some((entry) => entry.code === code);
}
