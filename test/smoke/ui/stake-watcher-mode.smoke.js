// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 13: validator Stake's watcher-mode branch,
// now the network:stake action of the one Staking form (StakingForm.jsx).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'StakingForm.jsx'),
    'utf8',
);
const row = formSrc.split("'network:stake': {")[1]?.split(/\n    '[a-z]+:[a-z-]+': \{/)[0] || '';

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ ResultScreen \} from '\.\.\/components\/ResultScreen\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(row, /wire: 'STAKE'/);
assert.match(formSrc, /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: cfg\.wire, params: wireParams\(request\.params\)/);
assert.match(formSrc, /if \(!isWatcherMode && !isHwSource && \(!signerReady && password\.length === 0\)\) return;/);
assert.match(formSrc, /if \(result\?\.psbtHex && !txid\) \{[\s\S]+?<ResultScreen/);
assert.match(formSrc, /Create Unsigned Transaction/);
console.log('stake-watcher-mode smoke OK');
