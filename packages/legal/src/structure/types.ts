import type { UnitKind, UnitRef } from '../identifiers/types.js';

/**
 * Узел структуры нормативного правового акта.
 *
 * Модель соответствует уровню Expression по FRBR: это конкретная редакция
 * текста. Узлы образуют дерево, порядок детей соответствует порядку в тексте.
 */
export interface StructuralUnit {
  kind: UnitKind;
  /** Номер единицы в исходном виде: «15», «15.1», «1», «а». */
  number?: string;
  /** Заголовок: «Предмет регулирования настоящего Федерального закона». */
  heading?: string;
  /** Собственный текст узла (без текста детей). */
  text: string;
  /** Путь от корня документа до этого узла, включая его самого. */
  path: UnitRef[];
  /** Позиция узла в исходном тексте: [start, end). */
  span: [number, number];
  children: StructuralUnit[];
}

export interface ParsedAct {
  /** Заголовок акта, если распознан. */
  title?: string;
  /** Вид акта по шапке текста. */
  actTypeLabel?: string;
  /** Преамбула — текст между шапкой и первой структурной единицей. */
  preamble?: StructuralUnit;
  /** Корневые структурные единицы (разделы, главы или сразу статьи). */
  units: StructuralUnit[];
  /** Предупреждения разбора. */
  warnings: string[];
}

/** Плоское представление узла — удобно для индексации и хранения. */
export interface FlatUnit {
  kind: UnitKind;
  number?: string;
  heading?: string;
  /** Текст узла вместе с текстом всех потомков. */
  fullText: string;
  /** Текст самого узла без потомков. */
  ownText: string;
  path: UnitRef[];
  /** Сериализованный путь: «st_15/p_3/i_2». */
  pathString: string;
  span: [number, number];
  /** Глубина в дереве, 0 для корневых. */
  depth: number;
}
