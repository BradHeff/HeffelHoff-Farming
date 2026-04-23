import { defineConfig } from 'vite';

// Relative base so the built index.html works inside Capacitor's WebView
// (which serves from file://... or capacitor://localhost, not the domain root).
export default defineConfig({
  base: './',
  server: {
    host: true,
    watch: {
      // Prevent gradle output and native project churn from triggering reloads.
      ignored: ['**/android/**', '**/dist/**', '**/node_modules/**'],
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
