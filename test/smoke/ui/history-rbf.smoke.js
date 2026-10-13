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
// Speed up + Cancel actions when the shell supplies the replacement call.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const histSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'History.jsx'),
    'utf8',
);
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

assert.match(
    histSrc,
    /const rbfDescriptor = chainRegistry\.get\(entry\.chainId\);\s*const replaceable = isEntryReplaceable\(entry, \{ descriptor: rbfDescriptor \}\);/,
    'DetailCard checks replaceability against the chain descriptor',
);
assert.match(
    histSrc,
    /if \(isReplaceCallAvailable\(messaging\) && replaceable\.ok && !entry\.pending\?\.replaced\)/,
    'RBF menu options require a shell replacement call and a replaceable entry',
);

// --- RbfActions component shape --------------------------------------

assert.match(histSrc, /async function runRbf\(strategy\)/, 'runRbf handler defined');
assert.match(histSrc, /useMessaging\(\)/, 'reads messaging from hook');
assert.match(
    histSrc,
    /replaceFromHistoryEntry\(\{ messaging, entry, strategy, walletId, descriptor: rbfDescriptor \}\)/,
    'flow invocation wires entry + strategy',
);
assert.match(histSrc, /Speed up/, 'speed-up button label');
assert.match(histSrc, /Cancel/, 'cancel button label');
assert.match(
    histSrc,
    /runRbf\('speedup'\)/,
    'speed-up button runs with speedup strategy',
);
assert.match(
    histSrc,
    /runRbf\('cancel'\)/,
    'cancel button runs with cancel strategy',
);

// --- error + done states -----------------------------------------------

// The flow's error text is written for developers, so every RBF failure the
// card shows goes through the helper and none reaches the screen raw.
assert.match(histSrc, /setRbfError\(rbfFailureMessage\(err,/, 'speed-up and cancel failures read in plain words');
assert.match(histSrc, /setRbfError\(rbfFailureMessage\(undoErr,/, 'undo failures read in plain words');
assert.doesNotMatch(
    histSrc,
    /setRbfError\(\s*(?:err|undoErr)\??\.message/,
    'no RBF failure shows the raw error message',
);
assert.match(histSrc, /role="alert"/, 'errors carry alert role');
assert.match(histSrc, /role="status"/, 'success carries status role');

// --- CSS hooks --------------------------------------------------------

for (const cls of ['rbfActions', 'rbfError', 'rbfDone']) {
    assert.match(histCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('history-rbf smoke OK');
