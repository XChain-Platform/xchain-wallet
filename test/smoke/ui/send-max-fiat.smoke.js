// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive, Step 4; Send.jsx wires Max + fiat
// toggle + real fee estimate into the simulator.

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

// --- imports ----------------------------------------------------------

// Step 4 of §29 imported the single helper; Step 1 of §44 expanded
// the import to include the tier + custom helpers.
assert.match(
    sendSrc,
    /import \{[\s\S]*estimateNativeSendFee[\s\S]*\} from '\.\.\/\.\.\/flows\/feeEstimate\.js'/,
    'imports estimateNativeSendFee (and siblings)',
);
assert.match(
    sendSrc,
    /import \{ coinToFiat, fiatToCoin \} from '\.\.\/\.\.\/flows\/priceLookup\.js'/,
    'imports priceLookup helpers',
);

// --- feeEstimate piped into simulator ---------------------------------

assert.match(sendSrc, /feeEstimate = useMemo/, 'feeEstimate is memoized');
assert.match(sendSrc, /estimateNativeSendFee\(/, 'fee estimate flow invoked');
assert.match(
    sendSrc,
    /feeEstimate:\s*feeStr/,
    'simulator gets the real fee instead of "0"',
);
assert.doesNotMatch(
    sendSrc,
    /feeEstimate:\s*'0'/,
    'no leftover hardcoded "0" feeEstimate',
);

// --- fiat rate + toggle state -----------------------------------------

assert.match(sendSrc, /fiatRate = useFiatRate\(/, 'fiat rate via oracle-backed hook ');
assert.match(sendSrc, /amountInputMode/, 'amount-entry mode state');
assert.match(sendSrc, /fiatAmount/, 'fiat-mode input state');
assert.match(sendSrc, /'coin' \| 'fiat'/, 'mode union typed');

assert.match(sendSrc, /toggleAmountInputMode = useCallback/, 'toggle callback');
assert.match(sendSrc, /onAmountFieldChange = useCallback/, 'fiat input handler');
assert.match(
    sendSrc,
    /fiatToCoin\(stripped, fiatRate\)/,
    'fiat → coin conversion when typing in fiat mode',
);

// --- fiat preview hint ------------------------------------------------

assert.match(sendSrc, /coinToFiat\(.*fiatRate\)/, 'fiat preview via coinToFiat');

// --- Max button -------------------------------------------------------

assert.match(sendSrc, /onMax = useCallback/, 'Max callback');
assert.match(
    sendSrc,
    /balanceNum - feeNum/,
    'native send subtracts fee from balance',
);
assert.match(sendSrc, /maxDisabled=\{!sourceBalance\}/, 'Max disabled without balance prop forwarded to AmountField');

// --- Available + fee hint --------------------------------------------

assert.match(sendCss, /\.balanceHint\s*\{/, 'balance hint CSS class defined');
assert.match(
    sendSrc,
    /available/,
    'balance hint copy present',
);

// --- form-stage balance fetch ----------------------------------------

assert.match(
    sendSrc,
    /stage !== 'review' && stage !== 'form'/,
    'balance fetch runs in form stage too (so Max can use it)',
);

// --- CSS hooks -------------------------------------------------------

for (const cls of ['amountRow', 'amountField', 'amountActions', 'amountButton', 'balanceHint']) {
    assert.match(sendCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('send-max-fiat smoke OK');
