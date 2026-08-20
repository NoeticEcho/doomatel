import type { Metadata } from 'next';
import { SearchView } from '@/components/search-view';

export const metadata: Metadata = { title: 'Поиск по законодательству' };

export default function SearchPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Поиск по законодательству</h1>
      <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted)]">
        Поиск объединяет смысловую близость, совпадение слов и точное совпадение
        реквизитов. Указывайте номер акта или статьи, если он известен, —
        так выдача точнее.
      </p>
      <SearchView className="mt-6" />
    </main>
  );
}
