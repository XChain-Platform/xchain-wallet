// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vite build for the MV3 extension shell: §9.5 / §51.
//
// Multi-entry rollup producing four bundles + one HTML asset at the paths
// manifest.json references:
//
//     background.js                       ← src/background.js
//     content/contentScript.js            ← src/content/contentScript.js
//     inject/xchainProvider.js            ← src/inject/xchainProvider.js
//     popup.html + assets/popup-<hash>.js ← popup.html + src/popup/main.jsx
//
// Workspace `@xchain-wallet/core` is split into a shared chunk so the
// entries don't duplicate it. The popup + its React tree are the only
// JSX/ESM-module consumers; background/content/inject stay vanilla ESM.
//
// Static assets handled by custom plugins:
//   - copyManifestPlugin: the canonical `manifest.json` lives at the
//     package root; this plugin copies it verbatim into dist/ on close.
//   - iconResizePlugin:  resizes the 128x128 favicon into the four PNG
//     sizes the MV3 manifest expects (`icons` + `action.default_icon`).

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import sharp from 'sharp';

// Absolute paths for our workspace-local Node shims that xchain-sdk
// pulls in at module load. Vite resolves these via resolve.alias below.
const wsBrowserShim = fileURLToPath(
    new URL('../core/src/shims/ws-browser.js', import.meta.url),
);
const httpBrowserShim = fileURLToPath(
    new URL('../core/src/shims/http-browser.js', import.meta.url),
);
const replBrowserShim = fileURLToPath(
    new URL('../core/src/shims/repl-browser.js', import.meta.url),
);

function copyManifestPlugin() {
    return {
        name: 'xchain-copy-manifest',
        apply: 'build',
        async closeBundle() {
            const manifest = await readFile(
                fileURLToPath(new URL('./manifest.json', import.meta.url)),
                'utf8',
            );
            // Ensure dist/ exists in case rollup tree-shook everything
            // away; the plugin's own output still needs a parent dir.
            await mkdir(
                fileURLToPath(new URL('./dist/', import.meta.url)),
                { recursive: true },
            );
            await writeFile(
                fileURLToPath(new URL('./dist/manifest.json', import.meta.url)),
                manifest,
                'utf8',
            );
        },
    };
}

// Copy the per-chain branding icons the dApp bridge's getSupportedChains
// hands out. Chain descriptors carry a bare filename (e.g.
// `bitcoin-mainnet-icon-20.png`); the bridge resolves it to
// `chrome-extension://<id>/chain-icons/<file>`, so the files must land at
// dist/chain-icons/ AND be listed under manifest web_accessible_resources.
// We copy every small (`*-icon-20.png`) icon so a new chain descriptor
// doesn't need a build change.
/**
 * @param {{ sourceDir: URL, outDir: URL }} opts
 */
function copyChainIconsPlugin({ sourceDir, outDir }) {
    return {
        name: 'xchain-copy-chain-icons',
        apply: 'build',
        async closeBundle() {
            const srcAbs = fileURLToPath(sourceDir);
            const outAbs = fileURLToPath(outDir);
            await mkdir(outAbs, { recursive: true });
            const entries = await readdir(srcAbs);
            const icons = entries.filter((f) => f.endsWith('-icon-20.png'));
            for (const file of icons) {
                await copyFile(
                    fileURLToPath(new URL(file, sourceDir)),
                    fileURLToPath(new URL(file, outDir)),
                );
            }
        },
    };
}

/**
 * @param {{ source: URL, outDir: URL, sizes: number[] }} opts
 */
function iconResizePlugin({ source, outDir, sizes }) {
    return {
        name: 'xchain-icon-resize',
        apply: 'build',
        async closeBundle() {
            const srcBuf = await readFile(fileURLToPath(source));
            const outAbs = fileURLToPath(outDir);
            await mkdir(outAbs, { recursive: true });
            for (const size of sizes) {
                const outPath = fileURLToPath(
                    new URL(`./icon-${size}.png`, outDir),
                );
                await sharp(srcBuf).resize(size, size).png().toFile(outPath);
            }
        },
    };
}

export default defineConfig({
    // Keep MV3-friendly: no eval, no dynamic imports in SW / content / inject,
    // stable output paths that match what manifest.json references.
    //
    // xchain-sdk is CJS and pulls in `ws` + `crypto` + Buffer at module load.
    // `ws` is aliased to our browser shim (packages/core/src/shims/ws-browser.js);
    // `crypto`/`Buffer`/`process`/`stream`/`events` are handled by
    // vite-plugin-node-polyfills. The polyfills add ~20–30 KB to the
    // popup + background chunks: acceptable for a wallet that needs to
    // sign PSBTs. Content + inject scripts don't touch the SDK, so
    // tree-shaking keeps the polyfills out of those bundles.
    resolve: {
        alias: {
            ws: wsBrowserShim,
            // xchain-sdk's encoder.js + explorer.js use `new http.Agent`
            // for connection pooling; browser manages its own pool, so
            // our tiny no-op shim avoids pulling in stream-http (~30 KB).
            http: httpBrowserShim,
            // repl is loaded transitively via xchain-sdk/index.js →
            // src/repl.js. The wallet never calls startREPL, so the
            // shim throws loudly if anything does.
            repl: replBrowserShim,
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: false,
        minify: false,
        rollupOptions: {
            input: {
                background: fileURLToPath(new URL('./src/background.js', import.meta.url)),
                contentScript: fileURLToPath(new URL('./src/content/contentScript.js', import.meta.url)),
                xchainProvider: fileURLToPath(new URL('./src/inject/xchainProvider.js', import.meta.url)),
                popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
                approval: fileURLToPath(new URL('./approval.html', import.meta.url)),
                sidepanel: fileURLToPath(new URL('./sidepanel.html', import.meta.url)),
            },
            output: {
                // Fixed output paths so manifest.json's string references
                // survive bundling. The HTML-backed popup entry goes through
                // Vite's HTML pipeline and lands at `dist/popup.html`; its
                // JS chunk is hash-named under `assets/`.
                entryFileNames: (chunk) => {
                    switch (chunk.name) {
                        case 'background':
                            return 'background.js';
                        case 'contentScript':
                            return 'content/contentScript.js';
                        case 'xchainProvider':
                            return 'inject/xchainProvider.js';
                        default:
                            return 'assets/[name]-[hash].js';
                    }
                },
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
                manualChunks: {
                    core: ['@xchain-wallet/core'],
                },
            },
        },
    },
    // manifest.json at the package root is copied via the plugin below.
    publicDir: false,
    plugins: [
        react(),
        nodePolyfills({
            include: ['buffer', 'process', 'crypto', 'events', 'stream', 'util'],
            globals: { Buffer: true, process: true, global: true },
            protocolImports: true,
        }),
        copyManifestPlugin(),
        copyChainIconsPlugin({
            sourceDir: new URL(
                '../core/src/branding/images/',
                import.meta.url,
            ),
            outDir: new URL('./dist/chain-icons/', import.meta.url),
        }),
        iconResizePlugin({
            source: new URL(
                '../core/src/branding/images/favicon.png',
                import.meta.url,
            ),
            outDir: new URL('./dist/icons/', import.meta.url),
            sizes: [16, 32, 48, 128],
        }),
    ],
});
