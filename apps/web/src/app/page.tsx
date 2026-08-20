import Link from 'next/link';
import { FileText, Scale, Search, Users } from 'lucide-react';

/**
 * Начальная страница.
 *
 * Четыре входа соответствуют четырём способам начать работу, а не разделам
 * меню: депутат приходит либо с вопросом, либо с документом, либо
 * к коллегам, либо к списку дел.
 */
export default function HomePage() {
  const entries = [
    {
      href: '/search',
      icon: Search,
      title: 'Найти норму',
      description: 'Поиск по действующему законодательству с точными ссылками',
    },
    {
      href: '/projects',
      icon: FileText,
      title: 'Проекты',
      description: 'Законопроекты в работе, документы пакета, поправки',
    },
    {
      href: '/bills',
      icon: Scale,
      title: 'Законопроекты',
      description: 'Внесённые законопроекты, хронология рассмотрения',
    },
    {
      href: '/tasks',
      icon: Users,
      title: 'Задачи',
      description: 'Поручения по проектам и рабочим группам',
    },
  ];

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-12">
        <h1 className="text-3xl font-bold tracking-tight">Doomatel</h1>
        <p className="mt-2 max-w-2xl text-[color:var(--color-muted)]">
          Помощник в законотворческой деятельности. Каждое утверждение
          о содержании действующего права сопровождается ссылкой на норму —
          иначе утверждение не приводится.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-lg border border-[color:var(--color-line)] bg-white p-5 transition hover:border-[color:var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          >
            <Icon
              aria-hidden
              className="mb-3 size-5 text-[color:var(--color-accent)]"
            />
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">{description}</p>
          </Link>
        ))}
      </div>

      <section className="mt-12 rounded-lg border border-[color:var(--color-warn)]/30 bg-[color:var(--color-warn)]/5 p-5">
        <h2 className="font-semibold">Состояние системы</h2>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          Система находится в разработке. Часть источников законодательства
          ещё не подключена — до подключения помощник сообщает об отсутствии
          подтверждающей нормы вместо того, чтобы дать правдоподобный ответ
          без ссылки.
        </p>
      </section>
    </main>
  );
}
