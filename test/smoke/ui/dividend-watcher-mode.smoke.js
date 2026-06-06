// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 9 — DividendForm watcher-mode branch.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'DividendForm.jsx'),
    'utf8',
);

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(
    formSrc,
    /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: 'DIVIDEND'/,
);
assert.match(formSrc, /if \(!isWatcherMode && !isHwSource && password\.length === 0\) return;/);
assert.match(formSrc, /if \(result\?\.psbtHex && !txid\) \{[\s\S]+?<WatcherResultPanel/);
assert.match(formSrc, /\{isWatcherMode \? \([\s\S]+?Watcher mode/);
assert.match(formSrc, /Create unsigned transaction/);
console.log('dividend-watcher-mode smoke OK');
