// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive — Step 3 — Send.jsx wires the test-send
// protection gate.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);
const sendCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.module.css'),
    'utf8',
);

// --- imports + setup ---------------------------------------------------

assert.match(
    sendSrc,
    /import \{ useSettings \} from '\.\.\/hooks\/useSettings\.js'/,
    'imports useSettings to read the threshold',
);
assert.match(
    sendSrc,
    /import \{ checkRecipientNovelty \} from '\.\.\/\.\.\/flows\/recipientNovelty\.js'/,
    'imports recipientNovelty helper',
);
assert.match(
    sendSrc,
    /const \{ settings \} = useSettings\(\)/,
    'hook called',
);

// --- session-scoped acknowledgement set --------------------------------

assert.match(sendSrc, /testedThisSession/, 'session set state');
assert.match(sendSrc, /markTested\b/, 'markTested setter');

// --- gate computation --------------------------------------------------

assert.match(sendSrc, /testSendGate = useMemo/, 'gate is memoized');
assert.match(
    sendSrc,
    /settings\?\.grace\?\.testSendThresholdSats/,
    'gate reads the grace.testSendThresholdSats threshold',
);
assert.match(
    sendSrc,
    /tick\.trim\(\)\.toUpperCase\(\) !== nativeTicker/,
    'gate skips non-native sends',
);
assert.match(
    sendSrc,
    /Math\.floor\(amt \* 1e8\)/,
    'amount converted to sats',
);
assert.match(
    sendSrc,
    /checkRecipientNovelty\(/,
    'novelty check invoked',
);
assert.match(
    sendSrc,
    /testedThisSession\.has\(dest\)/,
    'gate suppressed when address acknowledged',
);

// --- "Send small test" reduces amount + returns to form ----------------

assert.match(sendSrc, /onSendSmallTest = useCallback/, 'small-test handler memoized');
assert.match(sendSrc, /amt \* 0\.01/, '1% reduction');
assert.match(sendSrc, /setStage\('form'\)/, 'returns to form');

// --- gate UI -----------------------------------------------------------

assert.match(sendSrc, /styles\.testSendGate/, 'banner uses testSendGate class');
assert.match(sendSrc, /Send a small test first/i, 'small-test button copy');
assert.match(sendSrc, /I've verified — continue/, 'continue button copy');
assert.match(
    sendSrc,
    /onClick=\{onSendSmallTest\}/,
    'small-test button wired',
);
assert.match(
    sendSrc,
    /markTested\(toAddress\.trim\(\)\)/,
    'continue button records ack',
);

// --- submit disable -----------------------------------------------------

assert.match(
    sendSrc,
    /!!testSendGate\s*\|\|/,
    'submit disabled while gate active',
);

// --- CSS hooks ----------------------------------------------------------

for (const cls of ['testSendGate', 'testSendTitle', 'testSendBody', 'testSendActions']) {
    assert.match(sendCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('send-test-send-gate smoke OK');
