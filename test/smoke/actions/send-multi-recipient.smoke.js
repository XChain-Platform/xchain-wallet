// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-52: multi-recipient / multi-tick SEND (protocol formats v1-v3).
//
// The behaviour is covered by tests that run the code (test/unit/flows/
// sendLegs.test.js, sendTokenMultiLeg.test.js, and test/unit/routes/
// Send.multiRecipient.test.jsx drives the real form). What this smoke pins is
// the WIRING that no single test sees at once:
//
//   1. One shaping module owns the recipient list, and all THREE
//      SEND-composing paths use it. Three call sites built the wire params by
//      hand before PC-52, which is how a fourth path could quietly emit a
//      shape the others refuse.
//   2. The single-recipient bytes are unchanged: one leg stays the flat
//      TICK/AMOUNT/DESTINATION map, never a one-entry LEGS array.
//   3. The refusals exist on every path (native coin, gated ticks), plus the
//      recipient cap.
//   4. The form's payload carries `legs` only for a real multi-recipient send.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...parts) => {
    const p = join(wsRoot, ...parts);
    assert.ok(existsSync(p), `${parts.join('/')} exists`);
    return readFileSync(p, 'utf8');
};

// --- 1. One shaping module, used by every SEND-composing path ------------

const legs = read('packages', 'core', 'src', 'flows', 'sendLegs.js');
for (const fn of [
    'normalizeSendLegs', 'buildSendParams', 'assertMultiSendSupported',
    'assertNoGatedLegs', 'summarizeSendLegs', 'totalsByTick',
]) {
    assert.match(legs, new RegExp(`export (async )?function ${fn}\\(`), `sendLegs exports ${fn}`);
}

const sendFlow = read('packages', 'core', 'src', 'flows', 'sendToken.js');
const psbtFlow = read('packages', 'core', 'src', 'flows', 'buildSendPsbt.js');
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
for (const [name, src] of [['sendToken', sendFlow], ['buildSendPsbt', psbtFlow], ['host composeForConfirm', host]]) {
    assert.match(src, /normalizeSendLegs\(/, `${name} shapes its recipients through sendLegs`);
    assert.match(src, /buildSendParams\(/, `${name} builds SEND params through sendLegs`);
}
// No path may hand-roll the wire params any more (that is the drift this
// module exists to prevent).
for (const [name, src] of [['sendToken', sendFlow], ['buildSendPsbt', psbtFlow]]) {
    assert.ok(
        !/TICK: opts\.tick,\s*\n\s*AMOUNT:/.test(src),
        `${name} no longer builds SEND params by hand`,
    );
}
assert.ok(
    !/const params = \{ TICK: req\.tick, AMOUNT:/.test(host),
    'host composeForConfirm no longer builds SEND params by hand',
);
const flowsIndex = read('packages', 'core', 'src', 'flows', 'index.js');
assert.match(flowsIndex, /from '\.\/sendLegs\.js'/, 'flows/index re-exports the sendLegs surface');

// --- 2. One recipient keeps the pre-PC-52 bytes --------------------------

assert.match(
    legs,
    /if \(legs\.length === 1\)/,
    'buildSendParams special-cases a single leg (flat params, so v0 bytes are unchanged)',
);
assert.match(legs, /params\.LEGS = legs\.map\(/, 'two or more legs emit a LEGS array');

// --- 3. The refusals, on every path --------------------------------------

assert.match(legs, /NATIVE_MULTI_SEND/, 'native-coin multi-send has a typed refusal');
assert.match(legs, /GATED_MULTI_SEND/, 'gated-tick multi-send has a typed refusal');
assert.match(legs, /TOO_MANY_LEGS/, 'the recipient cap has a typed refusal');
assert.match(legs, /export const MAX_SEND_LEGS = \d+/, 'the recipient cap is a named constant');
for (const [name, src] of [['sendToken', sendFlow], ['buildSendPsbt', psbtFlow], ['host composeForConfirm', host]]) {
    assert.match(src, /assertMultiSendSupported\(\{/, `${name} refuses a native multi-send`);
    assert.match(src, /assertNoGatedLegs\(\{/, `${name} refuses a gated multi-send`);
}

// --- 4. The form sends legs only when there is more than one recipient ---

const form = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
assert.match(form, /const isMultiSend = extraLegs\.length > 0;/, 'Send tracks extra recipients');
const legsPayloads = form.match(/\.\.\.\(isMultiSend \? \{ legs: sendLegs \} : \{\}\)/g) || [];
assert.equal(legsPayloads.length, 2,
    'both submit paths (confirm-modal and the legacy review/watcher path) send legs, and only when multi');
assert.match(form, /\+ Add recipient/, 'the form offers an add-recipient control');
assert.match(form, /Remove recipient \$\{i \+ 2\}/, 'each added row can be removed');
assert.match(form, /aria-label=\{`Recipient \$\{i \+ 2\} address`\}/,
    'added rows carry row-qualified accessible names (three identical "To" fields otherwise)');
assert.match(form, /nativeMultiSendBlock/, 'the form mirrors the native refusal before submit');
assert.match(form, /gatedMultiSendBlock/, 'the form mirrors the gated refusal before submit');
assert.match(form, /recipientNovel = sendLegs\.some\(/,
    'the HW cross-check treats ANY novel recipient as novel, not just the first');

console.log(
    'OK: send multi-recipient smoke (PC-52: flows/sendLegs owns the recipient list and all 3 '
    + 'SEND-composing paths use it; one leg still emits flat v0 params; native-coin, gated-tick '
    + 'and leg-cap refusals present on every path; Send.jsx sends `legs` only for a real '
    + 'multi-recipient send, on both the confirm-modal and watcher paths)',
);
