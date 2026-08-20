import { z } from 'zod';

/**
 * Клиент прикладного сервиса.
 *
 * Ответы проверяются схемами: интерфейс не должен молча ломаться при
 * изменении формы данных на сервере. Ошибка проверки — это ошибка,
 * а не пустая страница без объяснения.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Токен доступа. Обновляется вызывающим кодом при истечении. */
  getToken: () => string | undefined | Promise<string | undefined>;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const token = await this.options.getToken();
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      let details: unknown;
      try {
        details = JSON.parse(text);
      } catch {
        details = text;
      }
      throw new ApiError(
        response.status === 401
          ? 'Требуется вход в систему'
          : response.status === 404
            ? 'Не найдено'
            : `Ошибка сервиса (${response.status})`,
        response.status,
        details,
      );
    }

    const parsed = schema.safeParse(text.length > 0 ? JSON.parse(text) : null);
    if (!parsed.success) {
      throw new ApiError(
        'Ответ сервиса не соответствует ожидаемой форме. Возможно, версии интерфейса и сервиса разошлись.',
        response.status,
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, schema);
  }

  post<T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> {
    return this.request(path, schema, { method: 'POST', body: JSON.stringify(body) });
  }

  patch<T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> {
    return this.request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });
  }
}

// ── Схемы ответов ──────────────────────────────────────────────────────────

export const projectSchema = z.object({
  id: z.string(),
  scope: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  organizationId: z.string().nullable(),
  workgroupId: z.string().nullable(),
  billNumber: z.string().nullable(),
  status: z.string(),
  stage: z.string().nullable(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListSchema = z.array(projectSchema);

export const draftSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  version: z.number(),
  updatedAt: z.string(),
});
export type DraftSummary = z.infer<typeof draftSummarySchema>;

export const draftSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  plainText: z.string(),
  version: z.number(),
});
export type Draft = z.infer<typeof draftSchema>;

export const searchResultSchema = z.object({
  id: z.union([z.string(), z.number()]),
  score: z.number(),
  citation: z.unknown(),
  citationFull: z.unknown(),
  text: z.unknown(),
  workUri: z.unknown(),
  path: z.unknown(),
  validFrom: z.unknown(),
  validTo: z.unknown(),
});

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  total: z.number(),
  candidatesConsidered: z.number().optional(),
  warning: z.string().optional(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const analysisSchema = z.object({
  structure: z.object({
    title: z.string().optional(),
    units: z.array(
      z.object({
        kind: z.string(),
        number: z.string().optional(),
        heading: z.string().optional(),
        path: z.string(),
      }),
    ),
    warnings: z.array(z.string()),
  }),
  references: z.array(
    z.object({
      raw: z.string(),
      actUri: z.string(),
      path: z.string(),
      confidence: z.number(),
      span: z.tuple([z.number(), z.number()]),
    }),
  ),
});
export type DraftAnalysis = z.infer<typeof analysisSchema>;

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  assigneeId: z.string().nullable(),
  dueDate: z.string().nullable(),
  projectId: z.string().nullable(),
});
export type Task = z.infer<typeof taskSchema>;
