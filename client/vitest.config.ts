import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/socket.ts', 'src/useCountdown.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        branches: 80,
      },
    },
  },
});
