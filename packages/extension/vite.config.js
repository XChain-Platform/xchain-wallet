// Vite build for the MV3 extension shell — §9.5 / §51.
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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import sharp from 'sharp';

function copyManifestPlugin() {
    return {
        name: 'xchain-copy-manifest',
        apply: 'build',
        async closeBundle() {
            const manifest = await readFile(
                fileURLToPath(new URL('./manifest.json', import.meta.url)),
                'utf8',
            );
            await writeFile(
                fileURLToPath(new URL('./dist/manifest.json', import.meta.url)),
                manifest,
                'utf8',
            );
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
        copyManifestPlugin(),
        iconResizePlugin({
            source: new URL(
                '../core/src/branding/assets/favicon.png',
                import.meta.url,
            ),
            outDir: new URL('./dist/icons/', import.meta.url),
            sizes: [16, 32, 48, 128],
        }),
    ],
});
