import { defineConfig } from 'vite';

// The runtime of exported games: one plain script (no modules), so it also works when the exported
// index.html is opened from disk. The editor reads it from /player/player.js when it exports.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/player',
    emptyOutDir: true,
    target: 'es2020',
    minify: true,
    lib: { entry: 'src/player/main.ts', formats: ['iife'], name: 'PolyHopPlayer', fileName: () => 'player.js' },
  },
});
