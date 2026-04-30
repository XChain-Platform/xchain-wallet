// Smoke for §25.2 / Cluster J FOLLOWUP 1 — synthesized fixture data
// for the demo wallet (balances + history).
//
// Pins:
//   - flows/demoFixtures.js exports synthesizeDemoBalances,
//     synthesizeDemoHistory, synthesizeDemoLinks.
//   - synthesizeDemoBalances mirrors getWalletBalances' shape — first
//     address per chain gets a non-zero native + assets, additional
//     addresses get zero balances so the row still renders.
//   - synthesizeDemoHistory returns 2 entries for known chains, [] for
//     unknown chains.
//   - synthesizeDemoLinks returns []. (Cross-chain LINK fabrication is
//     deferred; History's .catch(() => []) path already accepts an
//     empty list.)
//   - Home.jsx reads isDemoWallet(walletId) and routes through
//     synthesizeDemoBalances when true.
//   - History.jsx does the same with synthesizeDemoHistory + Links.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    synthesizeDemoBalances,
    synthesizeDemoHistory,
    synthesizeDemoLinks,
} from '../../../packages/core/src/flows/demoFixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const homeSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx'),
    'utf8',
);
const historySrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'History.jsx'),
    'utf8',
);
const flowsIndex = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);

// ─── 1. exports + flows/index re-exports ───────────────────────────────

assert.equal(typeof synthesizeDemoBalances, 'function', 'synthesizeDemoBalances exported');
assert.equal(typeof synthesizeDemoHistory, 'function', 'synthesizeDemoHistory exported');
assert.equal(typeof synthesizeDemoLinks, 'function', 'synthesizeDemoLinks exported');
assert.match(
    flowsIndex,
    /synthesizeDemoBalances,[\s\S]+?synthesizeDemoHistory,[\s\S]+?synthesizeDemoLinks/,
    'flows/index.js re-exports the three fixture builders',
);

// ─── 2. synthesizeDemoBalances behavior ────────────────────────────────

{
    const byChain = {
        'bitcoin-mainnet': [
            { address: 'bc1q...0', label: 'first', addressType: 'p2wpkh', derivationPath: "m/84'/0'/0'/0/0" },
            { address: 'bc1q...1', label: 'second', addressType: 'p2wpkh', derivationPath: "m/84'/0'/0'/0/1" },
        ],
        'litecoin-mainnet': [
            { address: 'ltc1q...0', label: 'first', addressType: 'p2wpkh', derivationPath: "m/84'/2'/0'/0/0" },
        ],
    };
    const out = synthesizeDemoBalances(byChain);
    assert.deepEqual(Object.keys(out).sort(), ['bitcoin-mainnet', 'litecoin-mainnet'].sort(),
        'keys mirror input chains');

    const btcEntries = out['bitcoin-mainnet'];
    assert.equal(btcEntries.length, 2, 'all addresses surfaced');
    assert.equal(btcEntries[0].address, 'bc1q...0', 'first entry preserves address');
    assert.equal(btcEntries[0].error, null, 'no error');
    assert.ok(btcEntries[0].balances?.native, 'first BTC entry has native balance');
    assert.equal(btcEntries[0].balances.native.asset, 'BTC');
    assert.ok(Number(btcEntries[0].balances.native.quantity) > 0,
        'first BTC entry has non-zero native quantity');
    assert.ok(Array.isArray(btcEntries[0].balances.assets));
    assert.ok(btcEntries[0].balances.assets.length > 0, 'first BTC entry has token assets');

    // Second address gets zero balances so the row still renders.
    assert.equal(btcEntries[1].balances?.native?.quantity, '0',
        'second BTC entry has zero native quantity');
    assert.equal(btcEntries[1].balances?.assets?.length ?? 0, 0,
        'second BTC entry has no token assets');

    const ltcEntries = out['litecoin-mainnet'];
    assert.equal(ltcEntries[0].balances.native.asset, 'LTC');
    assert.ok(Number(ltcEntries[0].balances.native.quantity) > 0,
        'LTC native balance is non-zero');
}

// Empty input → empty output.
assert.deepEqual(synthesizeDemoBalances({}), {}, 'empty input returns empty');
assert.deepEqual(synthesizeDemoBalances(null), {}, 'null input returns empty');

// Unknown chain still produces entries (with null balances) so the
// shape is consistent — but we'll just verify it doesn't throw.
{
    const out = synthesizeDemoBalances({ 'imaginary-chain': [{ address: 'x', label: '', addressType: 'p2pkh', derivationPath: null }] });
    assert.ok(out['imaginary-chain'], 'unknown chains still surface');
    assert.equal(out['imaginary-chain'][0].address, 'x');
}

// ─── 3. synthesizeDemoHistory behavior ─────────────────────────────────

{
    const entries = synthesizeDemoHistory('bitcoin-mainnet', 'bc1q...0', { now: 1_700_000_000_000 });
    assert.equal(entries.length, 2, 'two history entries for known chains');
    assert.equal(entries[0].action, 'SEND', 'first entry is incoming SEND');
    assert.equal(entries[0].params.destination, 'bc1q...0',
        'incoming SEND destinations the user');
    assert.equal(entries[0].blockIndex, null,
        'first entry is pending — exercises the timeline pending state');
    assert.equal(entries[1].action, 'ISSUE', 'second entry is ISSUE');
    assert.equal(entries[1].params.source, 'bc1q...0', 'ISSUE source is the user');
    assert.ok(entries[1].blockIndex && Number.isInteger(entries[1].blockIndex),
        'ISSUE has a confirmed blockIndex');
    assert.ok(entries[0].timestamp > entries[1].timestamp,
        'incoming SEND is more recent than ISSUE');
}

// Unknown chain → empty history (no fixture available).
assert.deepEqual(
    synthesizeDemoHistory('imaginary-chain', 'whatever'),
    [],
    'unknown chain returns no entries',
);

// Bad address → empty.
assert.deepEqual(synthesizeDemoHistory('bitcoin-mainnet', ''), []);
assert.deepEqual(synthesizeDemoHistory('bitcoin-mainnet', null), []);

// synthesizeDemoLinks always returns [].
assert.deepEqual(synthesizeDemoLinks(), []);

// ─── 4. Home.jsx wiring ────────────────────────────────────────────────

assert.match(
    homeSrc,
    /flowsLib\.isDemoWallet\(walletId\)[\s\S]+?messaging\.getAddressesByChain/,
    'Home checks isDemoWallet then fetches address list',
);
assert.match(
    homeSrc,
    /flowsLib\.synthesizeDemoBalances\(byChain\)/,
    'Home synthesizes balances when demo',
);

// ─── 5. History.jsx wiring ─────────────────────────────────────────────

assert.match(
    historySrc,
    /const isDemo = flowsLib\.isDemoWallet\(walletId\)/,
    'History tracks isDemo at the start of the fetch loop',
);
assert.match(
    historySrc,
    /flowsLib\.synthesizeDemoHistory\(cid, a\.address\)/,
    'History uses synthesizeDemoHistory for demo wallet',
);
assert.match(
    historySrc,
    /flowsLib\.synthesizeDemoLinks\(\)/,
    'History uses synthesizeDemoLinks for demo wallet',
);

console.log('demo-wallet-fixtures smoke OK');
