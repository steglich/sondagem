import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['extensao/{background,injected,shared,storage}/**/*.test.ts'],
  },
});
