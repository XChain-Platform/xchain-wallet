// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster H FOLLOWUP 1: BIP39 passphrase toggle in CreateWallet +
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
import { withEnglishCopy } from '../_localized-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const createSrc = withEnglishCopy(read('packages/core/src/shared/routes/CreateWallet.jsx'));
const importSrc = withEnglishCopy(read('packages/core/src/shared/routes/ImportWallet.jsx'));

// 1. CreateWallet's existing BIP39 InfoTip extends its label to
//    mention the HW-on-device caveat alongside the entropy /
//    forget-warning text the v0.210.0 copy already surfaced.
//    2026-11-14: the passphrase Switch carries the tip through its own
//    `help` prop (the kit InfoTip, named "About <label>", U57) in the Extra
//    Passphrase form section, so the check reads the Switch's help.
assert.ok(/<Switch[\s\S]{0,200}?help="[^"]*Hardware wallets handle it/.test(createSrc),
    'CreateWallet passphrase Switch help mentions hardware wallets handle passphrases on-device');

// 2. ImportWallet's passphrase Switch carries the same tip through its own
//    `help` prop (the kit InfoTip, "About <label>", U57; 2026-11-14), so the
//    tip sits on the toggle's own label row.
const importSwitch = importSrc.match(/<Switch\b[\s\S]{0,1500}?\/>/g)
    ?.find((tag) => /label="This wallet uses an extra passphrase"/.test(tag)) ?? '';
assert.ok(importSwitch, 'ImportWallet has the extra-passphrase Switch');
assert.ok(/help="[^"]*(?:hardware wallets|enter it on the device)/i.test(importSwitch),
    'ImportWallet passphrase help mentions HW devices handle passphrases on-device');
assert.ok(/help="[^"]*connect through Pair Hardware Wallet/.test(importSwitch),
    'ImportWallet passphrase help points users to the correct HW pairing lane');

console.log('OK: BIP39 passphrase HW-hint sweep (CreateWallet + ImportWallet)');
