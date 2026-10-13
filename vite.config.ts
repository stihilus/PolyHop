import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built editor works from any sub-path (itch.io serves HTML5 games from a sub-folder).
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022' },
  // some tests build whole projects or render minutes of music: leave room for a busy machine
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
