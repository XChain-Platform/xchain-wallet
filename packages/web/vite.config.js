// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vite build for the web SPA shell (§9.5 / §51), served from
// `packages/web/dist/`. Web builds its own in-page MessageHost
// (`src/hostBridge.js`) rather than dispatching over chrome.runtime;
// createBackgroundHost is the one cross-shell reuse.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { metaContentSecurityPolicyFor } from './src/csp.js';
// Which feature set this build carries. Resolved once,
// here, so the CSP and the stamp written into the dist cannot disagree.
import { PROFILE_STAMP_FILE, profileStampFor, resolveBuildProfile } from './buildProfile.js';
// Which SURFACES this profile carries. The registry is data; the two
// pieces below are the mechanism that acts on it.
import { SURFACE_MODULES, hiddenSurfacesFor } from './src/surfaces/registry.js';
// Keep the SDK's regtest full-node sidecar (a Node-only dev path, and the
// `fullnode.regtest.json` literal beside it) out of a `store` bundle. Inert in
// every other profile; fails the build shut if a marker survives.
import { regtestSidecarPlugin } from './regtestSidecar.js';

const BUILD_PROFILE = resolveBuildProfile();
const HIDDEN_SURFACES = hiddenSurfacesFor(BUILD_PROFILE);

// Swap each hidden surface's module for its inert twin: store-hidden surfaces
// are COMPILED OUT, never switched off (a surface that can be switched back on
// is a guideline 2.3.1 hidden feature). The regex spans the whole specifier, so
// the replacement is an absolute path and matches from any importer's relative
// depth.
const surfaceAliases = HIDDEN_SURFACES.map((surface) => ({
    find: new RegExp(`^(?:.*/)?surfaces/${surface}\\.jsx$`),
    replacement: fileURLToPath(
        new URL(`./src/surfaces/${surface}.hidden.jsx`, import.meta.url),
    ),
}));

// FAIL SHUT if a hidden surface's code reaches the graph anyway: the alias
// holds only while the surface module is its route components' ONLY importer,
// and a second importer anywhere re-bundles the surface into a `store` build
// whose signed manifest still claims its absence. Refuse rather than ship that
// claim.
const surfaceGuardPlugin = {
    name: 'xchain-hidden-surface-guard',
    // MUST be 'pre'. A 'post' plugin's resolveId never runs: Vite's own
    // resolver answers first and the first non-null answer wins, so the guard
    // would pass everything silently. 'pre' plus `this.resolve` with skipSelf
    // hands the work to the normal chain and inspects its answer.
    enforce: 'pre',
    async resolveId(source, importer, options) {
        if (HIDDEN_SURFACES.length === 0) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!resolved || resolved.external) return null;
        const id = resolved.id.split('?')[0].replace(/\\/g, '/');
        for (const surface of HIDDEN_SURFACES) {
            for (const mod of SURFACE_MODULES[surface] ?? []) {
                if (id.endsWith(`/${mod}`)) {
                    this.error(
                        `build profile ${JSON.stringify(BUILD_PROFILE)} hides the`
                        + ` ${JSON.stringify(surface)} surface, but ${mod} was imported`
                        + ` by ${importer ?? '<entry>'}. Only src/surfaces/${surface}.jsx`
                        + ' may import it, and that module is aliased away in this'
                        + ' profile. See src/surfaces/registry.js.',
                    );
                }
            }
        }
        return null;
    },
};
// Subresource Integrity. The CSP says WHERE scripts may come from; SRI
// pins WHAT they contain, so a tampered bundle on the asset host cannot execute
// in a page that holds the user's decrypted seed. Build-only, like the CSP.
import { sriPlugin } from './sri.js';
// HTTPS is OPT-IN via `VITE_HTTPS=1`. The wallet's crypto surfaces
// (`crypto.subtle.*`, `navigator.clipboard.*`, `getUserMedia`, WebUSB / WebHID)
// require a secure context, which `localhost` has natively; a LAN or VM
// hostname needs the self-signed cert `@vitejs/plugin-basic-ssl` generates
// under the flag.
import basicSsl from '@vitejs/plugin-basic-ssl';

const httpsEnabled = process.env.VITE_HTTPS === '1' || process.env.HTTPS === '1';
// Extra Host header to allow when demoing the dev server over a LAN, since
// Vite otherwise rejects any Host it doesn't recognize.
const devAllowedHost = process.env.VITE_DEV_ALLOWED_HOST || null;

// Dev-only: rewrite a bare `/style-guide` to `/style-guide/` so Vite picks up
// the multi-page entry at packages/web/style-guide/index.html; without the
// trailing slash its static-asset middleware returns 404.
function styleGuideRewrite() {
    return (req, res, next) => {
        if (req.url === '/style-guide') {
            res.statusCode = 301;
            res.setHeader('Location', '/style-guide/');
            res.end();
            return;
        }
        next();
    };
}

