// Vite build for the web SPA shell — §9.5 / §51.
//
// Single-page React app served out of `packages/web/dist/`. The entry
// HTML (`index.html`) points at `src/main.jsx`; Vite resolves
// @xchain-wallet/core (+ its branding assets via
// `new URL('./assets/…', import.meta.url)`) and the extension package
// for the shared `createBackgroundHost` factory.
//
// Scope note (web vs extension): the web SPA builds its own in-page
// MessageHost rather than dispatching messages over chrome.runtime —
// see `src/hostBridge.js`. The createBackgroundHost import is the one
// piece of intentional cross-shell reuse; a later refactor extracts
// host wiring to a lower-level package once a third shell appears.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react()],
});
