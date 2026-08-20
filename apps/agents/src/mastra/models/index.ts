import type { MastraModelConfig } from '@mastra/core/llm';

/**
 * Настройка языковых моделей.
 *
 * Ключевое требование к продукту: работа в контуре, где внешние зарубежные
 * сервисы недоступны и юридически неприменимы. Поэтому единственный
 * поддерживаемый способ подключения модели — эндпоинт, совместимый
 * с протоколом OpenAI. Под него подходят и собственный инференс (vLLM,
 * Ollama, TGI), и российские сервисы, предоставляющие совместимый режим.
 *
 * Провайдер нигде не зашит в коде агентов: агент получает роль модели
 * («основная», «быстрая», «длинный контекст»), а сопоставление роли
 * конкретной модели задаётся конфигурацией.
 */

export type ModelRole = 'primary' | 'fast' | 'long';

export interface ModelEndpoint {
  /** Идентификатор провайдера, например `vllm`, `gigachat`, `yandexgpt`. */
  providerId: string;
  /** Идентификатор модели у провайдера. */
  modelId: string;
  /** Базовый адрес совместимого эндпоинта, оканчивающийся на `/v1`. */
  url: string;
  /** Статический ключ. Для провайдеров с короткоживущим токеном не задаётся. */
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface ModelsConfig {
  primary: ModelEndpoint;
  fast: ModelEndpoint;
  long: ModelEndpoint;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. ` +
        'Слой моделей требует явной настройки: молчаливый переход на внешний ' +
        'сервис в государственном контуре недопустим.',
    );
  }
  return value;
}

/** Читает настройку моделей из окружения. */
export function loadModelsConfig(env: NodeJS.ProcessEnv = process.env): ModelsConfig {
  const url = env['LLM_BASE_URL'] ?? requireEnv('LLM_BASE_URL');
  const apiKey = env['LLM_API_KEY'];
  const provider = env['LLM_PROVIDER_ID'] ?? 'local';

  const endpoint = (modelEnv: string, fallback: string): ModelEndpoint => ({
    providerId: provider,
    modelId: env[modelEnv] ?? env['LLM_MODEL'] ?? fallback,
    url,
    ...(apiKey ? { apiKey } : {}),
  });

  return {
    primary: endpoint('LLM_MODEL', 'qwen3-32b-instruct'),
    fast: endpoint('LLM_MODEL_FAST', 'qwen3-8b-instruct'),
    long: endpoint('LLM_MODEL_LONG', 'qwen3-32b-instruct'),
  };
}

/** Преобразует описание эндпоинта в конфигурацию модели Mastra. */
export function toMastraModel(endpoint: ModelEndpoint): MastraModelConfig {
  return {
    id: `${endpoint.providerId}/${endpoint.modelId}` as `${string}/${string}`,
    url: endpoint.url,
    apiKey: endpoint.apiKey ?? 'not-needed',
    ...(endpoint.headers ? { headers: endpoint.headers } : {}),
  } as MastraModelConfig;
}

/**
 * Провайдер, выдающий короткоживущий токен (характерно для GigaChat:
 * токен действует около получаса). Возвращает функцию, пригодную для
 * динамической настройки модели агента.
 */
export interface TokenProvider {
  getToken(): Promise<string>;
}

/** Кеш токена с обновлением заранее до истечения срока. */
export class RefreshingTokenCache implements TokenProvider {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly fetchToken: () => Promise<{ value: string; expiresInSec: number }>,
    /** За сколько секунд до истечения обновлять токен. */
    private readonly refreshMarginSec = 120,
  ) {}

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - this.refreshMarginSec * 1000 > now) {
      return this.token.value;
    }
    const fresh = await this.fetchToken();
    this.token = { value: fresh.value, expiresAt: now + fresh.expiresInSec * 1000 };
    return this.token.value;
  }
}

/**
 * Строит динамическую настройку модели: ключ запрашивается при каждом вызове.
 * Нужен провайдерам с ротацией токена.
 */
export function dynamicModel(
  endpoint: Omit<ModelEndpoint, 'apiKey'>,
  tokens: TokenProvider,
): () => Promise<MastraModelConfig> {
  return async () =>
    ({
      id: `${endpoint.providerId}/${endpoint.modelId}` as `${string}/${string}`,
      url: endpoint.url,
      apiKey: await tokens.getToken(),
      ...(endpoint.headers ? { headers: endpoint.headers } : {}),
    }) as MastraModelConfig;
}
