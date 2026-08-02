// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  D6: every origin a harness expects `window.xchain` on is
// actually covered by the manifest's content-script match patterns.
//
// This closes a lesson the spec wrote down and nothing enforced. D6 narrowed
// the content-script matches from `http(s)://*/*` to `https://*/*` plus
// loopback, which was the right call and was taken at the only free moment
// (widening later triggers CWS re-review and can disable the extension for
// installed users). It also silently broke
// `test/e2e/tests/cosigner/cosign-approval.extension.spec.js`, whose dApp
// origin was `http://xchain-cosign-e2e.test`: a plain-HTTP origin that is
// neither localhost nor 127.0.0.1, so the content script stopped running
// there, `window.xchain` never appeared, and the spec timed out looking like
// a wallet bug. Its own comment said so.
//
// Every gate stayed green through it. `npm run ci` is unit + integration +
// security + fuzz + smoke and does NOT include e2e, and only the extension
// e2e project exercises provider injection at all. The manifest-freeze gate
// does not help either: it stops an ACCIDENTAL manifest edit, and a
// deliberate scope change updates `manifest-freeze.json` in the same commit.
//
// So the spec §8.6 lesson was "a `matches` edit cannot be validated by the CI
// gate" - written as prose, addressed to whoever changes the matches next.
// This whole item has been one long demonstration that prose does not hold.
// The part that actually broke is checkable without running an e2e at all:
// it is origin coverage, and match patterns are a small, total function.
//
// Two rules:
//   A. Code. Every dApp origin an extension harness navigates to or
//      intercepts must be matched by the manifest's content-script patterns.
//   B. Docs. TEST_DAPP_RUNBOOK.md must quote the manifest's match list rather
//      than describe it. It said "any page served over http/https" for two
//      days after D6, and the staleness was invisible because its own worked
//      example uses loopback, which is still exempt.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const MANIFEST = 'packages/extension/manifest.json';
const RUNBOOK = 'packages/extension/docs/TEST_DAPP_RUNBOOK.md';
const E2E_DIR = 'test/e2e/tests';
const EXTRA_HARNESSES = ['packages/extension/scripts/capture-listing-screenshots.mjs'];

const manifest = JSON.parse(read(MANIFEST));
const patterns = [...new Set(manifest.content_scripts.flatMap((c) => c.matches))];

// ---------------------------------------------------------------------------
// Chrome match-pattern semantics, implemented rather than approximated
// ---------------------------------------------------------------------------

// The subtlety that makes a regex approximation wrong: a match pattern's host
// part cannot carry a port, and patterns match regardless of the URL's port.
// `http://localhost/*` matches `http://localhost:5500/`, so the comparison has
// to be against URL.hostname, never against the authority string.
const globToRe = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

function matchPattern(pattern, urlString) {
    const m = pattern.match(/^(\*|https?):\/\/([^/]*)(\/.*)$/);
    assert.ok(m, `${MANIFEST} has a content-script match pattern this smoke cannot parse: ${pattern}`);
    const [, scheme, host, path] = m;

    let url;
    try {
        url = new URL(urlString);
    } catch {
        return false;
    }

    const urlScheme = url.protocol.replace(/:$/, '');
    if (scheme === '*') {
        if (urlScheme !== 'http' && urlScheme !== 'https') return false;
    } else if (urlScheme !== scheme) {
        return false;
    }

    if (host !== '*') {
        if (host.startsWith('*.')) {
            const bare = host.slice(2);
            if (url.hostname !== bare && !url.hostname.endsWith(`.${bare}`)) return false;
        } else if (url.hostname !== host) {
            return false;
        }
    }

    return globToRe(path).test(url.pathname || '/');
}

const matchesAny = (patternList, urlString) => patternList.some((p) => matchPattern(p, urlString));

// Self-test the matcher before trusting it, against a FIXTURE rather than
// against the live manifest. A matcher that answers "yes" to everything would
// make every check below pass, which is the failure mode a hand-rolled pattern
// implementation actually has, so these have to be real assertions.
//
// The fixture matters: an earlier cut ran these against `patterns`, which
// quietly baked today's narrow policy into what is supposed to test the
// implementation. Found by mutation - widening the manifest then failed with
// "matcher: plain-HTTP non-loopback is NOT injected", which reads as a broken
// matcher when the real story is a scope change that rule B should report. A
// legitimate future widening is now rule B's to report, in its own words.
const FIXTURE = ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];
assert.ok(matchesAny(FIXTURE, 'https://example.com/'), 'matcher: https is matched');
assert.ok(matchesAny(FIXTURE, 'http://localhost:5500/index.html'), 'matcher: loopback ignores the port');
assert.ok(matchesAny(FIXTURE, 'http://127.0.0.1/'), 'matcher: 127.0.0.1 is matched');
assert.ok(!matchesAny(FIXTURE, 'http://example.com/'), 'matcher: plain-HTTP non-loopback is not matched');
assert.ok(!matchesAny(FIXTURE, 'http://192.168.1.5:5500/'), 'matcher: a LAN address is not matched');
assert.ok(!matchesAny(FIXTURE, 'http://xchain-cosign-e2e.test/'), 'matcher: the exact origin D6 broke is not matched');
assert.ok(!matchesAny(FIXTURE, 'ftp://example.com/'), 'matcher: a foreign scheme is not matched');
assert.ok(matchesAny(['*://*/*'], 'http://example.com/'), 'matcher: the `*` scheme covers http');
assert.ok(matchesAny(['https://*.example.com/*'], 'https://a.example.com/x'), 'matcher: a subdomain wildcard matches');
assert.ok(!matchesAny(['https://*.example.com/*'], 'https://notexample.com/'), 'matcher: a subdomain wildcard is not a suffix match');

