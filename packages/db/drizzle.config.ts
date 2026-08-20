import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? '',
  },
  // Схемы Supabase не трогаем: ими управляет сам Supabase.
  schemaFilter: ['public', 'legal'],
  verbose: true,
  strict: true,
});
