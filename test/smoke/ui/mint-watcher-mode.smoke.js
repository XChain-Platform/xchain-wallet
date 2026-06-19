// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 5: MintForm watcher-mode branch.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'MintForm.jsx'),
    'utf8',
);

assert.match(
    formSrc,
    /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/,
    'imports useWalletMode hook',
);
assert.match(
    formSrc,
    /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/,
    'imports the shared WatcherResultPanel',
);
assert.match(
    formSrc,
    /const \{ isWatcherMode \} = useWalletMode\(\);/,
    'derives isWatcherMode via the shared hook',
);
assert.match(
    formSrc,
    /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: 'MINT'/,
    'submit handler routes through buildActionPsbtRequest with action MINT in watcher mode',
);
assert.match(
    formSrc,
    /if \(!isWatcherMode && !isHwSource && \(!signerReady && password\.length === 0\)\) return;/,
    'password gate skipped in watcher mode',
);
assert.match(
    formSrc,
    /if \(result\?\.psbtHex && !txid\) \{[\s\S]+?<WatcherResultPanel/,
    'done stage renders WatcherResultPanel when result.psbtHex is set',
);
assert.match(
    formSrc,
    /\{isWatcherMode \? \([\s\S]+?Watcher mode/,
    'review stage shows watcher-mode hint copy',
);
assert.match(
    formSrc,
    /Create unsigned transaction/,
    'submit button reads "Create unsigned transaction" in watcher mode',
);

console.log('mint-watcher-mode smoke OK');
