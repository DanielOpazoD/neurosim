import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 6620 },
  build: {
    target: 'es2022',
    // Three.js va en su propio chunk, cargado bajo demanda tras el primer
    // B-mode (DEC-56); ~575 kB sin comprimir es esperado para esa librería.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**'],
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
