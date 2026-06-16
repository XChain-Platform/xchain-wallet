// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 4 — IssueTokenForm watcher-mode branch.
//
// First action form to adopt the FOLLOWUP 5 pattern:
//   - useWalletMode hook for isWatcherMode derivation
//   - messaging.buildActionPsbtRequest for the encode-only submit path
//   - Shared <WatcherResultPanel> at the done stage when result.psbtHex
//     is set and there's no txid
//   - SignCredentials replaced by an explanatory hint at review stage
//   - Submit button label flips to "Create unsigned transaction"

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'IssueTokenForm.jsx'),
    'utf8',
);

// ─── 1. Imports ---------------------------------------------------

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

// ─── 2. Hook usage -----------------------------------------------

assert.match(
    formSrc,
    /const \{ isWatcherMode \} = useWalletMode\(\);/,
    'derives isWatcherMode via the shared hook',
);

// ─── 3. Submit handler -------------------------------------------

assert.match(
    formSrc,
    /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: 'ISSUE'/,
    'submit handler routes through buildActionPsbtRequest with action ISSUE in watcher mode',
);
assert.match(
    formSrc,
    /if \(isWatcherMode\) \{[\s\S]+?messaging\.buildActionPsbtRequest/,
    'isWatcherMode branch wins over isHwSource / password branches',
);
// Watcher-mode submit must not trip the password / HW gates.
assert.match(
    formSrc,
    /if \(!isWatcherMode && !isHwSource && password\.length === 0\) return;/,
    'password gate skipped in watcher mode',
);
assert.match(
    formSrc,
    /if \(!isWatcherMode && isHwSource && hwStatus !== 'available'\) return;/,
    'HW availability gate skipped in watcher mode',
);

// ─── 4. Done-stage WatcherResultPanel branch ---------------------

assert.match(
    formSrc,
    /if \(result\?\.psbtHex && !txid\) \{[\s\S]+?<WatcherResultPanel/,
    'done stage renders WatcherResultPanel when result.psbtHex is set',
);
assert.match(
    formSrc,
    /onBuildAnother=\{handleBuildAnother\}/,
    'WatcherResultPanel wired to handleBuildAnother',
);

// ─── 5. Review-stage hint replaces SignCredentials ---------------

assert.match(
    formSrc,
    /\{isWatcherMode \? \([\s\S]+?Watcher mode/,
    'review stage shows watcher-mode hint copy when in watcher mode',
);
assert.match(
    formSrc,
    /Create unsigned transaction/,
    'submit button reads "Create unsigned transaction" in watcher mode',
);

console.log('issue-watcher-mode smoke OK');
