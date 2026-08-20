import { createBrowserClient } from '@supabase/ssr';

/**
 * Клиент Supabase в браузере.
 *
 * Используется только для входа и получения токена. Данные приложения
 * идут через прикладной сервис: там проверяются права и ведётся журнал
 * действий, обязательный для этого контура.
 */
export function createClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !key) {
    throw new Error(
      'Не заданы NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Вход в систему невозможен.',
    );
  }
  return createBrowserClient(url, key);
}
