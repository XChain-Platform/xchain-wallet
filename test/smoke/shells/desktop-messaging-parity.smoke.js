// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ALL THREE SHELLS ASK THE HOST FOR THE SAME THINGS, THE SAME WAY.
//
// Widened from web-vs-desktop to popup + web + desktop, and from a subset
// check to set equality with a written exception list. The subset chain it
// replaced (web ⊆ desktop ⊆ popup) passed a helper added to the popup and
// called from shared core code, which is dead on the other two shells; it
// also compared no message types against the popup at all.
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
const MODULES = {
    popup: join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    desktop: join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    web: join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
};
const typedefFile = join(wsRoot, 'packages', 'core', 'src', 'shared', 'MessagingContext.js');

// Helpers only SOME shells are allowed to export, each with the reason and
// the exact shell set. A name only belongs here when the ASYMMETRY is the
// design; widening the list to silence a first-run failure is how the seam
// this gate guards goes dark. The set is exact, not a minimum: adding a
// shell to the implementation has to be a deliberate edit here too.
const SHELL_ONLY = new Map([
    // §26 out-of-renderer backstop: the foreground auto-lock hook dies with
    // the renderer, so a shell whose key OUTLIVES the renderer has to hand
    // its own process the arm decision. The MV3 popup does (service worker),
    // and desktop does (the keychain-cached key survives a quit, so the
    // window has to bound it). Plain web keeps the key in memory only, so a
    // closed tab is already locked and there is nothing to report to.
    ['reportAutoLock', ['popup', 'desktop']],
]);

/**
 * Every helper a messaging module exports, mapped to its parameter list and
 * to the message type its body sends. Read from source rather than imported:
 * all three modules bind a shell-specific transport at module scope (the
 * desktop one reaches for the preload bridge on `window`), so importing them
 * outside their shell proves nothing and mostly throws.
 *
 * The type is the first `sendMessage('...')` inside the function body, found
 * by brace-matching from the declaration so a helper defined further down the
 * file cannot be misread as this function's call.
 *
 * `export { a, b }` re-export lines are read too: the web module re-exports
 * `getSessionStatus` from hostBridge.js, and a declaration-only scan called
 * that a missing wrapper (or, worse, missed a future one silently).
 */
/** Top-level commas only, so an inline object type stays one parameter. */
function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of list) {
        if ('([{<'.includes(ch)) depth += 1;
        else if (')]}>'.includes(ch)) depth -= 1;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((p) => p.split(':')[0].split('=')[0].replace(/[?\s]/g, '').trim()).filter(Boolean);
}

function wrappers(file) {
    const src = readFileSync(file, 'utf8');
    const out = new Map();
    const decl = /^export (?:async )?function (\w+)\s*\(([^)]*)\)/gm;
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
        out.set(name, { params: splitParams(m[2]).join(', '), type: sent ? sent[1] : null });
    }
    const reExport = /^export\s*\{([^}]*)\}/gm;
    let r;
    while ((r = reExport.exec(src)) !== null) {
        for (const part of r[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop().trim();
            // Re-exports carry no local declaration, so params and type are
            // unknown here and take no part in the two comparisons below.
            if (name && !out.has(name)) out.set(name, { params: null, type: null });
        }
    }
    return out;
}

const shells = Object.fromEntries(
    Object.entries(MODULES).map(([shell, file]) => [shell, wrappers(file)]),
);

for (const [shell, mod] of Object.entries(shells)) {
    assert.ok(mod.size > 250, `the ${shell} messaging module parsed as ${mod.size} wrappers, which means `
        + 'this smoke is reading the wrong shape rather than passing');
}

// Set EQUALITY, not a subset chain. A subset chain
// (web ⊆ desktop ⊆ popup) passes a helper added to the popup and called from
// shared core code, which is dead on the other two shells at runtime - the
// exact defect class the seam exists to catch.
const names = new Set(Object.values(shells).flatMap((m) => [...m.keys()]));
const absent = [];
for (const name of names) {
    const has = Object.entries(shells).filter(([, m]) => m.has(name)).map(([s]) => s);
    if (has.length === 3) continue;
    // Exact-set match, so gaining OR losing a shell reopens the decision.
    const only = SHELL_ONLY.get(name);
    if (only && [...only].sort().join(',') === [...has].sort().join(',')) continue;
    absent.push(`${name}: exported by ${has.join(' + ')} only`);
}
assert.deepEqual(
    absent,
    [],
    'these messaging helpers are not exported by all three shells, against a host that answers all '
    + `three: ${absent.join(' | ')}. Shared @xchain-wallet/core routes call them by name, so each one `
    + 'is a dead screen or a dead button on the shells that lack it - that is how the whole desktop '
    + 'Settings screen shipped broken. Add the wrapper to the shells that lack it, or, if the '
    + 'asymmetry is the design, add it to SHELL_ONLY above with the reason.',
);

