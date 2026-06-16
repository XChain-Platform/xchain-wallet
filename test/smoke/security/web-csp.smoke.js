// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §9.5 / §51 — the web SPA ships an app-controlled CSP.
//
// The SPA previously had no Content-Security-Policy of its own and relied
// entirely on a server-sent header. This checks the policy module defines
// the XSS-defining directives correctly and that vite.config.js injects it
// into the production build (and only the build, so dev HMR still works).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_SECURITY_POLICY, cspMetaTag } from '../../../packages/web/src/csp.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const viteConfigPath = join(wsRoot, 'packages', 'web', 'vite.config.js');
const viteSrc = readFileSync(viteConfigPath, 'utf8');

// --- 1. The policy locks down the XSS-defining directives ----------------

assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/, "default-src is 'self'");
assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/, "script-src is 'self'");
assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/, "object-src is 'none'");
assert.match(CONTENT_SECURITY_POLICY, /base-uri 'none'/, "base-uri is 'none'");
assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/, "frame-ancestors is 'none'");

// No script-side code-injection escape hatches.
assert.doesNotMatch(
    CONTENT_SECURITY_POLICY,
    /script-src[^;]*'unsafe-inline'/,
    'script-src must not allow unsafe-inline',
);
assert.doesNotMatch(
    CONTENT_SECURITY_POLICY,
    /'unsafe-eval'/,
    'no unsafe-eval anywhere (argon2id is pure JS, no wasm-unsafe-eval needed)',
);

// --- 2. The meta-tag helper wraps the policy -----------------------------

assert.match(cspMetaTag(), /^<meta http-equiv="Content-Security-Policy" content="/, 'meta tag is well-formed');
assert.ok(cspMetaTag().includes(CONTENT_SECURITY_POLICY), 'meta tag embeds the full policy');

// --- 3. vite.config wires the injector, build-only -----------------------

assert.match(viteSrc, /import \{ CONTENT_SECURITY_POLICY \} from '\.\/src\/csp\.js'/, 'vite imports the policy');
assert.match(viteSrc, /name: 'xchain-csp'/, 'defines the csp plugin');
assert.match(viteSrc, /apply: 'build'/, 'csp plugin is build-only (dev HMR untouched)');
assert.match(viteSrc, /transformIndexHtml\(\)/, 'csp plugin injects via transformIndexHtml');
assert.match(viteSrc, /'http-equiv': 'Content-Security-Policy'/, 'injects the CSP meta tag');

// The plugin must actually be registered in the plugins array.
assert.match(viteSrc, /styleGuidePlugin,\s*\n\s*cspPlugin,/, 'cspPlugin is registered in plugins');

console.log('web-csp smoke OK');
