// Vite build for the MV3 extension shell — §9.5 / §51.
//
// Multi-entry rollup: three bundles land at the paths the manifest.json
// references. Vite's module resolution + workspace linking means the
// shared @xchain-wallet/core code gets tree-shaken into whichever
// bundles actually import it.
//
// The manifest.json itself lives at the package root; Vite's
// `publicDir` copies it into `dist/` verbatim. Anything else that
// needs to ship as a static asset (icons, when §5.5 resolves them,
// popup HTML when the UI lands) goes in `public/`.
//
// Scope note (Phase 1 infra session): this config exists to prove the
// build pipeline works and produces a loadable MV3 artifact. Popup +
// full-screen HTML entries get added in the UI session — they would
// slot in as additional `rollupOptions.input` keys pointing at the
// HTML file.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Copy the MV3 manifest.json from the package root into `dist/` at the
 * close of the build. Using a plugin rather than `publicDir` so the
 * canonical source of the manifest stays at `packages/extension/manifest.json`
 * — the UI session will add popup / full-screen HTML next to it.
 */
function copyManifestPlugin() {
    return {
        name: 'xchain-copy-manifest',
        apply: 'build',
        async closeBundle() {
            const manifest = await readFile(
                fileURLToPath(new URL('./manifest.json', import.meta.url)),
                'utf8',
            );
            // Write via Vite's emitted-assets helper via writeFile to dist.
            const { writeFile } = await import('node:fs/promises');
            await writeFile(
                fileURLToPath(new URL('./dist/manifest.json', import.meta.url)),
                manifest,
                'utf8',
            );
        },
    };
}

export default defineConfig({
    // Keep MV3-friendly: no eval, no dynamic imports, stable output paths
    // that match what manifest.json references.
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // MV3 service workers can't import URL-relative modules — Rollup
        // must produce self-contained bundles per entry.
        target: 'es2022',
        sourcemap: false,
        minify: false,
        rollupOptions: {
            input: {
                background: fileURLToPath(new URL('./src/background.js', import.meta.url)),
                contentScript: fileURLToPath(new URL('./src/content/contentScript.js', import.meta.url)),
                xchainProvider: fileURLToPath(new URL('./src/inject/xchainProvider.js', import.meta.url)),
            },
            output: {
                // Fixed output paths so manifest.json's string references
                // survive bundling. Any dynamic chunking lands under
                // chunks/ and won't break the manifest.
                entryFileNames: (chunk) => {
                    switch (chunk.name) {
                        case 'background':
                            return 'background.js';
                        case 'contentScript':
                            return 'content/contentScript.js';
                        case 'xchainProvider':
                            return 'inject/xchainProvider.js';
                        default:
                            return '[name].js';
                    }
                },
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
                // One shared core chunk across the three entries rather
                // than duplicating @xchain-wallet/core per bundle.
                manualChunks: {
                    core: ['@xchain-wallet/core'],
                },
            },
        },
    },
    // manifest.json at the package root is copied via the plugin below.
    publicDir: false,
    plugins: [copyManifestPlugin()],
});
