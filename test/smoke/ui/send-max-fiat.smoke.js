// Smoke for §29 Send/Receive — Step 4 — Send.jsx wires Max + fiat
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

assert.match(
    sendSrc,
    /import \{ estimateNativeSendFee \} from '\.\.\/\.\.\/flows\/feeEstimate\.js'/,
    'imports estimateNativeSendFee',
);
assert.match(
    sendSrc,
    /import \{ getFiatRate, coinToFiat, fiatToCoin \} from '\.\.\/\.\.\/flows\/priceLookup\.js'/,
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

assert.match(sendSrc, /fiatRate = useMemo/, 'fiat rate memoized');
assert.match(sendSrc, /amountMode/, 'amount-entry mode state');
assert.match(sendSrc, /fiatInput/, 'fiat-mode input state');
assert.match(sendSrc, /'native' \| 'fiat'/, 'mode union typed');

assert.match(sendSrc, /onToggleAmountMode = useCallback/, 'toggle callback');
assert.match(sendSrc, /onFiatInputChange = useCallback/, 'fiat input handler');
assert.match(
    sendSrc,
    /fiatToCoin\(value, fiatRate\)/,
    'fiat → coin conversion when typing in fiat mode',
);

// --- fiat preview hint ------------------------------------------------

assert.match(sendSrc, /fiatPreview = useMemo/, 'fiat preview memo');
assert.match(sendSrc, /placeholder rate/, 'placeholder badge present in copy');

// --- Max button -------------------------------------------------------

assert.match(sendSrc, /onMax = useCallback/, 'Max callback');
assert.match(
    sendSrc,
    /balanceNum - feeNum/,
    'native send subtracts fee from balance',
);
assert.match(sendSrc, /aria-label="Set max amount"/, 'Max button aria');
assert.match(sendSrc, /disabled=\{!sourceBalance\}/, 'Max disabled without balance');

// --- Available + fee hint --------------------------------------------

assert.match(sendSrc, /balanceHint/, 'balance hint class wired');
assert.match(
    sendSrc,
    /Available:/,
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
