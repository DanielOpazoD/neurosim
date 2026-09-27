import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 6620 },
  build: { target: 'es2022' },
});
