'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiProvider } from './api-provider';
import { createClient } from '@/lib/supabase';

/**
 * Общие поставщики контекста.
 *
 * Токен доступа берётся из сеанса при каждом запросе. Сохранять его
 * в состоянии нельзя: срок жизни токена короче времени работы страницы,
 * и сохранённый токен приведёт к отказу в доступе посреди работы.
 *
 * Клиент Supabase создаётся отложенно: при отсутствии настроек приложение
 * должно показать понятное сообщение, а не упасть при первом рендере.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      createClient();
      setConfigured(true);
    } catch {
      setConfigured(false);
    }
  }, []);

  const getToken = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token;
    } catch {
      return undefined;
    }
  }, []);

  return (
    <ApiProvider getToken={getToken}>
      {configured === false && (
        <div className="border-b border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 px-4 py-2 text-sm">
          Не заданы настройки входа (<code>NEXT_PUBLIC_SUPABASE_URL</code> и{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>). Работа с данными недоступна.
        </div>
      )}
      {children}
    </ApiProvider>
  );
}
