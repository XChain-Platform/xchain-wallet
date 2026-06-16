// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vitest config for the integration test layer.
//
// Scoped to test/integration/. Bumped per-test timeout to 30 s because
// integration tests cross the Vault / KDF / migration seams and the
// floor-tier Argon2 params still take real wall-clock time. Uses jsdom
// so tests that touch UI-adjacent code (schemas wired to React surfaces)
// still resolve cleanly.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/integration/**/*.test.{js,jsx}'],
        exclude: ['node_modules/**'],
        setupFiles: ['./test/integration/setup.js'],
        globals: false,
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
