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
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const here = fileURLToPath(new URL('.', import.meta.url));

// THE RENDERER HAD NO NODE POLYFILLS AND THE OTHER TWO SHELLS BOTH DO
// ( there, frontier row 102 here). xchain-sdk is CJS and touches
// `Buffer` at MODULE LOAD - bitcoinjs-lib runs `check({ script:
// Buffer.alloc(1), value: 1n })` while its module is still evaluating - and
// this window runs with `nodeIntegration: false`, `contextIsolation: true`
// and `sandbox: true`, so there is no `Buffer` for it to find and the
// preload exposes none.
//
// Measured 2026-08-07 by launching the real app under Playwright's Electron
// driver: `ReferenceError: Buffer is not defined` at module scope, the React
// tree never mounts, and the window is BLANK WHITE. The same bytes are in
// the shipped v0.336.0 `.deb`. Nothing caught it because nothing in this
// repo had ever launched the app and looked at it - "it starts" had been
// measured as "a window appeared".
//
// The shim resolver mirrors packages/web and packages/extension: the
// polyfill plugin rewrites Buffer/process/global inside transformed CJS to
// bare `vite-plugin-node-polyfills/shims/*` specifiers, which Rollup cannot
// resolve from a dependency's own directory under pnpm's strict layout, so
// they are resolved to absolute paths from THIS package's context, under the
// ESM condition (the CJS branch has no default export and dies at boot).
const shimRequire = createRequire(import.meta.url);
const polyfillShimResolver = {
    name: 'xchain-polyfill-shim-resolver',
    enforce: 'pre',
    resolveId(source) {
        if (source.startsWith('vite-plugin-node-polyfills/shims/')) {
            try {
                return fileURLToPath(import.meta.resolve(source));
            } catch {
                return shimRequire.resolve(source);
            }
        }
        return null;
    },
};

export default defineConfig({
    root: resolve(here, 'renderer'),
    build: {
        outDir: resolve(here, 'renderer', 'dist'),
        emptyOutDir: true,
        // Source maps off; see the module docstring + the reproducible-builds doc
        // (https://docs.xchain.io/components/wallet/reproducible-builds)
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
    plugins: [
        polyfillShimResolver,
        react(),
        nodePolyfills({
            include: ['buffer', 'process', 'crypto', 'events', 'stream', 'util'],
            globals: { Buffer: true, process: true, global: true },
            protocolImports: true,
        }),
    ],
    // Electron renderer runs under `file://` (via loadFile); no base
    // prefix or dev server needed.
    base: './',
});
