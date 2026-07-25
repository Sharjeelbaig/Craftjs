import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@domain': resolvePath('./src/domain'),
      '@application': resolvePath('./src/application'),
      '@infrastructure': resolvePath('./src/infrastructure'),
      '@presentation': resolvePath('./src/presentation'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
