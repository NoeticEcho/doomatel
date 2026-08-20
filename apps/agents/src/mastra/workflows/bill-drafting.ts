import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';

/**
 * Рабочий процесс подготовки законопроекта.
 *
 * Процесс воспроизводит порядок реальной работы, а не удобный порядок для
 * модели. В частности:
 *
 *  - анализ действующего регулирования выполняется **до** написания текста:
 *    проект, написанный без него, приходится переписывать целиком;
 *  - экспертиза выполняется циклом до устранения замечаний, а не однократно;
 *  - готовый текст **не выпускается без визы человека**. Это принципиально:
 *    ответственность за внесённый законопроект несёт депутат, и решение
 *    о выпуске не может принимать программа.
 *
 * Шаг визирования реализован через приостановку процесса, поэтому ожидание
 * решения не занимает ресурсов и переживает перезапуск сервиса
 * (при подключённом постоянном хранилище состояния).
 */

export interface BillDraftingDeps {
  analyst: Agent;
  drafter: Agent;
  expert: Agent;
  finance: Agent;
  /** Предельное число кругов доработки по замечаниям экспертизы. */
  maxReviewRounds?: number;
}

const analysisSchema = z.object({
  currentRegulation: z.string().describe('Как вопрос урегулирован сейчас, со ссылками'),
  gaps: z.array(z.string()).describe('Выявленные пробелы и противоречия'),
  relatedBills: z.array(z.string()).describe('Ранее вносившиеся законопроекты по теме'),
  actsToAmend: z.array(z.string()).describe('Акты, в которые требуется внести изменения'),
});

const draftSchema = z.object({
  billText: z.string().describe('Текст законопроекта'),
  explanatoryNote: z.string().describe('Пояснительная записка'),
  repealList: z.string().describe('Перечень актов, подлежащих изменению или отмене'),
});

const reviewSchema = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(['critical', 'major', 'minor']),
      unit: z.string().describe('Норма проекта, к которой относится замечание'),
      factorCode: z.string().optional().describe('Код коррупциогенного фактора'),
      description: z.string(),
      suggestedFix: z.string(),
    }),
  ),
  blockingCount: z.number().describe('Число замечаний, препятствующих внесению'),
  conclusion: z.string(),
});

