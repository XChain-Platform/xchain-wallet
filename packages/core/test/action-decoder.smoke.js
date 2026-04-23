// Smoke test for Batch 4 piece 14 (plain-English action decoder + sign screens).
//
// Covers:
//   1. Pure decoder — SEND / SWEEP produce human sentences; memos with
//      `|` or `;` surface as warnings; empty destinations / non-positive
//      amounts surface as warnings; unknown actions fall back to a
//      generic summary + "no plain-English" warning.
//   2. Static wiring — core/src/index.js re-exports the decoder
//      namespace; the extension's SignApproval.jsx calls
//      `decoder.decodeAction` for the signAction kind and renders the
//      warnings array.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    decoder as decoderLib,
    registry as registryLib,
} from '../../core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Pure decoder --------------------------------------------------

const chainRegistry = registryLib.defaultRegistry();

// 1a. Happy SEND on bitcoin-mainnet.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: { TICK: 'MYTOKEN', AMOUNT: '100', DESTINATION: 'bc1qxyz' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Send 100 MYTOKEN on Bitcoin to bc1qxyz');
    assert.deepEqual(
        d.details,
        [
            { label: 'Asset', value: 'MYTOKEN' },
            { label: 'Amount', value: '100' },
            { label: 'Destination', value: 'bc1qxyz' },
        ],
    );
    assert.equal(d.warnings.length, 0, 'happy SEND has no warnings');
}

// 1b. SEND with memo containing `|` triggers a warning.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: {
            TICK: 'BTC',
            AMOUNT: '1',
            DESTINATION: 'bc1q',
            MEMO: 'hi|there',
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(
        d.warnings.some((w) => /\|/.test(w)),
        'memo with pipe flagged as warning',
    );
    // Memo row included in details when non-empty.
    assert.ok(d.details.some((r) => r.label === 'Memo'));
}

// 1c. SEND with zero amount + empty destination → two warnings.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: { TICK: 'BTC', AMOUNT: '0', DESTINATION: '' },
    });
    assert.ok(d.warnings.some((w) => /positive/i.test(w)), 'zero amount flagged');
    assert.ok(d.warnings.some((w) => /destination is empty/i.test(w)), 'empty dest flagged');
}

// 1d. SWEEP always warns about moving every balance.
{
    const d = decoderLib.decodeAction({
        action: 'SWEEP',
        params: { DESTINATION: 'bc1qrecip' },
        chainId: 'dogecoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Sweep all assets on Dogecoin to bc1qrecip');
    assert.ok(
        d.warnings.some((w) => /sweep moves every balance/i.test(w)),
        'SWEEP has the blanket-balance warning',
    );
}

// 1e. Unknown action falls back with the "no plain-English" warning.
{
    const d = decoderLib.decodeAction({
        action: 'ISSUE',
        params: { ASSET: 'NEWCOIN', QTY: '1000000' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Sign ISSUE on Bitcoin/);
    assert.ok(
        d.warnings.some((w) => /no plain-english summary is available/i.test(w)),
        'fallback surfaces the "not decoded" warning',
    );
    assert.equal(d.details.length, 2, 'fallback pretty-prints every param');
}

// 1f. Missing chain registry still yields a sensible summary.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'bc1q' },
    });
    assert.equal(d.summary, 'Send 1 BTC to bc1q');
}

// 1g. Null params shouldn't crash.
{
    const d = decoderLib.decodeAction({ action: 'SEND' });
    assert.equal(typeof d.summary, 'string');
    assert.ok(Array.isArray(d.details));
    assert.ok(Array.isArray(d.warnings));
}

// --- 2. Static wiring -------------------------------------------------

const coreIdx = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'index.js'),
    'utf8',
);
assert.ok(
    coreIdx.includes("export * as decoder from './decoder/index.js'"),
    'core/src/index.js re-exports the decoder namespace',
);

const sign = readFileSync(
    join(ext, 'src', 'approval', 'kinds', 'SignApproval.jsx'),
    'utf8',
);
assert.ok(
    /decoder as decoderLib/.test(sign),
    'SignApproval.jsx imports decoderLib from core',
);
assert.ok(
    /decoderLib\.decodeAction/.test(sign),
    'SignApproval.jsx calls decoderLib.decodeAction for signAction',
);
assert.ok(
    /decoded\.warnings/.test(sign),
    'SignApproval.jsx renders the warnings array',
);
assert.ok(
    /decoded\.details/.test(sign),
    'SignApproval.jsx renders the details array',
);

const signCss = readFileSync(
    join(ext, 'src', 'approval', 'kinds', 'SignApproval.module.css'),
    'utf8',
);
assert.ok(signCss.includes('.warnings'), 'warnings block has a style');
assert.ok(signCss.includes('.detailsList'), 'details list has a style');

console.log(
    'OK — action decoder smoke (7 decoder cases covering SEND, SWEEP, fallback, warnings, null params + SignApproval wiring)',
);
