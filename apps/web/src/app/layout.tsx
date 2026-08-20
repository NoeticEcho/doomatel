import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Doomatel',
    template: '%s — Doomatel',
  },
  description:
    'Платформа законотворческой деятельности: поиск по действующему праву, ' +
    'подготовка законопроектов, совместная работа, экспертиза.',
  // Материалы законопроектов до внесения не должны попадать в поисковые системы.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
