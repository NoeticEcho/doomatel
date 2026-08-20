import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Пакеты рабочего пространства собираются вместе с приложением:
  // отдельная сборка каждого при разработке замедляет цикл.
  transpilePackages: ['@doomatel/legal'],
  experimental: {
    // Ответы агентов приходят потоком и идут минутами.
    proxyTimeout: 600_000,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
