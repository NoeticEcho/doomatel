'use client';

import { createContext, useContext, useMemo } from 'react';
import { ApiClient } from '@/lib/api';

/**
 * Доступ к прикладному сервису.
 *
 * Токен берётся из сеанса Supabase при каждом запросе, а не сохраняется
 * в состоянии: сохранённый токен рано или поздно оказывается просроченным,
 * и пользователь получает ошибку вместо обновления.
 */

const ApiContext = createContext<ApiClient | null>(null);

export interface ApiProviderProps {
  children: React.ReactNode;
  /** Возвращает действующий токен доступа. */
  getToken: () => string | undefined | Promise<string | undefined>;
  baseUrl?: string;
}

export function ApiProvider({ children, getToken, baseUrl }: ApiProviderProps) {
  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl: baseUrl ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3001',
        getToken,
      }),
    [baseUrl, getToken],
  );

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('useApi использован вне ApiProvider');
  }
  return client;
}
