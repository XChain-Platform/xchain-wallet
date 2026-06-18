// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vite config: Electron renderer target.
//
// Produces `renderer/dist/` which `main/index.js`'s `loadFile` points
// at and electron-builder's `files` glob pulls into the asar. Kept
// narrow on purpose: no dev-server (Electron loads the bundle off
// disk) + no source maps in production (keeps the reproducible-build
// output stable + trims binary size).

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: resolve(here, 'renderer'),
    build: {
        outDir: resolve(here, 'renderer', 'dist'),
        emptyOutDir: true,
        // Source maps off; see the module docstring + REPRODUCIBLE_BUILDS.md
        // "non-determinism sources". Re-enable in a local dev config if
        // you need to debug a shipped bundle.
        sourcemap: false,
        // Disable asset inlining for deterministic chunk hashing;
        // small binary assets land as separate files with content-hash
        // names, which hash stably across builds.
        assetsInlineLimit: 0,
        rollupOptions: {
            output: {
                // Deterministic chunk names. Vite's default includes
                // a hash, which is fine (content-addressed), but we
                // pin the pattern here so changes surface via review.
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
    plugins: [react()],
    // Electron renderer runs under `file://` (via loadFile); no base
    // prefix or dev server needed.
    base: './',
});
