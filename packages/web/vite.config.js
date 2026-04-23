// Vite build for the web SPA shell — §9.5 / §51.
//
// Minimal Phase 1 infra scaffold. The entry HTML lives at the package
// root (`index.html`) per Vite convention; built assets land in
// `dist/`. The UI session will add: a framework (React/Solid/vanilla —
// decision pending), CSS tooling, routing, i18n wiring, and page
// shells (popup, full-screen). This config exists to prove the
// pipeline bundles core + the web shell into a loadable artifact.

import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: true,
    },
    server: {
        port: 5173,
    },
});
