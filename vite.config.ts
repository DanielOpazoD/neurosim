import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 6620 },
  build: { target: 'es2022' },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/ui/**', 'src/doppler/audio.ts'],
      thresholds: {
        'src/core/**': { lines: 80 },
        'src/ultrasound/**': { lines: 70 },
        'src/doppler/**': { lines: 60 },
        'src/anatomy/**': { lines: 70 },
      },
    },
  },
});
