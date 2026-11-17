// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive, Step 6: History.jsx only wires RBF
// Speed up + Cancel actions when the shell supplies the replacement call and
// the active wallet can sign.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const histSrc = ['History', 'HistoryDetailCard', 'HistoryEntryRow', 'HistoryShared']
    .map((n) => readFileSync(join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', `${n}.jsx`), 'utf8'))
    .join('\n');
const histCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'History.module.css'),
    'utf8',
);

// --- imports -----------------------------------------------------------

assert.match(
    histSrc,
    /import \{[\s\S]*isEntryReplaceable[\s\S]*isReplaceCallAvailable[\s\S]*replaceFromHistoryEntry[\s\S]*\} from '\.\.\/\.\.\/flows\/rbfReplace\.js'/,
    'imports the rbfReplace flow primitives',
);
assert.match(
    histSrc,
    /import \{ rbfFailureMessage \} from '\.\.\/utils\/rbfFailureMessage\.js'/,
    'imports the plain-language RBF failure helper',
);

// --- DetailCard wires the gate ----------------------------------------

// The gate and the run live in useRbfReplace, which the inline card (its
// Actions tab) and the Action detail page (Speed Up under the status bar, Cancel
// Transaction in the header menu) both call.
assert.match(
    histSrc,
    /const descriptor = chainRegistry\.get\(entry\?\.chainId\);\s*const replaceable = entry \? isEntryReplaceable\(entry, \{ descriptor \}\) : \{ ok: false \};/,
    'useRbfReplace checks replaceability against the chain descriptor',
);
assert.match(
    histSrc,
    /const available = Boolean\(walletModeReady && !isWatcherMode && isReplaceCallAvailable\(messaging\)\s*&& replaceable\.ok && !entry\?\.pending\?\.replaced\);/,
    'Speed up and Cancel require a known signing mode, a shell replacement call, and a replaceable entry',
);
assert.match(histSrc, /if \(rbf\.available\) \{/, 'the inline card offers them only when the hook does');

// --- RbfActions component shape --------------------------------------

assert.match(histSrc, /async function run\(strategy\)/, 'the hook runs one strategy at a time');
assert.match(histSrc, /useMessaging\(\)/, 'reads messaging from hook');
assert.match(
    histSrc,
    /replaceFromHistoryEntry\(\{ messaging, entry, strategy, walletId, descriptor \}\)/,
    'flow invocation wires entry + strategy',
);
assert.match(histSrc, /Speed up/, 'speed-up button label');
assert.match(histSrc, /Cancel/, 'cancel button label');
// They are rows of the card's Actions tab (G101), Cancel in the danger tone.
assert.match(
    histSrc,
    /onClick: \(\) => rbf\.run\('speedup'\)/,
    'speed-up row runs with speedup strategy',
);
assert.match(
    histSrc,
    /tone: 'danger',[\s\S]{0,240}?onClick: \(\) => rbf\.run\('cancel'\)/,
    'cancel row runs with cancel strategy in the danger tone',
);

// --- error + done states -----------------------------------------------

// The flow's error text is written for developers, so every RBF failure the
// card shows goes through the helper and none reaches the screen raw.
assert.match(histSrc, /setError\(rbfFailureMessage\(err,/, 'speed-up and cancel failures read in plain words');
assert.match(histSrc, /setError\(rbfFailureMessage\(undoErr,/, 'undo failures read in plain words');
assert.doesNotMatch(
    histSrc,
    /set(?:Rbf)?Error\(\s*(?:err|undoErr)\??\.message/,
    'no RBF failure shows the raw error message',
);
assert.match(histSrc, /role="alert"/, 'errors carry alert role');
assert.match(histSrc, /role="status"/, 'success carries status role');

// --- CSS hooks --------------------------------------------------------

for (const cls of ['rbfError', 'rbfDone']) {
    assert.match(histCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('history-rbf smoke OK');
