// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Content-Security-Policy for the web SPA shell (§9.5 / §51).
//
// The wallet caches sensitive material in the page (the session password
// cache, in-page wallet host); its only structural defense against an XSS
// payload exfiltrating that material is a CSP that forbids inline/injected
// script and outbound posts to attacker-controlled origins. Previously the
// SPA shipped none and relied entirely on a server-sent header — which ops
// can forget and which never applies when the bundle is opened from disk
// or served by a misconfigured host. This policy is injected into the
// built index.html (see vite.config.js) so it travels with the app.
//
// Notes on specific directives:
//   - script-src 'self': bundled ES modules only. No 'unsafe-inline' and
//     no 'unsafe-eval' — the crypto stack (@noble/hashes argon2id) is pure
//     JS, so no wasm-unsafe-eval is required.
//   - style-src 'unsafe-inline': the UI uses React inline style attributes
//     (style={{…}}) and runtime-injected <style> tags extensively. Inline
//     styles cannot exfiltrate data, so this is a low-risk allowance.
//   - connect-src is deliberately broad (https:/wss: + localhost): the
//     wallet talks to user-configured explorer/hub/coin-node endpoints
//     that are data, not code, and cannot be enumerated at build time.
//     The XSS-defining directives (script-src/object-src/base-uri) are the
//     load-bearing ones; connect-src is best-effort.
//   - frame-ancestors is set here for defense-in-depth but is IGNORED in a
//     <meta> CSP — the fronting server (Apache) must also send it as a
//     header to actually prevent framing.
//   - img/font allow data: + blob: for QR codes and the favicon.

/** @type {Record<string, string[]>} */
const DIRECTIVES = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
        "'self'",
        'https:',
        'wss:',
        'http://localhost:*',
        'http://127.0.0.1:*',
        'ws://localhost:*',
        'ws://127.0.0.1:*',
    ],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
};

/** The Content-Security-Policy value as a single header/meta string. */
export const CONTENT_SECURITY_POLICY = Object.entries(DIRECTIVES)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');

/** The full `<meta http-equiv="Content-Security-Policy">` tag. */
export function cspMetaTag() {
    return `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`;
}
