// Vitest config for @xchain-wallet/core — §52.2.
//
// Runs alongside the existing Node-script smoke suite (test/*.smoke.js).
// Vitest owns:
//   - Pure-JS unit tests in test/*.test.js (decoder, schemas, uri, etc.)
//   - React component tests in test/ui/*.test.jsx via jsdom +
//     @testing-library/react.
//
// Node-script smokes stay the primary integration-style verification —
// they exercise host round-trips against a real Vault and are
// runnable with plain `node` without installing vitest. Vitest
// complements them with per-unit coverage + a DOM for component tests.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/**/*.test.{js,jsx}'],
        exclude: ['test/**/*.smoke.js', 'node_modules/**'],
        setupFiles: ['./test/setup.js'],
        globals: false,
        // Coverage threshold intentionally unset — the Vitest suite
        // covers a narrow slice today (decoder + a handful of UI
        // primitives). Raise to 80% per §52.2 as Batch 5 grows.
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.{js,jsx}'],
            exclude: [
                'src/**/index.js',
                'src/branding/assets/**',
                'src/ui/tokens.css',
            ],
        },
    },
});
