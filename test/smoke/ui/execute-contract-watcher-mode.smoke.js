// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 20: ExecuteContractForm watcher-mode branch.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEnglishCopy } from '../_localized-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const rawFormSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'ExecuteContractForm.jsx'),
    'utf8',
);
const formSrc = withEnglishCopy(rawFormSrc);

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ ResultScreen \} from '\.\.\/components\/ResultScreen\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(formSrc, /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: 'EXECUTE'/);
assert.match(formSrc, /if \(result\?\.psbtHex && !txid\)[\s\S]{0,500}?<ResultScreen[\s\S]{0,200}?state="unsigned"/);
assert.match(
    rawFormSrc,
    /<ConfirmActionModal[\s\S]{0,1200}?credentials=\{<p[\s\S]{0,180}?watcherBuildsUnsigned/,
    'watcher guidance lives on the Confirm Standard review',
);
assert.doesNotMatch(formSrc, /Create Transaction for Signing/, 'old review action label is retired');
console.log('execute-contract-watcher-mode smoke OK');
