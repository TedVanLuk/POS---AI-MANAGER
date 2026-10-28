import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  // `--mode demo` builds the self-contained artifact demo: one JS bundle, inlined by scripts/inline-demo.mjs.
  build: mode === 'demo'
    ? { outDir: 'dist-demo', assetsInlineLimit: 100_000_000, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } }
    : {},
}));
