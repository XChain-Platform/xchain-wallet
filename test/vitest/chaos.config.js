// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { maxForks } from './poolSize.js';

export default defineConfig({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    plugins: [react()],
    test: {
        // Bounded fork pool. Vitest defaults to one worker per core (32 on the
        // dev box), so a single run claimed the whole machine while many agent
        // sessions shared it. An abruptly killed run also leaves its pool
        // orphaned, and orphaned workers busy-spin at roughly a full core each
        // until something reaps them, so a smaller pool caps both the
        // steady-state cost and the blast radius. Raise on a dedicated runner
        // if suite wall-time regresses.
        pool: 'forks',
        poolOptions: {
            forks: { maxForks },
        },
        environment: 'jsdom',
        include: ['test/chaos/**/*.test.{js,jsx}'],
        setupFiles: ['./test/chaos/setup.js'],
        globals: false,
        testTimeout: 30_000,
    },
});