// A wrapper that exists everywhere but sends a different type is the same
// defect wearing a passing name check, and it is the more expensive one: it
// fails at runtime with UnknownMessageTypeError instead of at import.
const divergent = [];
for (const name of names) {
    const seen = new Map();
    for (const [shell, mod] of Object.entries(shells)) {
        const type = mod.get(name)?.type;
        if (type) seen.set(shell, type);
    }
    if (new Set(seen.values()).size > 1) {
        divergent.push(`${name}: ${[...seen].map(([s, t]) => `${s} sends '${t}'`).join(', ')}`);
    }
}
assert.deepEqual(
    divergent,
    [],
    'these wrappers exist in more than one shell and send DIFFERENT message types, so one of them '
    + `reaches a handler that is not there: ${divergent.join(' | ')}`,
);

// Parameter lists too: a helper that drops an argument on one shell (the
// account-scoping one, historically) silently answers about the wrong account
// rather than failing, so the name and type checks above both stay green.
const arity = [];
for (const name of names) {
    const seen = new Map();
    for (const [shell, mod] of Object.entries(shells)) {
        const params = mod.get(name)?.params;
        if (typeof params === 'string') seen.set(shell, params);
    }
    if (new Set(seen.values()).size > 1) {
        arity.push(`${name}: ${[...seen].map(([s, p]) => `${s}(${p})`).join(', ')}`);
    }
}
assert.deepEqual(
    arity,
    [],
    'these wrappers take DIFFERENT parameter lists across shells, so a shared route passes an argument '
    + `one shell drops: ${arity.join(' | ')}`,
);

// The MessagingModule typedef in core is the only WRITTEN statement of this
// contract, and it under-declared three account-scoped helpers for long enough
// that a fourth shell built to it would have aggregated across BIP44 accounts.
// Every name it declares must exist on all three shells with the same
// parameter names, in order.
const typedefSrc = readFileSync(typedefFile, 'utf8');
/** @type {Array<[string, string]>} */
const declared = [];
for (const line of typedefSrc.split('\n')) {
    const at = line.indexOf('@property {(');
    if (at < 0) continue;
    const open = at + '@property {'.length;
    let depth = 0;
    let close = -1;
    for (let i = open; i < line.length; i += 1) {
        if (line[i] === '(') depth += 1;
        else if (line[i] === ')') { depth -= 1; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    const named = /\}\s*\[?(\w+)\]?/.exec(line.slice(close + 1));
    if (named) declared.push([named[1], splitParams(line.slice(open + 1, close)).join(', ')]);
}

assert.ok(declared.length > 10, `the MessagingModule typedef parsed as ${declared.length} properties, `
    + 'which means this check is reading the wrong shape rather than passing');

const stale = [];
for (const [name, params] of declared) {
    for (const [shell, mod] of Object.entries(shells)) {
        const impl = mod.get(name);
        if (!impl) { stale.push(`${name}: declared in the typedef, not exported by ${shell}`); continue; }
        if (impl.params !== null && impl.params !== params) {
            stale.push(`${name}: typedef says (${params}), ${shell} implements (${impl.params})`);
        }
    }
}
assert.deepEqual(
    stale,
    [],
    'packages/core/src/shared/MessagingContext.js declares a surface the shells do not implement, and it '
    + `is what a new shell is built against: ${stale.join(' | ')}. Correct the typedef.`,
);

console.log('OK: shell-messaging-parity smoke ('
    + Object.entries(shells).map(([s, m]) => `${s} ${m.size}`).join(', ')
    + `; ${names.size} names agree three ways on export, message type and parameter list, `
    + `with ${SHELL_ONLY.size} documented shell-only exception(s); `
    + `${declared.length} MessagingModule typedef properties match all three)`);