const injectsInto = (urlString) => matchesAny(patterns, urlString);

// ---------------------------------------------------------------------------
// Rule A: every origin a harness drives the provider on
// ---------------------------------------------------------------------------

function* walk(dir) {
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) yield* walk(full);
        else yield full;
    }
}

const harnesses = [
    ...[...walk(join(root, E2E_DIR))]
        .filter((f) => f.endsWith('.extension.spec.js'))
        .map((f) => relative(root, f)),
    ...EXTRA_HARNESSES.filter((p) => existsSync(join(root, p))),
];

assert.ok(harnesses.length >= 4,
    `only ${harnesses.length} extension harnesses were found under ${E2E_DIR}; expected at least 4. `
    + 'The discovery glob stopped matching and every check below is now vacuous.');

// Comments are stripped first: the licence header carries https://dankest.llc,
// and the specs quote match patterns in prose while explaining D6. Neither is
// an origin anything navigates to, and a check that fires on correct writing
// is one people delete.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// An origin counts when a harness treats it as a place: a `*ORIGIN` constant,
// or a literal handed to Playwright's goto()/route(). That is narrower than
// "every URL in the file", which would catch the SVG namespace URI in the
// screenshot script and be wrong about it.
const ORIGIN_CONST = /\b(?:const|let|var)\s+([A-Za-z0-9_]*ORIGIN)\s*=\s*['"`]([^'"`]+)['"`]/g;
const NAVIGATION = /\.(?:goto|route)\(\s*['"`]([^'"`$]+)['"`]/g;

const uncovered = [];
const found = [];

for (const rel of harnesses) {
    const text = stripComments(read(rel));
    const candidates = [
        ...[...text.matchAll(ORIGIN_CONST)].map((m) => ({ what: m[1], url: m[2] })),
        ...[...text.matchAll(NAVIGATION)].map((m) => ({ what: 'goto/route', url: m[1] })),
    ];
    for (const { what, url } of candidates) {
        if (url.startsWith('chrome-extension://')) continue;   // the extension's own pages
        if (!/^https?:\/\//.test(url)) continue;               // relative paths, data: URLs
        found.push(`${rel}: ${url}`);
        if (!injectsInto(url)) uncovered.push(`${rel} drives ${what} at ${url}`);
    }
}

assert.ok(found.length >= 2,
    `only ${found.length} provider origins were extracted from ${harnesses.length} harnesses; expected at `
    + 'least 2. The extraction stopped matching, so this smoke would pass on an empty set.');

assert.deepEqual(uncovered, [],
    'an extension harness drives the injected provider at an origin the content script does not match, so '
    + '`window.xchain` will never appear there and the harness will fail looking like a wallet bug. This is '
    + `exactly what  D6 did to the co-sign spec. Manifest matches: ${patterns.join(', ')}. `
    + 'Move the harness origin (https needs no TLS when the harness fulfils the route itself), do not widen '
    + 'the manifest: widening triggers CWS re-review and can disable the extension for installed users.');

// ---------------------------------------------------------------------------
// Rule B: the test-dApp runbook quotes the manifest instead of describing it
// ---------------------------------------------------------------------------

const runbook = read(RUNBOOK);
const fence = runbook.match(/```\n((?:https?:\/\/[^\n]*\n)+)```/);
assert.ok(fence,
    `${RUNBOOK} must quote the content-script match patterns in a fenced block, so the "where does the `
    + 'provider get injected" claim is copied from the manifest rather than described from memory.');

const quoted = fence[1].trim().split('\n').map((l) => l.trim()).filter(Boolean).sort();
assert.deepEqual(quoted, [...patterns].sort(),
    `${RUNBOOK} quotes a content-script match list the manifest does not have.\n`
    + `  quoted:   ${quoted.join(', ')}\n`
    + `  manifest: ${[...patterns].sort().join(', ')}\n`
    + 'This runbook is what an operator follows to satisfy the §4 rollout exit criteria, which require '
    + 'driving connect and sign from a store-installed build on at least two machines. A stale scope claim '
    + 'here sends them to a LAN address where the provider never injects.');

// The trap only exists because loopback stayed exempt, which is what made the
// stale claim invisible. Say so where the operator reads it.
assert.ok(/192\.168|LAN/.test(runbook),
    `${RUNBOOK} must warn that a LAN address is not loopback and gets no provider. The runbook's own `
    + 'worked example uses localhost, which still works, so nothing else surfaces the hazard.');

console.log(`OK: extension provider-origins smoke ( D6: ${found.length} harness origins across `
    + `${harnesses.length} harnesses all covered by ${patterns.length} manifest match patterns, `
    + 'test-dApp runbook quoting the manifest)');
