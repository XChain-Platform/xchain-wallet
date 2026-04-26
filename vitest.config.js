// Vitest config for the xchain-wallet workspace.
//
// All tests live at the workspace root under `test/` (matching the
// per-component test layout used across the XChain Platform).
// Each test type owns its own subdir + its own setup file:
//
//   test/unit/          fast pure-logic tests (this config)
//   test/smoke/         Node-script smokes (runs via test/_run-smokes.js,
//                        not Vitest)
//   test/integration/   multi-package wiring (separate vitest config
//                        once it lands)
//   test/e2e/           Playwright (own runner, own config in e2e/)
//   test/chaos/, fuzz/, security/, regression/, boundary/, …
//
// Vitest is scoped to ONE test type per config so that adding new
// test categories doesn't expand the unit suite's runtime.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/unit/**/*.test.{js,jsx}'],
        exclude: ['test/**/*.smoke.js', 'node_modules/**'],
        setupFiles: ['./test/unit/setup.js'],
        globals: false,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['packages/core/src/**/*.{js,jsx}'],
            exclude: [
                'packages/core/src/**/index.js',
                'packages/core/src/branding/assets/**',
                'packages/core/src/ui/tokens.css',
            ],
        },
    },
});
