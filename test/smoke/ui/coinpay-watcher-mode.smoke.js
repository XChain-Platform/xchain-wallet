// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 22 — CoinpayForm watcher-mode branch.
// COINPAY needs encoderOpts.customOutputs to direct the buyer's
// payment to the matched seller — preserved through the watcher-mode
// buildActionPsbtRequest call.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'CoinpayForm.jsx'),
    'utf8',
);

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(formSrc, /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: 'COINPAY'/);
assert.match(formSrc, /ORDER_MATCH_ACTION_INDEX: String\(summary\.actionIndex\)/);
assert.match(
    formSrc,
    /encoderOpts: \{[\s\S]+?customOutputs: \[\{ address: summary\.payeeAddress, value: summary\.coinAmount \}\]/,
    'watcher-mode encoderOpts preserves the buyer-pays-seller customOutputs',
);
assert.match(formSrc, /Create unsigned transaction/);
console.log('coinpay-watcher-mode smoke OK');
