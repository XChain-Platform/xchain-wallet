// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §9.5 / §51: the web SPA ships an app-controlled CSP.
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

// Parse before asserting. A substring match answers "is this text in there",
// which is the wrong question for a CSP: `object-src 'none' https://evil.example`
// matches /object-src 'none'/ and is not object-src 'none' at all. Every widening
// this file exists to catch is invisible to a substring, so the policy is split
// into a directive -> sources map and each directive compared source-for-source.
const parsePolicy = (policy) => Object.fromEntries(
    policy
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const [name, ...sources] = part.split(/\s+/);
            return [name, sources];
        }),
);

// Written out rather than imported from csp.js: importing the table to check the
// table passes for whatever the table happens to say. This second copy makes a
// widening a two-place edit that shows up as a failing diff.
const EXPECTED_DIRECTIVES = {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://connect.trezor.io'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'frame-src': ["'self'", 'https://connect.trezor.io'],
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

const shipped = parsePolicy(CONTENT_SECURITY_POLICY);

// The directive SET first: a directive silently dropped is a directive that
// falls back to default-src, or (for form-action) to no restriction at all.
assert.deepEqual(
    Object.keys(shipped).sort(),
    Object.keys(EXPECTED_DIRECTIVES).sort(),
    'the shipped policy declares exactly the expected directives, no more and no fewer',
);

for (const [name, sources] of Object.entries(EXPECTED_DIRECTIVES)) {
    assert.deepEqual(
        shipped[name],
        sources,
        `${name} must be exactly [${sources.join(' ')}]; got [${(shipped[name] ?? []).join(' ')}]`,
    );
}

// form-action had no check here of any kind, which is the gap worth naming: a
// policy that forbids injected script but lets an injected <form> POST the
// page's contents to an attacker origin has left open the exfiltration route it
// closed everywhere else.
assert.deepEqual(shipped['form-action'], ["'none'"], "form-action is 'none'");

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

assert.match(
    viteSrc,
    /import \{ contentSecurityPolicyFor \} from '\.\/src\/csp\.js'/,
    'vite imports the policy builder',
);
// The injected policy is the one for THIS build's profile, and the
// profile is resolved once so the meta tag and the stamp written into the dist
// cannot disagree about which build this is.
assert.match(
    viteSrc,
    /const BUILD_PROFILE = resolveBuildProfile\(\)/,
    'vite resolves the build profile once',
);
assert.match(
    viteSrc,
    /content: contentSecurityPolicyFor\(BUILD_PROFILE\)/,
    'the injected CSP is the profile-specific one, not always the default',
);
assert.match(
    viteSrc,
    /fileName: PROFILE_STAMP_FILE/,
    'the built dist carries its profile, since packages/mobile copies it verbatim',
);
assert.match(viteSrc, /name: 'xchain-csp'/, 'defines the csp plugin');
assert.match(viteSrc, /apply: 'build'/, 'csp plugin is build-only (dev HMR untouched)');
assert.match(viteSrc, /transformIndexHtml\(\)/, 'csp plugin injects via transformIndexHtml');
assert.match(viteSrc, /'http-equiv': 'Content-Security-Policy'/, 'injects the CSP meta tag');

// The plugin must actually be registered in the plugins array.
assert.match(viteSrc, /plugins:\s*\[[\s\S]*?\n\s*cspPlugin,/, 'cspPlugin is registered in plugins');

console.log('web-csp smoke OK');
