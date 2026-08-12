// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §3.6 finding 1, adoption guard.
//
// `hardenUriIntentText` neutralizes the free-text fields of a parsed URI
// intent (memo / tick / EXECUTE method + params / label / message) before
// they reach form state, because a deep link is attacker-supplied and a
// bidi override or control character in one of those fields reaches a
// signing surface. `parseXchainUri` deliberately stays a pure parser and
// does NOT harden its own output, so hardening is a second call the
// consumer has to make.
//
// That split is the right shape (the parser stays total and round-trips
// with `buildXchainUri`, and a caller that genuinely needs the raw value
// can still have it) but it buys that at the cost of being opt-in, and an
// opt-in security step is one a new consumer forgets. This test converts
// forgetting into a test failure: every file that CALLS the parser must
// also reference the hardener.
//
// It found a real one when it was written. `packages/desktop/main/
// protocol.js` classifies an OS-supplied `xchain:` URI and forwards the
// intent to the renderer over IPC without hardening it. No live gap,
// since the renderer has no listener for that event yet, which is exactly
// how this class of hole stays invisible until someone wires the last
// piece up and inherits it.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..', '..', 'packages');

// The file that DEFINES both functions. Its `export function
// parseXchainUri(` matches the call regex below, and it is the one place
// that legitimately has the parser without the hardener beside it.
const PARSER_FILE = join(PACKAGES, 'core', 'src', 'uri', 'xchainUri.js');

const SKIP_DIR = new Set(['node_modules', 'dist', 'coverage', '.git']);

// Each shell's hand-written source, mirroring the roots the sibling
// `xchainUriActionRouting` sweep uses so the two invariants cover the
// same tree.
const ROOTS = [
    join(PACKAGES, 'core', 'src'),
    join(PACKAGES, 'extension', 'src'),
    join(PACKAGES, 'web', 'src'),
    join(PACKAGES, 'desktop', 'main'),
    join(PACKAGES, 'desktop', 'renderer'),
    join(PACKAGES, 'signers-ledger', 'src'),
    join(PACKAGES, 'signers-trezor', 'src'),
    join(PACKAGES, 'test-dapp', 'src'),
    join(PACKAGES, 'bridge-spec', 'src'),
];

function walk(dir, out) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIR.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (/\.(js|jsx)$/.test(entry) && !/\.(test|fuzz)\./.test(entry)) out.push(full);
    }
    return out;
}

// A CALL, not a mention. The trailing paren is what distinguishes an
// actual invocation from `uri/index.js`'s bare re-export and from
// `coinCodes.js`'s doc comment naming the function in prose, neither of
// which needs to harden anything.
const PARSE_CALL_RE = /parseXchainUri\s*\(/;
const HARDEN_RE = /hardenUriIntentText/;

function sourceFiles() {
    const out = [];
    for (const root of ROOTS) walk(root, out);
    return out;
}

describe('Every parseXchainUri call site also hardens the intent', () => {
    const files = sourceFiles();

    it('finds source files to sweep (guards against an empty walk)', () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it('the sweep actually finds call sites (guards against a regex that matches nothing)', () => {
        const callers = files.filter((f) => f !== PARSER_FILE
            && PARSE_CALL_RE.test(readFileSync(f, 'utf8')));
        expect(callers.length).toBeGreaterThan(0);
    });

    it('no call site parses without hardening', () => {
        const offenders = [];
        for (const file of files) {
            if (file === PARSER_FILE) continue;
            const src = readFileSync(file, 'utf8');
            if (PARSE_CALL_RE.test(src) && !HARDEN_RE.test(src)) offenders.push(relative(PACKAGES, file));
        }
        expect(
            offenders,
            `${offenders.join(', ')} calls parseXchainUri without hardenUriIntentText. A parsed URI intent `
            + 'carries attacker-supplied free text (memo, tick, EXECUTE method and params) straight to a '
            + 'signing surface; wrap the parse as hardenUriIntentText(parseXchainUri(...)) before the intent '
            + 'reaches screen state or crosses a process boundary. If this call site genuinely needs the raw '
            + 'value (re-serializing a link, comparing against the original string), say so in a comment '
            + 'naming why, and add the file to this test with that reason.',
        ).toEqual([]);
    });
});
