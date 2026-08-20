import { createCollabServer } from './server.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('Не задана переменная окружения DATABASE_URL');
  process.exit(1);
}

const collab = createCollabServer({
  port: Number(process.env['COLLAB_PORT'] ?? 3003),
  databaseUrl,
  ...(process.env['SUPABASE_URL'] ? { supabaseUrl: process.env['SUPABASE_URL'] } : {}),
  ...(process.env['SUPABASE_JWT_SECRET'] ? { jwtSecret: process.env['SUPABASE_JWT_SECRET'] } : {}),
});

await collab.listen();
console.log(`Сервис совместного редактирования слушает порт ${process.env['COLLAB_PORT'] ?? 3003}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void collab.close().then(() => process.exit(0));
  });
}
