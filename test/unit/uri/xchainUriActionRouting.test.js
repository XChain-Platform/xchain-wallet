// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The parser preserves unknown action segments as send-shaped intents for
// generic URI tooling. The external-link router is the sole consumer allowed
// to inspect that segment, and it admits only send, receive, and execute.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..', '..', 'packages');

// The parser defines and serializes the field. The external-link router reads
// it only to reject actions outside its fixed form allowlist.
const PARSER_FILE = join(PACKAGES, 'core', 'src', 'uri', 'xchainUri.js');
const EXTERNAL_ROUTER_FILE = join(PACKAGES, 'desktop', 'renderer', 'deepLinkRoute.js');

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

describe('§3.6 invariant: only the external-link boundary gates `intent.action`', () => {
    const files = sourceFiles();

    it('finds source files to sweep (guards against an empty walk)', () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it('the parser file is exactly where `intent.action` is expected (sweep sanity check)', () => {
        const src = readFileSync(PARSER_FILE, 'utf8');
        expect(INTENT_ACTION_RE.test(src)).toBe(true);
    });

    it('no screen or other consumer reads `intent.action`', () => {
        const offenders = [];
        for (const file of files) {
            if (file === PARSER_FILE || file === EXTERNAL_ROUTER_FILE) continue;
            const src = readFileSync(file, 'utf8');
            if (INTENT_ACTION_RE.test(src)) offenders.push(relative(PACKAGES, file));
        }
        expect(
            offenders,
            `${offenders.join(', ')} reads intent.action. A parsed URI intent must only ever be routed `
            + 'through deepLinkRoute, whose fixed allowlist rejects unknown external actions. Screens route '
            + 'on `kind` and treat `action` as display-only text.',
        ).toEqual([]);
    });
});
