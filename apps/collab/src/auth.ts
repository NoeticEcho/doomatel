import { createRemoteJWKSet, jwtVerify } from 'jose';
import postgres from 'postgres';

/**
 * Проверка права на документ при подключении к сеансу совместной работы.
 *
 * Это единственное место, где решается, пустить ли пользователя к документу.
 * Проверка выполняется **один раз при подключении**, а дальше соединение
 * живёт часами — поэтому отзыв доступа не действует мгновенно.
 * Ограничение осознанное: разрывать соединение при каждом изменении прав
 * означало бы терять несохранённые правки. Компенсируется ограничением
 * срока жизни соединения и повторной проверкой при переподключении.
 */

export interface CollabAuthOptions {
  supabaseUrl?: string;
  jwtSecret?: string;
  databaseUrl: string;
  /** Как часто перепроверять права у долгоживущих соединений, мс. */
  recheckIntervalMs?: number;
}

export interface DocumentAccess {
  userId: string;
  draftId: string;
  projectId: string;
  /** Может ли пользователь изменять документ. */
  canWrite: boolean;
  role: string;
}

export class CollabAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollabAuthError';
  }
}

/** Имя документа в сеансе: `draft:<uuid>`. */
export function parseDocumentName(documentName: string): { draftId: string } {
  const match = /^draft:([0-9a-f-]{36})$/iu.exec(documentName);
  if (!match) {
    throw new CollabAuthError(
      `Некорректное имя документа: «${documentName}». Ожидается «draft:<идентификатор>».`,
    );
  }
  return { draftId: match[1]! };
}

export class CollabAuth {
  private readonly sql: postgres.Sql;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly secret?: Uint8Array;
  private readonly issuer?: string;

  constructor(private readonly options: CollabAuthOptions) {
    this.sql = postgres(options.databaseUrl, { max: 5, onnotice: () => undefined });
    if (options.jwtSecret) this.secret = new TextEncoder().encode(options.jwtSecret);
    if (options.supabaseUrl) {
      this.issuer = `${options.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
      this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    }
    if (!options.jwtSecret && !options.supabaseUrl) {
      throw new CollabAuthError(
        'Не настроена проверка токенов: укажите SUPABASE_JWT_SECRET или SUPABASE_URL',
      );
    }
  }

  /** Проверяет токен и права на документ. */
  async authorize(token: string, documentName: string): Promise<DocumentAccess> {
    const { draftId } = parseDocumentName(documentName);
    const userId = await this.verifyToken(token);

    const rows = await this.sql<Array<{ project_id: string; role: string | null }>>`
      select d.project_id::text as project_id,
             public.project_role(d.project_id, ${userId}::uuid)::text as role
      from public.draft d
      where d.id = ${draftId}::uuid
    `;

    const row = rows[0];
    if (!row) throw new CollabAuthError('Документ не найден');
    if (!row.role) {
      // Отсутствие доступа и отсутствие документа снаружи неразличимы.
      throw new CollabAuthError('Документ не найден');
    }

    // Рецензент подключается только для чтения: правки он вносит
    // предложениями, а не изменением текста.
    const canWrite = ['owner', 'admin', 'editor', 'contributor'].includes(row.role);

    return { userId, draftId, projectId: row.project_id, canWrite, role: row.role };
  }

  /** Повторная проверка прав для долгоживущего соединения. */
  async stillAllowed(access: DocumentAccess): Promise<boolean> {
    const rows = await this.sql<Array<{ role: string | null }>>`
      select public.project_role(${access.projectId}::uuid, ${access.userId}::uuid)::text as role
    `;
    return Boolean(rows[0]?.role);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  private async verifyToken(token: string): Promise<string> {
    const errors: string[] = [];

    if (this.jwks) {
      try {
        const { payload } = await jwtVerify(token, this.jwks, {
          ...(this.issuer ? { issuer: this.issuer } : {}),
        });
        if (payload.sub) return payload.sub;
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    if (this.secret) {
      try {
        const { payload } = await jwtVerify(token, this.secret, {
          ...(this.issuer ? { issuer: this.issuer } : {}),
        });
        if (payload.sub) return payload.sub;
      } catch (error) {
        errors.push((error as Error).message);
      }
    }

    throw new CollabAuthError(`Токен не прошёл проверку: ${errors.join('; ')}`);
  }
}