export function createBillDraftingWorkflow(deps: BillDraftingDeps) {
  const maxRounds = deps.maxReviewRounds ?? 3;

  const gatherContext = createStep({
    id: 'analysis',
    description: 'Анализ действующего регулирования и истории вопроса',
    inputSchema: z.object({
      task: z.string().describe('Задание на разработку законопроекта'),
      committee: z.string().optional(),
    }),
    outputSchema: analysisSchema.extend({ task: z.string() }),
    execute: async ({ inputData }) => {
      const result = await deps.analyst.generate(
        `Подготовь аналитическую основу для разработки законопроекта.\n\n` +
          `Задание: ${inputData.task}\n` +
          (inputData.committee ? `Профильный комитет: ${inputData.committee}\n` : '') +
          `\nОпредели: как вопрос урегулирован сейчас (со ссылками на нормы), ` +
          `какие есть пробелы и противоречия, какие законопроекты по теме вносились ранее ` +
          `и чем закончились, в какие акты потребуется внести изменения.`,
        { structuredOutput: { schema: analysisSchema } },
      );
      return { ...(result.object as z.infer<typeof analysisSchema>), task: inputData.task };
    },
  });

  const writeDraft = createStep({
    id: 'draft',
    description: 'Подготовка текста законопроекта и сопроводительных документов',
    inputSchema: analysisSchema.extend({ task: z.string() }),
    outputSchema: draftSchema.extend({ task: z.string(), round: z.number() }),
    execute: async ({ inputData }) => {
      const result = await deps.drafter.generate(
        `Подготовь текст законопроекта по заданию и результатам анализа.\n\n` +
          `Задание: ${inputData.task}\n\n` +
          `Действующее регулирование:\n${inputData.currentRegulation}\n\n` +
          `Выявленные пробелы:\n${inputData.gaps.map((gap) => `— ${gap}`).join('\n')}\n\n` +
          `Акты, требующие изменения:\n${inputData.actsToAmend.map((act) => `— ${act}`).join('\n')}\n\n` +
          `Перед составлением каждой правки получи действующий текст изменяемой нормы ` +
          `инструментом поиска. Подготовь также пояснительную записку и перечень актов, ` +
          `подлежащих признанию утратившими силу, изменению или принятию.`,
        { structuredOutput: { schema: draftSchema } },
      );
      return {
        ...(result.object as z.infer<typeof draftSchema>),
        task: inputData.task,
        round: 1,
      };
    },
  });

  const review = createStep({
    id: 'review',
    description: 'Правовая и антикоррупционная экспертиза проекта',
    inputSchema: draftSchema.extend({ task: z.string(), round: z.number() }),
    outputSchema: draftSchema.extend({
      task: z.string(),
      round: z.number(),
      review: reviewSchema,
    }),
    execute: async ({ inputData }) => {
      const result = await deps.expert.generate(
        `Проведи экспертизу проекта.\n\nТекст законопроекта:\n${inputData.billText}\n\n` +
          `Проверь все двенадцать коррупциогенных факторов, внутреннюю непротиворечивость, ` +
          `соответствие актам большей силы и соблюдение правил юридической техники. ` +
          `По каждому замечанию укажи норму проекта и предложи формулировку исправления.`,
        { structuredOutput: { schema: reviewSchema } },
      );
      return { ...inputData, review: result.object as z.infer<typeof reviewSchema> };
    },
  });

  const revise = createStep({
    id: 'revise',
    description: 'Доработка проекта по замечаниям экспертизы',
    inputSchema: draftSchema.extend({
      task: z.string(),
      round: z.number(),
      review: reviewSchema,
    }),
    outputSchema: draftSchema.extend({
      task: z.string(),
      round: z.number(),
      review: reviewSchema,
    }),
    execute: async ({ inputData }) => {
      // Круги доработки ограничены: если после нескольких проходов замечания
      // не исчерпаны, дальнейшая автоматическая правка обычно начинает ходить
      // по кругу, и вопрос нужно выносить человеку.
      if (inputData.round >= maxRounds || inputData.review.blockingCount === 0) {
        return inputData;
      }

      const findings = inputData.review.findings
        .filter((finding) => finding.severity !== 'minor')
        .map(
          (finding) =>
            `— [${finding.severity}] ${finding.unit}: ${finding.description}\n  Предложение: ${finding.suggestedFix}`,
        )
        .join('\n');

      const result = await deps.drafter.generate(
        `Устрани замечания экспертизы в тексте законопроекта.\n\n` +
          `Текущий текст:\n${inputData.billText}\n\nЗамечания:\n${findings}\n\n` +
          `Верни исправленный текст целиком, а также при необходимости обновлённую ` +
          `пояснительную записку и перечень актов.`,
        { structuredOutput: { schema: draftSchema } },
      );

      const revised = result.object as z.infer<typeof draftSchema>;

      // Повторная экспертиза выполняется здесь же: без неё условие выхода
      // из цикла опиралось бы на результат предыдущего круга и не изменилось
      // бы никогда.
      const recheck = await deps.expert.generate(
        `Проверь исправленный текст законопроекта повторно.\n\n${revised.billText}\n\n` +
          `Оцени, устранены ли ранее выявленные замечания, и не появились ли новые.`,
        { structuredOutput: { schema: reviewSchema } },
      );

      return {
        ...inputData,
        ...revised,
        review: recheck.object as z.infer<typeof reviewSchema>,
        round: inputData.round + 1,
      };
    },
  });

  const financialJustification = createStep({
    id: 'finance',
    description: 'Финансово-экономическое обоснование',
    inputSchema: draftSchema.extend({
      task: z.string(),
      round: z.number(),
      review: reviewSchema,
    }),
    outputSchema: draftSchema.extend({
      task: z.string(),
      review: reviewSchema,
      financialJustification: z.string(),
      governmentOpinionRequired: z.boolean(),
    }),
    execute: async ({ inputData }) => {
      const result = await deps.finance.generate(
        `Подготовь финансово-экономическое обоснование законопроекта.\n\n` +
          `Текст:\n${inputData.billText}\n\n` +
          `Отдельно ответь, требуется ли заключение Правительства Российской Федерации ` +
          `по части 3 статьи 104 Конституции Российской Федерации.`,
        {
          structuredOutput: {
            schema: z.object({
              justification: z.string(),
              governmentOpinionRequired: z.boolean(),
              reasoning: z.string(),
            }),
          },
        },
      );
      const output = result.object as {
        justification: string;
        governmentOpinionRequired: boolean;
      };
      return {
        billText: inputData.billText,
        explanatoryNote: inputData.explanatoryNote,
        repealList: inputData.repealList,
        task: inputData.task,
        review: inputData.review,
        financialJustification: output.justification,
        governmentOpinionRequired: output.governmentOpinionRequired,
      };
    },
  });

  /**
   * Визирование депутатом.
   *
   * Процесс приостанавливается и ждёт решения человека. Автоматический выпуск
   * законопроекта недопустим: ответственность за внесённый документ несёт
   * депутат, а не программа.
   */
  const approvalOutputSchema = z.object({
    billText: z.string(),
    explanatoryNote: z.string(),
    repealList: z.string(),
    financialJustification: z.string(),
    governmentOpinionRequired: z.boolean(),
    approved: z.boolean(),
    approver: z.string(),
    comment: z.string().optional(),
    review: reviewSchema,
  });

  const approval = createStep({
    id: 'approval',
    description: 'Визирование пакета документов депутатом',
    inputSchema: draftSchema.extend({
      task: z.string(),
      review: reviewSchema,
      financialJustification: z.string(),
      governmentOpinionRequired: z.boolean(),
    }),
    suspendSchema: z.object({
      message: z.string(),
      billText: z.string(),
      explanatoryNote: z.string(),
      financialJustification: z.string(),
      blockingFindings: z.number(),
      governmentOpinionRequired: z.boolean(),
      requestedAt: z.string(),
    }),
    resumeSchema: z.object({
      approved: z.boolean(),
      approver: z.string().describe('Кто завизировал'),
      corrections: z.string().optional().describe('Правки, внесённые при визировании'),
      comment: z.string().optional(),
    }),
    outputSchema: approvalOutputSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      if (!resumeData) {
        return await suspend({
          message:
            inputData.review.blockingCount > 0
              ? `Пакет подготовлен, но экспертиза оставила ${inputData.review.blockingCount} замечаний, ` +
                'препятствующих внесению. Требуется решение.'
              : 'Пакет документов подготовлен и требует визы.',
          billText: inputData.billText,
          explanatoryNote: inputData.explanatoryNote,
          financialJustification: inputData.financialJustification,
          blockingFindings: inputData.review.blockingCount,
          governmentOpinionRequired: inputData.governmentOpinionRequired,
          requestedAt: new Date().toISOString(),
        });
      }

      return {
        billText: resumeData.corrections ?? inputData.billText,
        explanatoryNote: inputData.explanatoryNote,
        repealList: inputData.repealList,
        financialJustification: inputData.financialJustification,
        governmentOpinionRequired: inputData.governmentOpinionRequired,
        approved: resumeData.approved,
        approver: resumeData.approver,
        comment: resumeData.comment,
        review: inputData.review,
      };
    },
  });

  return createWorkflow({
    id: 'bill-drafting',
    description:
      'Полный цикл подготовки законопроекта: анализ, составление, экспертиза, ' +
      'финансово-экономическое обоснование, визирование депутатом.',
    inputSchema: z.object({
      task: z.string(),
      committee: z.string().optional(),
    }),
    outputSchema: approvalOutputSchema,
  })
    .then(gatherContext)
    .then(writeDraft)
    .then(review)
    // Цикл доработки: повторяется, пока экспертиза находит блокирующие
    // замечания и не исчерпан лимит кругов.
    .dountil(revise, async ({ inputData }) => {
      const data = inputData as { review: z.infer<typeof reviewSchema>; round: number };
      return data.review.blockingCount === 0 || data.round >= maxRounds;
    })
    .then(financialJustification)
    .then(approval)
    .commit();
}
