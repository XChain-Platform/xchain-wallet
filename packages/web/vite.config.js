// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vite build for the web SPA shell (§9.5 / §51).
//
// Single-page React app served out of `packages/web/dist/`. The entry
// HTML (`index.html`) points at `src/main.jsx`; Vite resolves
// @xchain-wallet/core (+ its branding tokens via
// `new URL('./images/…', import.meta.url)`) and the extension package
// for the shared `createBackgroundHost` factory.
//
// Scope note (web vs extension): the web SPA builds its own in-page
// MessageHost rather than dispatching messages over chrome.runtime;
// see `src/hostBridge.js`. The createBackgroundHost import is the one
// piece of intentional cross-shell reuse; a later refactor extracts
// host wiring to a lower-level package once a third shell appears.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { contentSecurityPolicyFor } from './src/csp.js';
// Which feature set this build carries. Resolved once,
// here, so the CSP and the stamp written into the dist cannot disagree.
import { PROFILE_STAMP_FILE, profileStampFor, resolveBuildProfile } from './buildProfile.js';
// Which SURFACES this profile carries. The registry is data; the two
// pieces below are the mechanism that acts on it.
import { SURFACE_MODULES, hiddenSurfacesFor } from './src/surfaces/registry.js';
// Keep the SDK's regtest full-node sidecar (a Node-only dev path, and the
// `fullnode.regtest.json` literal beside it) out of a `store` bundle. Inert in
// every other profile; fails the build shut if a marker survives. .
import { regtestSidecarPlugin } from './regtestSidecar.js';

const BUILD_PROFILE = resolveBuildProfile();
const HIDDEN_SURFACES = hiddenSurfacesFor(BUILD_PROFILE);

// Swap each hidden surface's module for its inert twin, so the surface's route
// Components are never imported and never reach the bundle (the
// store-hidden surfaces are COMPILED OUT, not switched off - a surface that can
// be switched back on is a guideline 2.3.1 hidden feature). The regex covers the
// whole specifier so the replacement is the absolute path, not a suffix graft,
// and it matches from any importer's relative depth.
const surfaceAliases = HIDDEN_SURFACES.map((surface) => ({
    find: new RegExp(`^(?:.*/)?surfaces/${surface}\\.jsx$`),
    replacement: fileURLToPath(
        new URL(`./src/surfaces/${surface}.hidden.jsx`, import.meta.url),
    ),
}));

