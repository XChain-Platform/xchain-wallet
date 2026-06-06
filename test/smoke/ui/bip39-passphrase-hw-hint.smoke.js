// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Cluster H FOLLOWUP 1 — BIP39 passphrase toggle in CreateWallet +
// ImportWallet now carries explanatory copy that hardware wallets
// handle passphrases on the device itself, not via this UI. The
// Create / Import lanes are software-only by construction (HW
// signers pair through PairSignerForm + AddAccountForm), so the
// FOLLOWUP closes by surfacing the distinction in the existing
// InfoTip copy rather than adding a code-level branch that would
// never fire.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const createSrc = read('packages/core/src/shared/routes/CreateWallet.jsx');
const importSrc = read('packages/core/src/shared/routes/ImportWallet.jsx');

// 1. CreateWallet's existing BIP39 InfoTip extends its label to
//    mention the HW-on-device caveat alongside the entropy /
//    forget-warning text the v0.210.0 copy already surfaced.
assert.ok(/aria="BIP39 passphrase help"/.test(createSrc),
    'CreateWallet keeps its BIP39 passphrase InfoTip aria');
assert.ok(/Hardware wallets handle passphrases on the device itself/.test(createSrc),
    'CreateWallet InfoTip mentions hardware wallets handle passphrases on-device');
assert.ok(/Trezor Suite \/ Ledger Live/.test(createSrc),
    'CreateWallet InfoTip names Trezor Suite + Ledger Live');

// 2. ImportWallet imports the InfoTip primitive (it didn't before
//    this FOLLOWUP) and uses it on its own BIP39 passphrase
//    toggle.
assert.ok(/InfoTip/.test(importSrc),
    'ImportWallet imports InfoTip from core/ui');
assert.ok(/aria="BIP39 passphrase help"/.test(importSrc),
    'ImportWallet ships a BIP39 passphrase InfoTip');
assert.ok(/Hardware wallets \(Trezor \/ Ledger\) handle passphrases on the device itself/.test(importSrc),
    'ImportWallet InfoTip mentions HW devices handle passphrases on-device');
assert.ok(/pair a hardware wallet via Add Account → Hardware Signer/.test(importSrc),
    'ImportWallet InfoTip points users to the correct HW pairing lane');

// 3. The ImportWallet InfoTip lives inside the existing
//    `<label className={styles.advancedToggle}>` next to the
//    "This wallet uses a BIP39 passphrase" copy — sanity check it
//    sits adjacent to the trigger text rather than floating
//    elsewhere in the form.
assert.ok(/<span>This wallet uses a BIP39 passphrase<\/span>[\s\S]{0,400}<InfoTip/.test(importSrc),
    'ImportWallet places the InfoTip immediately after the toggle label');

console.log('OK — BIP39 passphrase HW-hint sweep (CreateWallet + ImportWallet)');
