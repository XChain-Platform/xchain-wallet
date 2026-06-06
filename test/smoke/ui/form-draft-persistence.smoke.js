// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §37 / G125 Form-draft persistence. Pins the useFormDraft
// hook surface + the Send / SignMessage integrations shipped at v0.212.0.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const hookSrc = read('packages/core/src/shared/hooks/useFormDraft.js');
const sendSrc = read('packages/core/src/shared/routes/Send.jsx');
const sigSrc = read('packages/core/src/shared/routes/SignMessageForm.jsx');

// 1. Hook is exported and accepts the documented options.
assert.ok(/export function useFormDraft\(/.test(hookSrc),
    'useFormDraft exports the hook');
for (const opt of ['view', 'walletId', 'ttlMs']) {
    assert.ok(new RegExp(`\\b${opt}\\b`).test(hookSrc), `useFormDraft references option "${opt}"`);
}

// 2. Hook returns the documented public surface.
for (const ret of ['load', 'save', 'clear', 'hasDraft', 'storageKey']) {
    assert.ok(new RegExp(`\\b${ret}\\b`).test(hookSrc), `useFormDraft returns "${ret}"`);
}

// 3. Storage key namespacing + per-walletId scoping.
assert.ok(/'xc:formdraft:'/.test(hookSrc),
    'useFormDraft namespaces keys under xc:formdraft:');
assert.ok(/walletId \|\| 'none'/.test(hookSrc),
    'useFormDraft falls back to "none" when walletId is falsy');

// 4. TTL discard happens on load, not blindly on save.
assert.ok(/Date\.now\(\) - parsed\.savedAt > ttlMs/.test(hookSrc),
    'useFormDraft discards drafts older than ttlMs on load');
assert.ok(/store\.removeItem\(storageKey\)/.test(hookSrc),
    'useFormDraft removes the stale entry rather than serving it');

// 5. Empty values write removes the entry rather than persisting blank fields.
assert.ok(/isEmpty/.test(hookSrc),
    'useFormDraft short-circuits when every value is empty');

// 6. Storage access guarded by safeStorage probe so disabled
//    localStorage doesn't crash callers.
assert.ok(/function safeStorage\(\)/.test(hookSrc),
    'useFormDraft probes storage availability');
assert.ok(/try \{[\s\S]*localStorage\.setItem\(probe, '1'\)/.test(hookSrc),
    'useFormDraft write-probe guards against disabled storage');

// 7. Send.jsx wires the hook + restore banner + clear-on-success.
assert.ok(/from '\.\.\/hooks\/useFormDraft\.js'/.test(sendSrc),
    'Send.jsx imports useFormDraft');
assert.ok(/useFormDraft\(\{ view: 'send', walletId \}\)/.test(sendSrc),
    'Send.jsx initialises useFormDraft with view=send and walletId');
assert.ok(/draft\.save\(\{ chainId, toAddress, tick, amount, memo \}\)/.test(sendSrc),
    'Send.jsx auto-saves the user-visible composition fields');
assert.ok(!/draft\.save[\s\S]{0,200}password/.test(sendSrc),
    'Send.jsx never persists password into the draft');
assert.ok(/draft\.clear\(\);[\s\S]{0,80}setStage\('done'\)/.test(sendSrc),
    'Send.jsx clears the draft after a successful broadcast');
assert.ok(/draftBanner/.test(sendSrc),
    'Send.jsx renders a draftBanner');

// 8. SignMessageForm wires the hook similarly.
assert.ok(/from '\.\.\/hooks\/useFormDraft\.js'/.test(sigSrc),
    'SignMessageForm imports useFormDraft');
assert.ok(/useFormDraft\(\{ view: 'sign-message', walletId \}\)/.test(sigSrc),
    'SignMessageForm initialises useFormDraft with view=sign-message and walletId');
assert.ok(/draft\.save\(\{ chainId, addressId, message \}\)/.test(sigSrc),
    'SignMessageForm auto-saves chain / address / message');
assert.ok(!/draft\.save[\s\S]{0,200}password/.test(sigSrc),
    'SignMessageForm never persists password into the draft');
assert.ok(/draft\.clear\(\)/.test(sigSrc),
    'SignMessageForm clears the draft after a successful sign');

console.log('OK — useFormDraft + Send / SignMessageForm wiring smoke');
