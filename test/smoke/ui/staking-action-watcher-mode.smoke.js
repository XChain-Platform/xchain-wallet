// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 16: validator Unstake and Claim's
// watcher-mode branch (UNSTAKE / COLLECT by action), now actions of the one
// Staking form (StakingForm.jsx).

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
const row = (key) => formSrc.split(`'${key}': {`)[1]?.split(/\n    '[a-z]+:[a-z-]+': \{/)[0] || '';

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ ResultScreen \} from '\.\.\/components\/ResultScreen\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(row('network:unstake'), /wire: 'UNSTAKE'/);
assert.match(row('network:claim-rewards'), /wire: 'COLLECT'/);
assert.match(formSrc, /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: cfg\.wire, params: wireParams\(request\.params\)/);
assert.match(formSrc, /if \(result\?\.psbtHex && !txid\) \{[\s\S]+?<ResultScreen/);
assert.match(formSrc, /Create Unsigned Transaction/);
console.log('staking-action-watcher-mode smoke OK');
