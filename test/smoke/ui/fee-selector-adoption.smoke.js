// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke: every transaction form that shows a network fee uses the shared,
// editable FeeSelector AND threads the picked rate into the broadcast as
// `feePerKb` (not just a read-only display). Mirrors the wired reference
// forms ComposeMessage / DispenserDetail.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const routes = join(here, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes');
const read = (f) => readFileSync(join(routes, f), 'utf8');

// Forms that render an editable FeeSelector for the network fee.
const FEE_FORMS = [
    'Send.jsx',
    'Receive.jsx',
    'ComposeMessage.jsx',
    'DispenserDetail.jsx',
    'SwapForm.jsx',
    'CrossChainSwapForm.jsx',
    'SellOwnershipForm.jsx',
    'CoinpayForm.jsx',
];

for (const f of FEE_FORMS) {
    const src = read(f);
    assert.match(src, /<FeeSelector/, `${f} renders the shared FeeSelector`);
}

// Forms that broadcast and must thread the picked rate as feePerKb so the
// choice actually prices the transaction. (Receive encodes a QR preference,
// not a broadcast, so it is intentionally excluded here.)
const THREADING_FORMS = [
    'Send.jsx',
    'ComposeMessage.jsx',
    'SwapForm.jsx',
    'CrossChainSwapForm.jsx',
    'SellOwnershipForm.jsx',
    'CoinpayForm.jsx',
];

for (const f of THREADING_FORMS) {
    const src = read(f);
    // Derives feePerKb from the picked estimate via the shared converter.
    assert.match(
        src,
        /displayRateToSettingsCustom\(/,
        `${f} converts the picked rate to feePerKb`,
    );
    // Splices feePerKb into a submit/build payload (guarded on non-null).
    assert.match(
        src,
        /\.\.\.\(feePerKb != null \?/,
        `${f} threads feePerKb into the submit payload`,
    );
}

// Guard against regression: the four newly-wired forms must no longer show a
// fixed display-only fee via a bare estimate with no picker state.
for (const f of ['SwapForm.jsx', 'CrossChainSwapForm.jsx', 'SellOwnershipForm.jsx', 'CoinpayForm.jsx']) {
    const src = read(f);
    assert.match(src, /const \[feePick, setFeePick\]/, `${f} owns a feePick selection`);
}

console.log('fee-selector-adoption smoke OK');
