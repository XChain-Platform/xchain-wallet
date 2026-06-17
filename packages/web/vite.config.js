// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vite build for the web SPA shell — §9.5 / §51.
//
// Single-page React app served out of `packages/web/dist/`. The entry
// HTML (`index.html`) points at `src/main.jsx`; Vite resolves
// @xchain-wallet/core (+ its branding tokens via
// `new URL('./images/…', import.meta.url)`) and the extension package
// for the shared `createBackgroundHost` factory.
//
// Scope note (web vs extension): the web SPA builds its own in-page
// MessageHost rather than dispatching messages over chrome.runtime —
// see `src/hostBridge.js`. The createBackgroundHost import is the one
// piece of intentional cross-shell reuse; a later refactor extracts
// host wiring to a lower-level package once a third shell appears.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { CONTENT_SECURITY_POLICY } from './src/csp.js';
// HTTPS is OPT-IN via the `VITE_HTTPS=1` env var. The wallet's crypto
// surfaces (`crypto.subtle.*` for KDF + AEAD, `navigator.clipboard.*`,
// `getUserMedia` for the camera scanner, WebUSB / WebHID for hardware
// signers) require a secure context — `localhost` qualifies natively,
// so plain HTTP is fine when someone hits the wallet directly on the
// machine that's serving it. For LAN / VM-hostname access, set
// VITE_HTTPS=1 and `@vitejs/plugin-basic-ssl` generates a self-signed
// cert. The wallet also surfaces an in-app banner when it detects an
// insecure context, so the page never silently breaks.
import basicSsl from '@vitejs/plugin-basic-ssl';

const httpsEnabled = process.env.VITE_HTTPS === '1' || process.env.HTTPS === '1';

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
// script-src would break — and dev is not the deployed threat surface. The
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
                    content: CONTENT_SECURITY_POLICY,
                },
                injectTo: 'head-prepend',
            },
        ];
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

// xchain-sdk's musig2.js does `require('@brandonblack/musig/base_crypto')`.
// Node resolves that subpath to lib/base_crypto.js, but esbuild's dep
// scanner rejects the package's exports map and aborts `vite optimize`,
// which would 504 the SDK in the browser. Resolve the real file from the
// SDK's own context (works on Mac and the VM share alike) and alias the
// bare subpath to it below.
const musigBaseCrypto = createRequire(
    fileURLToPath(new URL('../../../xchain-sdk/package.json', import.meta.url)),
).resolve('@brandonblack/musig/base_crypto');

export default defineConfig({
    // xchain-sdk is CJS and pulls in `ws` + Node `crypto` + Buffer at
    // module load. `ws` is aliased to our browser shim
    // (packages/core/src/shims/ws-browser.js); `crypto`/Buffer/process/
    // stream/events are polyfilled by vite-plugin-node-polyfills. The
    // polyfills add ~20-30 KB to the SPA bundle — acceptable for a
    // wallet that needs to sign PSBTs + talk to the explorer.
    resolve: {
        alias: {
            ws: wsBrowserShim,
            // xchain-sdk's encoder.js + explorer.js use `new http.Agent`
            // for connection pooling — browser manages its own pool, so
            // our tiny no-op shim avoids pulling in stream-http (~30 KB).
            http: httpBrowserShim,
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
        sourcemap: true,
    },
    server: {
        port: 5173,
        host: '0.0.0.0',
        allowedHosts: ['devhost', 'localhost', '127.0.0.1'],
    },
    preview: {
        port: 4173,
        host: '0.0.0.0',
        allowedHosts: ['devhost', 'localhost', '127.0.0.1'],
    },
    plugins: [
        react(),
        ...(httpsEnabled ? [basicSsl()] : []),
        nodePolyfills({
            include: ['buffer', 'process', 'crypto', 'events', 'stream', 'util'],
            globals: { Buffer: true, process: true, global: true },
            protocolImports: true,
        }),
        styleGuidePlugin,
        cspPlugin,
    ],
});
