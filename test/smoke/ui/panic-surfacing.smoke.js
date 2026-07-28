// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  wiring smoke: panic mode's signing freeze must be surfaced on the
// screens where the user SPENDS, not only in Settings -> Safety.
//
// The rendered behaviour is covered by the unit tests
// (test/unit/shared/panicNotice.test.js and
// test/unit/components/panicFreezeSurfacing.test.jsx). What this smoke pins
// is the wiring: that Home and Send still mount the notice, and that no sign
// screen goes back to hard-coding "Wallet unlocked. No password needed."
// outside the <SigningReadyNote> guard. That is the exact regression the
// original defect was: the information existed one screen away and was simply
// never rendered where the user acts.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core', 'src');

const read = (...parts) => readFileSync(join(core, ...parts), 'utf8');

// --- the policy module exists and is pure -----------------------------

const noticeSrc = read('shared', 'safety', 'panicNotice.js');
for (const name of ['panicFreezeNotice', 'formatPanicRemaining', 'PANIC_SURFACE_SEND']) {
    assert.match(noticeSrc, new RegExp(`export (const|function) ${name}\\b`), `panicNotice exports ${name}`);
}
assert.doesNotMatch(noticeSrc, /from 'react'/, 'the policy stays free of React so it is testable as data');

const bindingSrc = read('shared', 'safety', 'PanicFreezeNotice.jsx');
for (const name of ['usePanicFreeze', 'PanicFreezeNotice', 'SigningReadyNote']) {
    assert.match(bindingSrc, new RegExp(`export function ${name}\\b`), `binding exports ${name}`);
}
// A freeze armed under duress must never draw a banner.
assert.match(bindingSrc, /!notice\.disclose\) return null/, 'duress-armed freezes render nothing');

// --- provenance is recorded at activation ------------------------------

const panicSrc = read('flows', 'panicMode.js');
assert.match(panicSrc, /export const PANIC_ARMED_SELF/, 'panicMode exports the self-armed marker');
assert.match(panicSrc, /export const PANIC_ARMED_DURESS/, 'panicMode exports the duress-armed marker');
assert.match(panicSrc, /armedBy: normalizeArmedBy\(armedBy\)/, 'activation records how it was armed');

const duressSrc = read('flows', 'duressPassphrase.js');
assert.match(
    duressSrc,
    /activatePanicMode\(\{ armedBy: PANIC_ARMED_DURESS \}\)/,
    'the duress passphrase arms panic mode as duress-armed, so ambient surfaces stay silent',
);

// --- the spend surfaces mount it ---------------------------------------

const homeSrc = read('shared', 'routes', 'Home.jsx');
assert.match(homeSrc, /<PanicFreezeNotice surface="home"/, 'Home mounts the freeze notice');

const sendSrc = read('shared', 'routes', 'Send.jsx');
assert.match(sendSrc, /<PanicFreezeNotice surface="send"/, 'the Send form mounts the freeze notice');

// --- no sign screen claims readiness outside the guard ------------------

// Every screen in the wallet that renders the unlocked note. Panic mode gates
// submitWithSigner, signMessageFlow, signPsbtFlow and multisigSignLocally, so
// message and PSBT screens are as wrong as the send confirm was.
const SIGN_SURFACES = [
    ['shared', 'components', 'SignCredentials.jsx'],
    ['shared', 'components', 'ActionConfirmScreen.jsx'],
    ['shared', 'components', 'MessageConfirmScreen.jsx'],
    ['shared', 'components', 'PsbtConfirmScreen.jsx'],
    ['shared', 'routes', 'Send.jsx'],
    ['shared', 'routes', 'PsbtSignForm.jsx'],
];
for (const parts of SIGN_SURFACES) {
    const src = read(...parts);
    const file = parts.join('/');
    assert.match(src, /No password needed/, `${file} still has the unlocked note`);
    assert.match(src, /<SigningReadyNote>/, `${file} guards the unlocked note with SigningReadyNote`);
}

console.log('panic-surfacing smoke OK');
