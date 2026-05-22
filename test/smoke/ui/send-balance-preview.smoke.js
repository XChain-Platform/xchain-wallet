// Smoke for §21 — Step 3 — Send.jsx wires <BalanceChanges> on review.
//
// Source-level checks that the review stage now:
//   - imports BalanceChanges + uses simulateAction + balancesFromSdk
//   - fetches address balances on entering review and not before
//   - renders the section between the headline and the details list
//   - degrades gracefully on fetch error (preview still renders muted)
// Plus that the per-shell messaging modules expose getAddressBalances.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sendPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
const decoderIndex = join(wsRoot, 'packages', 'core', 'src', 'decoder', 'index.js');
const adapterPath = join(wsRoot, 'packages', 'core', 'src', 'decoder', 'balanceAdapter.js');
const popupMsg = join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js');
const webMsg = join(wsRoot, 'packages', 'web', 'src', 'messaging.js');

// --- 1. Decoder namespace re-exports the adapter ------------------------

const decIdx = readFileSync(decoderIndex, 'utf8');
assert.match(decIdx, /balancesFromSdk/, 'decoder/index.js re-exports balancesFromSdk');

// --- 2. balanceAdapter — basic semantic check ---------------------------

const adapter = await import(adapterPath);
assert.equal(typeof adapter.balancesFromSdk, 'function');

// 5,000,000 sats with divisibility 8 → '0.05'
{
    const out = adapter.balancesFromSdk({
        native: { tick: 'BTC', divisibility: 8, quantity: '5000000' },
        tokens: [
            { tick: 'MYTOKEN', divisibility: 0, quantity: '500' },
            { tick: 'XCP', divisibility: 8, quantity: '1200000000' },
        ],
    });
    const btc = out.find((r) => r.tick === 'BTC');
    assert.ok(btc.isCoin, 'native row marked isCoin');
    assert.equal(btc.amount, '0.05', 'sats scaled by divisibility');
    const my = out.find((r) => r.tick === 'MYTOKEN');
    assert.equal(my.amount, '500', 'divisibility=0 leaves the integer alone');
    assert.ok(!my.isCoin);
    const xcp = out.find((r) => r.tick === 'XCP');
    assert.equal(xcp.amount, '12', 'trailing zeros stripped');
}

// Empty / null shapes don't crash.
{
    assert.deepEqual(adapter.balancesFromSdk(null), []);
    assert.deepEqual(adapter.balancesFromSdk(undefined), []);
    assert.deepEqual(adapter.balancesFromSdk({}), []);
}

// Negative quantities preserved.
{
    const out = adapter.balancesFromSdk({
        native: { tick: 'BTC', divisibility: 8, quantity: '-1' },
    });
    assert.equal(out[0].amount, '-0.00000001');
}

// --- 3. Per-shell messaging exposes getAddressBalances ------------------

for (const path of [popupMsg, webMsg]) {
    const src = readFileSync(path, 'utf8');
    assert.match(
        src,
        /export function getAddressBalances\(/,
        `${path} exports getAddressBalances`,
    );
    assert.match(
        src,
        /sendMessage\('balances\.address'/,
        `${path} routes to balances.address host handler`,
    );
}

// --- 4. Send.jsx wiring -------------------------------------------------

const sendSrc = readFileSync(sendPath, 'utf8');

assert.match(sendSrc, /import \{ BalanceChanges \}/, 'imports BalanceChanges');
assert.match(sendSrc, /decoderLib\.simulateAction/, 'calls simulateAction');
assert.match(sendSrc, /decoderLib\.balancesFromSdk/, 'feeds balances through balancesFromSdk');
assert.match(
    sendSrc,
    /messaging\.getAddressBalances\(chainId, fromAddress\.address\)/,
    'fetches single-address balances against the source',
);

// State has the three lifecycle fields.
assert.match(sendSrc, /loading:\s*false[^,]*,\s*error:\s*null[^,]*,\s*sdkShape:\s*null/);
assert.match(sendSrc, /loading:\s*true[^,]*,\s*error:\s*null/);

// Effect runs in form + review stages (Step 4 added the form-stage
// fetch so Max + the Available hint can reference balance before
// review). Skips on submitting / done.
assert.match(
    sendSrc,
    /if \(stage !== 'review' && stage !== 'form'\) return undefined;/,
);

// Renders between the summary line and the details list. The JSX
// element starts with `<BalanceChanges\n` (a tag, not the inline
// comment that mentions <BalanceChanges>); search after the summary
// to skip over earlier mentions in JSDoc / comments.
const summaryIdx = sendSrc.indexOf('className={styles.summary}');
const balanceJsxIdx = sendSrc.indexOf('<BalanceChanges\n', summaryIdx);
const detailsIdx = sendSrc.indexOf('className={styles.detailsList}');
assert.ok(summaryIdx > 0 && balanceJsxIdx > 0 && detailsIdx > 0, 'all three blocks present');
assert.ok(
    summaryIdx < balanceJsxIdx && balanceJsxIdx < detailsIdx,
    'BalanceChanges sits between summary and details list',
);

// Loading + error props plumbed through (graceful degradation).
assert.match(sendSrc, /loading=\{previewBalances\.loading\}/);
assert.match(sendSrc, /error=\{previewBalances\.error\}/);

// Fee feeds in from the placeholder estimator (Step 4); the real
// §44.2 selector swaps the source later.
assert.match(sendSrc, /feeEstimate:\s*feeStr/);
assert.match(sendSrc, /feeEstimate\?\.coinAmount/, 'fee comes from estimateNativeSendFee');

console.log('send-balance-preview smoke OK');
