import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 6620 },
  build: {
    target: 'es2022',
    // Three.js va en su propio chunk, cargado bajo demanda tras el primer
    // B-mode (DEC-56); ~620 kB sin comprimir es esperado para esa librería
    // (575 kB + las clases del núcleo que usa GLTFLoader, DEC-59).
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // GLTFLoader aparte (DEC-59): solo lo pide la cabeza escaneada.
        manualChunks: (id) =>
          id.includes('/node_modules/three/examples/jsm/loaders/')
            ? 'three-gltf'
            : id.includes('/node_modules/three/')
              ? 'three'
              : undefined,
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
