import { Node, mergeAttributes } from '@tiptap/core';

// Правила нумерации — предметная область, а не оформление;
// живут в `@doomatel/legal` и покрыты там тестами.
export { nextNumberBetween } from '@doomatel/legal';

/**
 * Структурные единицы нормативного правового акта как типы блоков.
 *
 * Почему не обычный текст с оформлением: правка законопроекта адресуется
 * структурной единицей — «изложить часть 3 статьи 15 в следующей редакции».
 * Если статья существует только как жирный абзац, адресовать правку нечем,
 * и приходится ссылаться на смещение в тексте, которое меняется при любой
 * соседней правке.
 *
 * Нумерация хранится в атрибуте, а не в тексте. Причина — правило
 * юридической техники: **менять существующую нумерацию при внесении
 * изменений недопустимо**, новые единицы получают дробные номера
 * («статья 15.1», «часть 2.1»). Автоматическая перенумерация всего документа
 * при вставке была бы прямой ошибкой, поэтому её здесь нет: номер задаётся
 * явно и проверяется.
 */

export interface LegalNodeAttributes {
  number: string | null;
  /** Идентификатор единицы, устойчивый к правкам: якорь для предложений. */
  eid: string | null;
}

const numberAttribute = {
  number: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-number'),
    renderHTML: (attributes: LegalNodeAttributes) =>
      attributes.number ? { 'data-number': attributes.number } : {},
  },
  eid: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-eid'),
    renderHTML: (attributes: LegalNodeAttributes) =>
      attributes.eid ? { 'data-eid': attributes.eid } : {},
  },
};

/** Статья — основная единица цитирования. */
export const LegalArticle = Node.create({
  name: 'legalArticle',
  group: 'block',
  content: 'legalArticleHeading legalClause+',
  defining: true,
  addAttributes: () => numberAttribute,
  parseHTML: () => [{ tag: 'section[data-legal="article"]' }],
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-legal': 'article' }), 0];
  },
});

/** Заголовок статьи: «Статья 15. Предмет регулирования». */
export const LegalArticleHeading = Node.create({
  name: 'legalArticleHeading',
  content: 'inline*',
  marks: '',
  defining: true,
  parseHTML: () => [{ tag: 'h3[data-legal="article-heading"]' }],
  renderHTML({ HTMLAttributes }) {
    return [
      'h3',
      mergeAttributes(HTMLAttributes, {
        'data-legal': 'article-heading',
        class: 'article-heading',
      }),
      0,
    ];
  },
});

/** Часть статьи — «1.», «2.». В кодексах эту роль играет пункт. */
export const LegalClause = Node.create({
  name: 'legalClause',
  group: 'block',
  content: 'inline*',
  addAttributes: () => numberAttribute,
  parseHTML: () => [{ tag: 'p[data-legal="clause"]' }],
  renderHTML({ HTMLAttributes, node }) {
    const number = node.attrs['number'];
    return [
      'p',
      mergeAttributes(HTMLAttributes, { 'data-legal': 'clause', class: 'clause' }),
      // Номер выводится как часть содержимого документа, а не как
      // оформление списка: при выгрузке в текст он должен сохраниться.
      ...(number ? [['span', { class: 'clause-number' }, `${number}. `] as const] : []),
      0,
    ];
  },
});

/** Пункт внутри части — «1)», «2)». */
export const LegalItem = Node.create({
  name: 'legalItem',
  group: 'block',
  content: 'inline*',
  addAttributes: () => numberAttribute,
  parseHTML: () => [{ tag: 'p[data-legal="item"]' }],
  renderHTML({ HTMLAttributes, node }) {
    const number = node.attrs['number'];
    return [
      'p',
      mergeAttributes(HTMLAttributes, { 'data-legal': 'item', class: 'clause' }),
      ...(number ? [['span', { class: 'item-number' }, `${number}) `] as const] : []),
      0,
    ];
  },
});