const styleGuidePlugin = {
    name: 'xchain-style-guide-rewrite',
    apply: 'serve',
    configureServer(server) { server.middlewares.use(styleGuideRewrite()); },
    configurePreviewServer(server) { server.middlewares.use(styleGuideRewrite()); },
};

// Inject the app-controlled Content-Security-Policy meta tag into the built
// index.html. Build-only: dev's HMR needs inline scripts, eval and a websocket
// that a strict script-src breaks, and the shipped bundle must carry the policy
// rather than depend on a server header being set.
const cspPlugin = {
    name: 'xchain-csp',
    apply: 'build',
    transformIndexHtml() {
        return [
            {
                tag: 'meta',
                attrs: {
                    'http-equiv': 'Content-Security-Policy',
                    // Profile-aware: the mobile store build drops the Trezor
                    // origins no WebView can reach, rather than shipping a
                    // permanently-allowed remote script origin it cannot use.
                    content: metaContentSecurityPolicyFor(BUILD_PROFILE),
                },
                injectTo: 'head-prepend',
            },
            {
                // The profile the app was built with, readable at runtime. The
                // stamp file below is for tooling; this is for the app and for
                // anyone inspecting a served page.
                tag: 'meta',
                attrs: { name: 'xchain-build-profile', content: BUILD_PROFILE },
                injectTo: 'head-prepend',
            },
        ];
    },
    // `packages/mobile` copies this dist VERBATIM, so the profile has to travel
    // INSIDE the bundle: without the stamp nothing stops a `default` bundle
    // being wrapped in a store artifact and labelled `store` in a signed
    // manifest.
    generateBundle() {
        this.emitFile({
            type: 'asset',
            fileName: PROFILE_STAMP_FILE,
            source: profileStampFor(BUILD_PROFILE),
        });
    },
};

// Absolute paths to workspace-local Node shims that xchain-sdk pulls
// in at module load. Vite resolves these via resolve.alias below.
const wsBrowserShim = fileURLToPath(
    new URL('../core/src/shims/ws-browser.js', import.meta.url),
);
const httpBrowserShim = fileURLToPath(
    new URL('../core/src/shims/http-browser.js', import.meta.url),
);
const replBrowserShim = fileURLToPath(
    new URL('../core/src/shims/repl-browser.js', import.meta.url),
);

// vite-plugin-node-polyfills rewrites Buffer/process/global inside transformed
// CJS to bare `vite-plugin-node-polyfills/shims/*` specifiers, which pnpm's
// strict layout cannot resolve from xchain-sdk (a `link:` dep outside the
// project root). resolve.alias cannot fix it: the commonjs plugin emits the
// bare id directly.
const shimRequire = createRequire(import.meta.url);
const polyfillShimResolver = {
    name: 'xchain-polyfill-shim-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
        if (source.startsWith('vite-plugin-node-polyfills/shims/')) {
            // Resolve under the ESM ("import"/browser) condition, NOT the CJS
            // one: `require.resolve` picks dist/index.cjs, which has no
            // `default` export and kills the app at boot. Fall back to
            // require.resolve for an older layout shipping no ESM build.
            try {
                return fileURLToPath(import.meta.resolve(source));
            } catch {
                return shimRequire.resolve(source);
            }
        }
        // xchain-sdk/src/repl.js carries a top-level `require.main === module`
        // CLI-entry check that the commonjs transform leaves as a bare
        // `require`, which throws on load in a browser. The wallet never uses
        // the SDK REPL, so route the module to the repl browser shim.
        if (
            /(^|\/)repl\.js$/.test(source)
            && importer && importer.includes('xchain-sdk')
        ) {
            return replBrowserShim;
        }
        return null;
    },
};

// xchain-sdk's musig2.js does `require('@brandonblack/musig/base_crypto')`, a
// subpath esbuild's dep scanner rejects, aborting `vite optimize` and 504-ing
// the SDK in the browser. Resolve the real file from the SDK's own context and
// alias the bare subpath to it below.

// Resolve THROUGH node_modules, never a sibling directory: CI lanes clone only
// this repo, so a relative path above the wallet root has no SDK to find.
// `pnpm run sdk:link` swaps the same node_modules entry for a symlink, so the
// linked tree resolves the musig subpath identically.
const musigBaseCrypto = createRequire(
    createRequire(import.meta.url).resolve('xchain-sdk/package.json'),
).resolve('@brandonblack/musig/base_crypto');

