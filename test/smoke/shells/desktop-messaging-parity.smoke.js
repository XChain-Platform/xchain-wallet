// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// THE DESKTOP RENDERER ASKS THE HOST FOR EVERYTHING THE WEB RENDERER DOES.
//
// Both shells talk to the same background host: packages/desktop/main/
// messageHost.js wires `createBackgroundHost`, the very factory the extension
// service worker uses, and the web shell's worker does the same. So a message
// type one shell's renderer can send is a message type the other shell's host
// can already answer, and a wrapper missing from one renderer is pure drift.
//
// WHAT IT COST. Measured 2026-08-07 (row 105) by driving the real
// desktop app, which row 102's blank-window fix had just made possible:
// packages/desktop/renderer/messaging.js exported 297 wrappers to the web
// shell's 313, and every section of the desktop Settings screen painted
// "Settings unavailable: messaging.getSettings is not available in this
// shell" - the string core/shared/hooks/useSettings.js raises when the
// wrapper is absent. Appearance, Language & Region, Privacy, Safety, Wallet
// Mode, Backup, Fees, Network and Notifications were all dead, and so were
// encrypted backup export, mnemonic reveal, dry-run restore, label
// publishing, message signing and verification, connected sites, and the
// blocklist audit log. The desktop messaging module's own header has claimed
// "parity with packages/web/src/messaging.js" the whole time.
//
// WHY IT IS A SOURCE READ. The complementary gate drives the real app and
// opens Settings (test/smoke/shells/desktop-renders.smoke.js), which is the
// check that proves a wrapper WORKS. This one answers the question that walk
// cannot: which of the other sixteen calls are missing, on a shell where
// reaching each one needs a wallet, a chain and a device. Names and wire
// types, compared - not a claim that the UI is fine.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktopFile = join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js');
const webFile = join(wsRoot, 'packages', 'web', 'src', 'messaging.js');

/**
 * Every `export function name(...)` in a messaging module, mapped to the
 * message type its body sends. Read from source rather than imported: both
 * modules bind a shell-specific transport at module scope (the desktop one
 * reaches for the preload bridge on `window`), so importing them outside
 * their shell proves nothing and mostly throws.
 *
 * The type is the first `sendMessage('...')` inside the function body, found
 * by brace-matching from the declaration so a helper defined further down the
 * file cannot be misread as this function's call.
 */
function wrappers(file) {
    const src = readFileSync(file, 'utf8');
    const out = new Map();
    const decl = /^export (?:async )?function (\w+)\s*\(/gm;
    let m;
    while ((m = decl.exec(src)) !== null) {
        const name = m[1];
        let depth = 0;
        let started = false;
        let end = m.index;
        for (let i = m.index; i < src.length; i += 1) {
            const ch = src[i];
            if (ch === '{') { depth += 1; started = true; } else if (ch === '}') { depth -= 1; }
            if (started && depth === 0) { end = i; break; }
        }
        const body = src.slice(m.index, end + 1);
        const sent = /sendMessage\(\s*'([^']+)'/.exec(body);
        out.set(name, sent ? sent[1] : null);
    }
    return out;
}

const desktop = wrappers(desktopFile);
const web = wrappers(webFile);

assert.ok(web.size > 250, `the web messaging module parsed as ${web.size} wrappers, which means this `
    + 'smoke is reading the wrong shape rather than passing');

const missing = [...web.keys()].filter((n) => !desktop.has(n));
assert.deepEqual(
    missing,
    [],
    `packages/desktop/renderer/messaging.js is missing ${missing.length} wrapper(s) the web shell has, `
    + 'against a host that answers both: '
    + `${missing.join(', ')}. The desktop UI renders the same @xchain-wallet/core routes, so each `
    + "missing name is a dead screen or a dead button on desktop only - that is how the whole Settings "
    + 'screen shipped broken. Add the wrapper to the desktop module with the web shell\'s body.',
);

// A wrapper that exists but sends a different type is the same defect wearing
// a passing name check, and it is the more expensive one: it fails at runtime
// with UnknownMessageTypeError instead of at import.
const divergent = [];
for (const [name, type] of web) {
    const theirs = desktop.get(name);
    if (type && theirs && theirs !== type) divergent.push(`${name}: desktop sends '${theirs}', web sends '${type}'`);
}
assert.deepEqual(
    divergent,
    [],
    `these wrappers exist in both shells and send DIFFERENT message types, so one of them reaches a `
    + `handler that is not there: ${divergent.join(' | ')}`,
);

console.log(`OK: desktop-messaging-parity smoke (${desktop.size} desktop wrappers cover all `
    + `${web.size} the web shell exports, and every shared name sends the same message type)`);
