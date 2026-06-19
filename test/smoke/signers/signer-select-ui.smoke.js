// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §17.6 / G023: SignerSelectForm + AddAccount/Receive
// integration + host-side `pickSignerFromRequest` helper.
//
// Verifies:
//   1. SignerSelectForm.jsx exists, renders zero-friction (returns null)
//      when no HW signers are paired, and exposes the
//      software/HW-card option set otherwise via `messaging.listSigners`.
//   2. AddAccountForm + Receive route through SignerSelectForm and
//      thread `signerId` into the messaging call.
//   3. createAccount + receiveAddress core flows accept an optional
//      `signer` and pick `Address.source` from the signer's kind.
//   4. Background host's `account.create` + `receive.getAddress`
//      handlers call `pickSignerFromRequest` so HW signing skips the
//      password and reuses the renderer-side signer bridge.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- 1. SignerSelectForm exists + has the expected surface ----------------

const formPath = join(sharedRoutes, 'SignerSelectForm.jsx');
assert.ok(existsSync(formPath), 'SignerSelectForm.jsx exists');

const formSrc = readFileSync(formPath, 'utf8');
assert.ok(
    /export function SignerSelectForm\b/.test(formSrc),
    'SignerSelectForm is a named export',
);
assert.ok(
    /messaging\.listSigners\s*\(/.test(formSrc),
    'SignerSelectForm fetches signers via messaging.listSigners',
);
assert.ok(
    /onChange\(null\)/.test(formSrc),
    'SignerSelectForm auto-resolves to software (null) when no HW signers exist',
);
assert.ok(
    /Software wallet/.test(formSrc),
    'SignerSelectForm renders the explicit "Software wallet" card label',
);
assert.ok(
    /type="radio"/.test(formSrc),
    'SignerSelectForm uses radio-input cards (single-select)',
);

// --- 2. AddAccountForm + Receive consume the picker -----------------------

const addAccountSrc = readFileSync(
    join(sharedRoutes, 'AddAccountForm.jsx'), 'utf8',
);
assert.ok(
    /import\s*\{\s*SignerSelectForm\s*\}\s*from\s*['"]\.\/SignerSelectForm\.jsx['"]/.test(addAccountSrc),
    'AddAccountForm imports SignerSelectForm',
);
assert.ok(
    /<SignerSelectForm\b/.test(addAccountSrc),
    'AddAccountForm renders <SignerSelectForm>',
);
assert.ok(
    /signerId\s*:\s*signerId\s*\|\|\s*undefined/.test(addAccountSrc),
    'AddAccountForm threads signerId into messaging.createAccount',
);

// The QR-first Receive redesign removed the inline "derive next address"
// form, and with it the SignerSelectForm picker on the Receive screen.
// The picker component, the receive.getAddress handler's signer routing
// (asserted in part 4), and the messaging surface all remain; only the
// Receive screen no longer mounts the picker.
const receiveSrc = readFileSync(join(sharedRoutes, 'Receive.jsx'), 'utf8');
assert.ok(
    !/<SignerSelectForm\b/.test(receiveSrc),
    'Receive no longer mounts SignerSelectForm (inline derive flow dropped)',
);

// --- 3. Core flows accept an optional signer + derive Address.source ------

const createAccountFlow = readFileSync(
    join(core, 'src', 'flows', 'createAccount.js'), 'utf8',
);
assert.ok(
    /signerKind\s*===\s*'software'\s*\?\s*'hd'\s*:\s*signerKind/.test(createAccountFlow),
    'createAccount picks Address.source from the signer kind (software → hd, HW → trezor/ledger)',
);
assert.ok(
    /typeof signer\.lock === 'function'/.test(createAccountFlow),
    'createAccount only calls signer.lock() when the signer implements it (RemoteSigner does not)',
);

const receiveFlow = readFileSync(
    join(core, 'src', 'flows', 'receiveAddress.js'), 'utf8',
);
assert.ok(
    /providedSigner/.test(receiveFlow),
    'receiveAddress accepts an optional pre-supplied signer',
);
assert.ok(
    /either\s+`signer`\s+or\s+`password`\s+is required/.test(receiveFlow),
    'receiveAddress validates that password is only required when signer is absent',
);
assert.ok(
    /signerKind\s*===\s*'software'\s*\?\s*'hd'\s*:\s*signerKind/.test(receiveFlow),
    'receiveAddress picks Address.source from the signer kind',
);

// --- 4. Background host wires `pickSignerFromRequest` --------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /async function pickSignerFromRequest\s*\(/.test(bg),
    'background host defines pickSignerFromRequest helper',
);
assert.ok(
    /signerBridge\.getTransport\(record\.id\)/.test(bg),
    'pickSignerFromRequest fetches the live HW transport via signerBridge.getTransport',
);
assert.ok(
    /buildRemoteSigner\s*\(\s*descriptor\s*,\s*transport\s*\)/.test(bg),
    'pickSignerFromRequest builds a RemoteSigner from the HW descriptor',
);
assert.ok(
    /host\.register\('account\.create'/.test(bg)
        && /pickSignerFromRequest\s*\(\s*\{[^}]*signerId:\s*req\?\.signerId/.test(bg),
    'account.create handler routes through pickSignerFromRequest',
);
assert.ok(
    /host\.register\('receive\.getAddress'/.test(bg)
        && bg.split("host.register('receive.getAddress'")[1].includes('pickSignerFromRequest'),
    'receive.getAddress handler routes through pickSignerFromRequest',
);

// --- 5. Messaging surfaces: both shells expose listSigners ---------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function listSigners\b/.test(m),
        `${shell} messaging.js exports listSigners (G023 picker fetch)`,
    );
}
