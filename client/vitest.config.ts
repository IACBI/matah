import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['src/__tests__/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      // Everything the tests can meaningfully reach. The exclusions are data
      // and static art, both covered by their own parity checks or by nothing
      // a unit test could assert about them.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/i18n/translations.ts',
        'src/components/{Avatar,Flag,GameIcons,icons,Confetti}.tsx',
        'src/__tests__/**',
      ],
      reporter: ['text', 'json-summary'],
      // Set from a measured run; raise as suites land, never lower to pass.
      thresholds: {
        lines: 62,
        branches: 70,
      },
    },
  },
});
