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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The web shell's mechanism, imported rather than reimplemented: a second
// copy of "what does this profile stamp say" is how the two shells would
// come to disagree about what a `store` build even is.
import {
    PROFILE_STAMP_FILE, profileStampFor, resolveBuildProfile,
} from '../web/buildProfile.js';
// Same reasoning, same mechanism: a `store` build carries no regtest full-node
// sidecar. Imported from the web shell rather than copied, so the two shells
// cannot come to disagree about what a `store` build contains.
import { regtestSidecarPlugin } from '../web/regtestSidecar.js';
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

// (mirrors packages/web/vite.config.js): vite-plugin-node-polyfills
// rewrites Buffer/process/global inside transformed CJS to bare
// `vite-plugin-node-polyfills/shims/*` specifiers, which cannot resolve
// from the `link:`-resolved xchain-sdk directory under pnpm's strict
// layout. Resolve them from THIS package's context instead.
const shimRequire = createRequire(import.meta.url);
const polyfillShimResolver = {
    name: 'xchain-polyfill-shim-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
        if (source.startsWith('vite-plugin-node-polyfills/shims/')) {
            return shimRequire.resolve(source);
        }
        // xchain-sdk/src/repl.js carries a top-level `require.main ===
        // module` CLI-entry check that the commonjs transform leaves as a
        // bare `require`, which throws on load in a browser. The wallet
        // never uses the SDK REPL, so route the module to the repl browser
        // shim (startREPL resolves to undefined, which nothing calls).
        if (
            /(^|\/)repl\.js$/.test(source)
            && importer && importer.includes('xchain-sdk')
        ) {
            return replBrowserShim;
        }
        return null;
    },
};

// xchain-sdk's musig2.js does `require('@brandonblack/musig/base_crypto')`;
// resolve the subpath from the SDK's own context (see the web config),
// through node_modules rather than a sibling directory.
const musigBaseCrypto = createRequire(
    createRequire(import.meta.url).resolve('xchain-sdk/package.json'),
).resolve('@brandonblack/musig/base_crypto');

/**
 * Emit `build-profile.txt` into the extension bundle.
 *
 * The web shell has done this, for a reason that reads as
 * mobile-specific and is not: `packages/mobile` stages `packages/web/dist`
 * verbatim, so without a stamp travelling INSIDE the bundle there is nothing
 * to stop a `default` build being wrapped in a store artifact and labelled
 * `store` in a signed manifest.
 *
 * The extension shell has the same exposure by a different route. Measured
 * 2026-08-06 against the real v0.336.0 release zip: it carries no stamp, the
 * release workflow sets `XCHAIN_BUILD_PROFILE: store` on the mobile lane and
 * on no other, and the artifact bound for the Chrome Web Store therefore
 * contains the review-hidden DEX surfaces with nothing in it saying so. The
 * upload ceremony could assert nothing about which of the two builds it was
 * submitting, and Chrome assigns a permanent extension ID to whatever is
 * uploaded first.
 *
 * `resolveBuildProfile` THROWS on an unrecognized value rather than falling
 * back, which is the whole point of the shared helper: a typo that silently
 * produced a `default` build for a lane that then labelled it `store` is the
 * failure this mechanism exists to prevent.
 */
function stampBuildProfilePlugin() {
    const profile = resolveBuildProfile();
    return {
        name: 'xchain-stamp-build-profile',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: PROFILE_STAMP_FILE,
                source: profileStampFor(profile),
            });
        },
    };
}

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
            // The same clients pick `require('https').Agent` for
            // https endpoints (every mainnet default); without this alias
            // real-SDK construction throws in the browser and wallet
            // creation never completes.
            https: httpBrowserShim,
            // repl is loaded transitively via xchain-sdk/index.js →
            // src/repl.js. The wallet never calls startREPL, so the
            // shim throws loudly if anything does.
            repl: replBrowserShim,
            // Point the bare musig subpath at its real file (see note above).
            '@brandonblack/musig/base_crypto': musigBaseCrypto,
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: false,
        minify: false,
        // Xchain-sdk is a `link:` dep living outside every
        // node_modules dir, so Rollup's commonjs pass (default include
        // /node_modules/) skipped it and the bundle kept literal require()
        // calls; evaluating those throws in the worker and the extension
        // silently fell back to the dev-mock SDK. Include the SDK explicitly;
        // polyfillShimResolver above resolves the bare shim specifiers the
        // transform surfaces.
        commonjsOptions: {
            include: [/node_modules/, /xchain-sdk/],
            transformMixedEsModules: true,
        },
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
        polyfillShimResolver,
        stampBuildProfilePlugin(),
        regtestSidecarPlugin(resolveBuildProfile()),
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
