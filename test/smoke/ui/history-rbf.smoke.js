// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive, Step 6: History.jsx wires RBF
// Speed up + Cancel actions.

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
    /import \{[\s\S]*isEntryReplaceable[\s\S]*replaceFromHistoryEntry[\s\S]*RbfNotSupportedError[\s\S]*RbfInvalidEntryError[\s\S]*\} from '\.\.\/\.\.\/flows\/rbfReplace\.js'/,
    'imports the rbfReplace flow primitives',
);

// --- DetailCard wires the gate ----------------------------------------

assert.match(
    histSrc,
    /const replaceable = isEntryReplaceable\(entry\);/,
    'DetailCard checks replaceability',
);
assert.match(
    histSrc,
    /\{replaceable\.ok \? <RbfActions entry=\{entry\} \/> : null\}/,
    'RbfActions only render for replaceable entries',
);

// --- RbfActions component shape --------------------------------------

assert.match(histSrc, /function RbfActions\(\{ entry \}\)/, 'RbfActions component defined');
assert.match(histSrc, /useMessaging\(\)/, 'reads messaging from hook');
assert.match(
    histSrc,
    /replaceFromHistoryEntry\(\{[\s\S]*messaging,[\s\S]*entry,[\s\S]*strategy,/,
    'flow invocation wires entry + strategy',
);
assert.match(histSrc, /Speed up/, 'speed-up button label');
assert.match(histSrc, /Cancel/, 'cancel button label');
assert.match(
    histSrc,
    /run\('speedup'\)/,
    'speed-up button runs with speedup strategy',
);
assert.match(
    histSrc,
    /run\('cancel'\)/,
    'cancel button runs with cancel strategy',
);

// --- error + done states -----------------------------------------------

assert.match(histSrc, /RbfNotSupportedError/, 'distinguishes not-supported errors');
assert.match(histSrc, /RbfInvalidEntryError/, 'distinguishes invalid-entry errors');
assert.match(histSrc, /role="alert"/, 'errors carry alert role');
assert.match(histSrc, /role="status"/, 'success carries status role');

// --- CSS hooks --------------------------------------------------------

for (const cls of ['rbfActions', 'rbfError', 'rbfDone']) {
    assert.match(histCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('history-rbf smoke OK');
