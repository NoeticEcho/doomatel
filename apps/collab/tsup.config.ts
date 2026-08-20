import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'es2023',
});