// FAIL SHUT if a hidden surface's code gets into the graph anyway.
//
// The alias only helps as long as the surface module is the ONLY importer of
// those route components. A second import added anywhere (a shared index, a
// lazy route, a helper reaching for one component) would put the whole surface
// back into a `store` bundle while every label still said it was absent - a
// false claim inside a signed manifest, which the compile-out exists to prevent. So the
// build refuses rather than shipping it, and says which module and which
// importer did it.
const surfaceGuardPlugin = {
    name: 'xchain-hidden-surface-guard',
    // MUST be 'pre'. A 'post' plugin's resolveId never runs: Vite's own
    // resolver answers first and the first non-null answer wins, so the guard
    // silently passed everything (measured - it let a deliberate second import
    // of MarketsList straight through). 'pre' runs first, and `this.resolve`
    // with skipSelf hands the work to the normal chain and inspects the answer.
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
// HTTPS is OPT-IN via the `VITE_HTTPS=1` env var. The wallet's crypto
// surfaces (`crypto.subtle.*` for KDF + AEAD, `navigator.clipboard.*`,
// `getUserMedia` for the camera scanner, WebUSB / WebHID for hardware
// signers) require a secure context; `localhost` qualifies natively,
// so plain HTTP is fine when someone hits the wallet directly on the
// machine that's serving it. For LAN / VM-hostname access, set
// VITE_HTTPS=1 and `@vitejs/plugin-basic-ssl` generates a self-signed
// cert. The wallet also surfaces an in-app banner when it detects an
// insecure context, so the page never silently breaks.
import basicSsl from '@vitejs/plugin-basic-ssl';

const httpsEnabled = process.env.VITE_HTTPS === '1' || process.env.HTTPS === '1';
// Extra Host header to allow when demoing the dev server over a LAN, since
// Vite otherwise rejects any Host it doesn't recognize.
const devAllowedHost = process.env.VITE_DEV_ALLOWED_HOST || null;

// Dev-only convenience: rewrite a bare `/style-guide` to `/style-guide/`
// so Vite picks up the multi-page entry at packages/web/style-guide/
// index.html. Without the trailing slash, Vite's static-asset middleware
// returns 404. Attached to both dev + preview servers; production builds
// don't include this rewrite (the style-guide page is dev-time only).
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
// index.html. Build-only (`apply: 'build'`): the dev server relies on inline
// scripts + eval + a websocket back to Vite for HMR, which a strict
// script-src would break; dev is not the deployed threat surface. The
// production bundle that ships to wallet.xchain.io carries the policy so it
// no longer depends on a server header someone has to remember to set.
const cspPlugin = {
    name: 'xchain-csp',
    apply: 'build',
    transformIndexHtml() {
        return [
            {
                tag: 'meta',
                attrs: {
                    'http-equiv': 'Content-Security-Policy',
                    // Profile-aware: the mobile store build drops the
                    // Trezor origins, which no WebView can reach anyway, rather
                    // than shipping a permanently-allowed remote script origin
                    // for a feature it does not have.
                    content: contentSecurityPolicyFor(BUILD_PROFILE),
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
    // `packages/mobile` copies this dist VERBATIM rather than compiling its
    // own, so the profile has to travel INSIDE the bundle. Without it there is
    // nothing to stop a `default` bundle being wrapped in a store artifact and
    // labelled `store` in a signed manifest.
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

// Vite-plugin-node-polyfills rewrites Buffer/process/global
// references inside transformed CJS to bare
// `vite-plugin-node-polyfills/shims/*` specifiers. Those resolve fine for
// packages under this project's node_modules, but xchain-sdk is a `link:`
// dep living OUTSIDE the project root, and pnpm's strict node_modules
// layout cannot resolve the plugin package from the SDK's directory. That
// unresolvable specifier is what sank the build.commonjsOptions route the
// first time. Resolve the shims to absolute paths from THIS package's
// context and hand them to Rollup before its node-resolve runs.
// (resolve.alias does not help here: the commonjs plugin emits the bare id
// directly, bypassing the alias step.)
const shimRequire = createRequire(import.meta.url);
const polyfillShimResolver = {
    name: 'xchain-polyfill-shim-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
        if (source.startsWith('vite-plugin-node-polyfills/shims/')) {
            // Resolve under the ESM ("import"/browser) condition, NOT the
            // CJS one. `require.resolve` picks the exports map's "require"
            // branch -> dist/index.cjs, which Vite then serves raw over
            // /@fs/ in dev; it has no `default` export, so the app died at
            // boot with a blank page ("does not provide an export named
            // 'default'"). The package ships an ESM build alongside it
            // (exports.import -> dist/index.js) and that is what a browser
            // bundle wants. Falls back to require.resolve so an older
            // layout without the ESM build still resolves.
            try {
                return fileURLToPath(import.meta.resolve(source));
            } catch {
                return shimRequire.resolve(source);
            }
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

// xchain-sdk's musig2.js does `require('@brandonblack/musig/base_crypto')`.
// Node resolves that subpath to lib/base_crypto.js, but esbuild's dep
// scanner rejects the package's exports map and aborts `vite optimize`,
// which would 504 the SDK in the browser. Resolve the real file from the
// SDK's own context and alias the bare subpath to it below.
//
// RESOLVED THROUGH node_modules, NOT through a sibling directory.
// This read `../../../xchain-sdk/package.json`, a path three levels above
// the wallet root, so a build needed the SDK checked out beside the wallet
// and every CI lane died here: `release.yml` clones only this repo. The
// dependency is now a registry install, so the SDK is an ordinary package
// and `require.resolve` finds it wherever the installer put it - including
// under `pnpm run sdk:link`, which swaps the same node_modules entry for a
// symlink and therefore keeps resolving the musig subpath from the linked
// tree exactly as before.
const musigBaseCrypto = createRequire(
    createRequire(import.meta.url).resolve('xchain-sdk/package.json'),
).resolve('@brandonblack/musig/base_crypto');

export default defineConfig({
    // xchain-sdk is CJS and pulls in `ws` + Node `crypto` + Buffer at
    // module load. `ws` is aliased to our browser shim
    // (packages/core/src/shims/ws-browser.js); `crypto`/Buffer/process/
    // stream/events are polyfilled by vite-plugin-node-polyfills. The
    // polyfills add ~20-30 KB to the SPA bundle; acceptable for a
    // wallet that needs to sign PSBTs + talk to the explorer.
    resolve: {
        // Array form (not the object form it used to be): the surface swaps are
        // regex finds, which the object form cannot express. Rollup checks the
        // entries in order, so the exact-string shims below keep behaving as
        // they did; the surface entries are empty in a `default` build.
        alias: [
            ...surfaceAliases,
            { find: 'ws', replacement: wsBrowserShim },
            // xchain-sdk's encoder.js + explorer.js use `new http.Agent`
            // for connection pooling; browser manages its own pool, so
            // our tiny no-op shim avoids pulling in stream-http (~30 KB).
            { find: 'http', replacement: httpBrowserShim },
            // The same client constructors pick
            // `require('https').Agent` whenever the endpoint URL is
            // https (every mainnet default). Without this alias the
            // externalized `https` module has no Agent, so constructing
            // the real SDK threw "Agent is not a constructor" and
            // wallet creation never completed. Same no-op shim: the
            // browser owns the connection pool either way.
            { find: 'https', replacement: httpBrowserShim },
            // repl is loaded transitively via xchain-sdk/index.js →
            // src/repl.js. The wallet never calls startREPL, so the
            // shim throws loudly if anything does.
            { find: 'repl', replacement: replBrowserShim },
            // Point the bare musig subpath at its real file (see note above).
            { find: '@brandonblack/musig/base_crypto', replacement: musigBaseCrypto },
        ],
    },
    // xchain-sdk is a `link:` dependency, so it resolves OUTSIDE this project
    // root and Vite does not treat it like a normal CJS package under
    // node_modules. Left alone, `import('xchain-sdk')` yields a module whose
    // inner `require('./src/XChainSDK.js')` calls survive verbatim; `require`
    // is undefined in a browser, so evaluating it throws. Forcing it into the
    // dep optimizer makes esbuild do the CJS -> ESM transform properly
    // (verified: .vite/deps/xchain-sdk.js is ~5 MB, carries the real decoder +
    // preflight code, and contains zero literal requires). That is G163 /
    // that root cause.
    //
    // NOTE this covers the DEV SERVER only, which is what Playwright drives.
    // The production `vite build` path is handled separately:
    // build.commonjsOptions.include below plus polyfillShimResolver above.
    //
    // GATED: opt in with VITE_XCHAIN_REAL_SDK=1. Unconditionally pre-bundling
    // the real SDK makes the app talk to a live backend at boot, and when none
    // is reachable (the default for dev + the e2e suite) wallet creation HANGS
    // - measured: the send spec passes in 12s on the dev-mock and times out
    // after 7min on the real SDK against a half-configured regtest stack. So
    // the real SDK is opt-in until the wallet degrades gracefully on an
    // unreachable backend (that hang is its own defect).
    //
    // `exclude` is the other half of that gate. Vite's dep SCANNER
    // finds the bare `import('xchain-sdk')` in src/sdkFactory.js on its own and
    // pre-bundles it whether or not it is listed in `include` - which is how
    // the dev shell silently acquired a working real SDK (pointed at mainnet
    // explorers a test browser cannot reach) and five e2e specs went red.
    // Naming it here keeps the flag the ONLY thing that decides. The venue
    // itself is chosen in src/sdkFactory.js off the same flag, so the two
    // halves cannot disagree.
    //
    // The DEEP entry is listed in both branches and is not part of that gate.
    // packages/extension/src/signers/ledgerFactory.js imports
    // `xchain-sdk/src/wallet.js` directly (keeping the SDK index out of
    // the popup graph), and the web shell pulls that module in through
    // createBackgroundHost. Vite pre-bundles per ENTRY, and a linked workspace
    // package is source rather than a dependency, so listing the package alone
    // leaves the deep file served raw over /@fs - CJS, `require` undefined,
    // thrown at module eval, blank page before the app ever mounts. It carries
    // only WalletUtils (pure PSBT helpers), never an explorer or encoder
    // client, so pre-bundling it hands the dev shell no path to a live SDK and
    // the flag above still decides that alone.
    optimizeDeps: process.env.VITE_XCHAIN_REAL_SDK === '1'
        ? { include: ['xchain-sdk', 'xchain-sdk/src/wallet.js'] }
        : { include: ['xchain-sdk/src/wallet.js'], exclude: ['xchain-sdk'] },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        // Sourcemaps are for the HOSTED web shell, where they cost a lazy
        // fetch nobody makes unless DevTools is open. A store build pays for
        // them differently: `cap sync` copies all of `dist/` into the app
        // bundle, so they are not fetched-on-demand, they are SHIPPED. Measured
        // on the iOS store build (2026-08-02): 22 MB of .map in a 27 MB
        // payload, every one carrying `sourcesContent`, so the ipa was ~5x its
        // necessary size to deliver a debugging aid no store build can use -
        // Web Inspector is off in Release (§4).
        //
        // The other two shells already answered this, and answered it the same
        // way: packages/desktop and packages/extension both set sourcemap
        // false. The web shell is the outlier, and the mobile shells inherited
        // the outlier by bundling its output rather than by deciding anything.
        sourcemap: BUILD_PROFILE !== 'store',
        // (prod half of G163): Rollup's commonjs pass defaults to
        // /node_modules/ only, and the `link:`-resolved xchain-sdk lives
        // outside every node_modules dir, so without this include the
        // emitted chunk kept literal require() calls, threw in the browser,
        // and the wallet silently fell back to the dev-mock SDK. Explicitly
        // include the SDK (keeping the node_modules default) so it gets the
        // same CJS -> ESM treatment as any registry dependency. The bare
        // polyfill-shim specifiers this transform surfaces are resolved by
        // polyfillShimResolver above.
        commonjsOptions: {
            include: [/node_modules/, /xchain-sdk/],
            transformMixedEsModules: true,
        },
    },
    server: {
        port: 5173,
        host: '0.0.0.0',
        // Vite blocks unlisted Host headers, so a LAN dev host has to be
        // allowed explicitly; set VITE_DEV_ALLOWED_HOST to demo over the LAN
        // instead of localhost. Reach it over HTTPS (VITE_HTTPS=1) so the
        // non-localhost origin is still a secure context for crypto.subtle
        // (see the secure-context note above).
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
