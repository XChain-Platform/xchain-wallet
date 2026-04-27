// Smoke for §44 Fee UX — Step 1 — Send.jsx wires the FeeSelector
// + per-tier feeEstimate flowing to the simulator + Max button.

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

// --- imports -----------------------------------------------------------

assert.match(sendSrc, /FeeSelector,/, 'FeeSelector imported from ui');
assert.match(
    sendSrc,
    /import \{[\s\S]*estimateNativeSendFee[\s\S]*estimateNativeSendFeeTiers[\s\S]*customFeeEstimate[\s\S]*\}/,
    'imports tier helpers',
);

// --- fee state ---------------------------------------------------------

assert.match(sendSrc, /feePick/, 'feePick state slot');
assert.match(sendSrc, /setFeePick/, 'feePick setter');
assert.match(sendSrc, /mode: 'normal'/, 'default mode is normal');

// --- tier + selected estimate memos -----------------------------------

assert.match(sendSrc, /feeTiers = useMemo/, 'tier memo');
assert.match(sendSrc, /estimateNativeSendFeeTiers\(/, 'tier helper invoked');

assert.match(sendSrc, /feeEstimate = useMemo/, 'selected estimate memo');
assert.match(
    sendSrc,
    /feePick\.mode === 'custom'/,
    'custom branch dispatches to customFeeEstimate',
);
assert.match(
    sendSrc,
    /customFeeEstimate\(\{[\s\S]*rate:\s*Number\(feePick\.customRate\)/,
    'custom rate piped to customFeeEstimate',
);
assert.match(
    sendSrc,
    /estimateNativeSendFee\(\{[\s\S]*speed:\s*feePick\.mode/,
    'tier branch passes selected speed',
);

// --- selector renders in the form -------------------------------------

const formIdx = sendSrc.indexOf('<FeeSelector');
assert.notEqual(formIdx, -1, 'FeeSelector renders in the form');
const formBlock = sendSrc.slice(formIdx, formIdx + 400);
assert.match(formBlock, /tiers=\{feeTiers\}/);
assert.match(formBlock, /value=\{feePick\}/);
assert.match(formBlock, /onChange=\{setFeePick\}/);
assert.match(
    formBlock,
    /placeholderBadge=\{feeEstimate\?\.source === 'static-placeholder'\}/,
    'placeholder badge surfaces while source is static',
);

console.log('send-fee-selector smoke OK');
