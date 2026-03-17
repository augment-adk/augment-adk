import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/index.ts',
        'src/model.ts',
        'src/runner/RunResult.ts',
        'src/runner/steps.ts',
        'src/stream/events.ts',
        'src/stream/runStreamEvents.ts',
        'src/tools/toolScopeProvider.ts',
        'src/types/lifecycle.ts',
        'src/types/modelConfig.ts',
        'src/types/responsesApi.ts',
      ],
    },
  },
});
