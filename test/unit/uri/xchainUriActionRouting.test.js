// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §3.6 finding 2: an unrecognized action segment silently becomes a
// send. `parseXchainUri` treats any coin-code action outside the receive /
// execute sets as `kind: 'send'`, preserving the literal in `intent.action`
// (xchainUri.js §"Actions that map to..."). `xchain:BTC/drainwallet?...`
// and `xchain:BTC/approve?...` both route to the Send compose form.
//
// This is deliberate, documented forward-compatibility (a typo'd or
// future action segment still opens a form instead of dead-ending the
// link), and it is safe today for one reason only: every shell routes on
// `intent.kind`, never on `intent.action`. Grepping every consumer
// (extension/web/desktop App.jsx, ScanRoute, Send, xchainUri.js itself)
// found no such route - `intent.action` is read in exactly two places,
// both inside xchainUri.js: a doc comment, and `buildXchainUri`, which
// reads it to pick which path segment to WRITE into an outgoing link the
// wallet generates, not to route an incoming one.
//
// That makes "nothing routes on action" a fact about the tree today, not
// a property of the parser, so it can only be locked by watching the
// tree: the day a screen adds `if (intent.action === 'drainwallet')` (or
// reads `.action` off anything built from a parsed URI intent under any
// other name), a typo'd or attacker-chosen action segment becomes
// reachable there, and this test is what says so.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..', '..', 'packages');

// The one file allowed to read `intent.action`: it defines the field, and
// its own `buildXchainUri` reads it back to serialize an outgoing link,
// which is not a routing decision.
const PARSER_FILE = join(PACKAGES, 'core', 'src', 'uri', 'xchainUri.js');

const SKIP_DIR = new Set(['node_modules', 'dist', 'coverage', '.git']);

// Each shell's own hand-written source, not its vendored/built output:
// `packages/mobile` ships no source of its own (Capacitor wraps `web`'s
// build), and `packages/desktop/build` plus every package's own build
// artifacts are generated, so a walk rooted here never has to distinguish
// hand-written code from a checked-in bundle that happens to contain the
// same bytes by coincidence.
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
        if (st.isDirectory()) {
            walk(full, out);
        } else if (/\.(js|jsx)$/.test(entry) && !/\.(test|fuzz)\./.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

// The literal variable-naming convention every current call site uses for
// a parsed URI intent (`const intent = parseXchainUri(...)` /
// `hardenUriIntentText(parseXchainUri(...))`), confirmed by grep across
// extension/web/desktop/core before this test was written. Narrow on
// purpose: a broad `\.action\b` sweep hits ~50 unrelated files (PSBT
// decode's own `.action`, form `action` attributes, etc.) and would be
// noise, not signal.
const INTENT_ACTION_RE = /intent(?:\.action\b|\[['"]action['"]\])/;

function sourceFiles() {
    const out = [];
    for (const root of ROOTS) walk(root, out);
    return out;
}

describe('§3.6 invariant: shells route a parsed URI intent on `kind`, never on `action`', () => {
    const files = sourceFiles();

    it('finds source files to sweep (guards against an empty walk)', () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it('the parser file is exactly where `intent.action` is expected (sweep sanity check)', () => {
        const src = readFileSync(PARSER_FILE, 'utf8');
        expect(INTENT_ACTION_RE.test(src)).toBe(true);
    });

    it('no other file reads `intent.action`', () => {
        const offenders = [];
        for (const file of files) {
            if (file === PARSER_FILE) continue;
            const src = readFileSync(file, 'utf8');
            if (INTENT_ACTION_RE.test(src)) offenders.push(relative(PACKAGES, file));
        }
        expect(
            offenders,
            `${offenders.join(', ')} reads intent.action. A parsed URI intent must only ever be routed `
            + 'on `kind` (send/receive/execute/unknown); `action` preserves the literal path segment for '
            + 'forward compatibility and carries no gate on its value (xchain:BTC/drainwallet routes to '
            + '"send" today only because nothing reads .action). If this file needs the action segment, '
            + 'route on `kind` and treat `action` as display-only text, never as a value a screen branches on.',
        ).toEqual([]);
    });
});