export default defineConfig({
    // xchain-sdk is CJS and pulls in `ws` + Node `crypto` + Buffer at module
    // load: `ws` goes to the browser shim, the rest to
    // vite-plugin-node-polyfills, which costs ~20-30 KB on the SPA bundle.
    resolve: {
        // Array form, not the object form: the surface swaps are regex finds
        // the object form cannot express. Rollup checks entries in order, so
        // the exact-string shims below still match; surface entries are empty
        // in a `default` build.
        alias: [
            ...surfaceAliases,
            { find: 'ws', replacement: wsBrowserShim },
            // xchain-sdk's encoder.js + explorer.js use `new http.Agent`
            // for connection pooling; browser manages its own pool, so
            // our tiny no-op shim avoids pulling in stream-http (~30 KB).
            { find: 'http', replacement: httpBrowserShim },
            // The same client constructors pick `require('https').Agent`
            // whenever the endpoint URL is https (every mainnet default);
            // the externalized `https` module has no Agent, so constructing
            // the real SDK fails without this alias.
            { find: 'https', replacement: httpBrowserShim },
            // repl is loaded transitively via xchain-sdk/index.js →
            // src/repl.js. The wallet never calls startREPL, so the
            // shim throws loudly if anything does.
            { find: 'repl', replacement: replBrowserShim },
            // Point the bare musig subpath at its real file (see note above).
            { find: '@brandonblack/musig/base_crypto', replacement: musigBaseCrypto },
        ],
    },
    // xchain-sdk is a `link:` dep resolving OUTSIDE this root, so Vite does not
    // treat it as a normal CJS package: its inner `require()` calls survive and
    // throw in a browser unless the dep optimizer does the CJS -> ESM
    // transform. DEV SERVER only; prod is build.commonjsOptions +
    // polyfillShimResolver (G163).

    // GATED on VITE_XCHAIN_REAL_SDK=1: pre-bundling the real SDK
    // unconditionally makes the app talk to a live backend at boot, and wallet
    // creation HANGS when none is reachable (the default for dev and the e2e
    // suite).

    // `exclude` is the other half of that gate: Vite's dep SCANNER finds the
    // bare `import('xchain-sdk')` in src/sdkFactory.js and pre-bundles it
    // whatever `include` says, so naming it here keeps the flag the ONLY
    // decider. src/sdkFactory.js picks the venue off the same flag, so the
    // halves agree.

    // The DEEP entry sits in BOTH branches, outside that gate: Vite pre-bundles
    // per ENTRY and a linked package is source, so listing the package alone
    // serves `xchain-sdk/src/wallet.js` raw as CJS and it throws at module
    // eval. It carries only WalletUtils, never an explorer or encoder client.
    optimizeDeps: process.env.VITE_XCHAIN_REAL_SDK === '1'
        ? { include: ['xchain-sdk', 'xchain-sdk/src/wallet.js'] }
        : { include: ['xchain-sdk/src/wallet.js'], exclude: ['xchain-sdk'] },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        // Sourcemaps cost the HOSTED shell a lazy fetch nobody makes without
        // DevTools, but a store build SHIPS them: `cap sync` copies all of
        // `dist/` into the app bundle, ~5x-ing the payload for a debugging aid
        // no store build can use (Web Inspector is off in Release, §4).
        sourcemap: BUILD_PROFILE !== 'store',
        // Prod half of G163: Rollup's commonjs pass defaults to /node_modules/
        // only, and the `link:`-resolved xchain-sdk lives outside every such
        // dir, so it needs naming here to get the same CJS -> ESM treatment.
        // polyfillShimResolver above resolves the shim ids this transform
        // emits.
        commonjsOptions: {
            include: [/node_modules/, /xchain-sdk/],
            transformMixedEsModules: true,
        },
    },
    server: {
        port: 5173,
        host: '0.0.0.0',
        // Vite blocks unlisted Host headers, so a LAN dev host needs naming via
        // VITE_DEV_ALLOWED_HOST. Reach it over HTTPS (VITE_HTTPS=1) so the
        // non-localhost origin is still a secure context for crypto.subtle.
        allowedHosts: devAllowedHost ? ['localhost', '127.0.0.1', devAllowedHost] : ['localhost', '127.0.0.1'],
    },
    preview: {
        port: 4173,
        host: '0.0.0.0',
        allowedHosts: devAllowedHost ? ['localhost', '127.0.0.1', devAllowedHost] : ['localhost', '127.0.0.1'],
    },
    plugins: [
        polyfillShimResolver,
        react(),
        ...(httpsEnabled ? [basicSsl()] : []),
        nodePolyfills({
            include: ['buffer', 'process', 'crypto', 'events', 'stream', 'util'],
            globals: { Buffer: true, process: true, global: true },
            protocolImports: true,
        }),
        styleGuidePlugin,
        surfaceGuardPlugin,
        regtestSidecarPlugin(BUILD_PROFILE),
        cspPlugin,
        // Last: must see the final tag set + final bundle bytes.
        sriPlugin(),
    ],
});
