// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node
//
// Unit: the testnet e2e harness (test/e2e/fixtures/testnet.js), offline.
//
// Node, not the suite's jsdom default: the harness runs inside Playwright's
// Node process and signs with the SDK's secp256k1 binding, whose self-test
// refuses jsdom's foreign Uint8Array realm ("ecc library invalid").
//
// The states this harness exists to refuse (a halted replica, a foreign UTXO,
// a key that does not own the treasury) cannot be produced on demand against a
// public chain, and the one thing it must never do (reach for a miner, a
// clock, ssh, docker or a database) leaves no trace when it does not happen.
// So the venue is a test double here, the treasury is a fixture key derived
// from a public label, and the proof of "never" is a venue whose forbidden
// members throw the moment they are touched.

import { Readable } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import {
    TESTNET_COIN,
    TESTNET_NETWORK,
    buildTreasuryFunding,
    checkTestnetVenue,
    fundFromTreasury,
    outputScriptHex,
    selectTreasuryInputs,
    testnetVerdict,
    waitForActivationHeight,
    waitForTokenBalance,
    waitForValidAction,
} from '../../e2e/fixtures/testnet.js';

// A throwaway testnet key from a FIXED scalar (sha256 of the label below), so
// the address is a real vector this file recomputes rather than a pair that
// only ever agrees with itself. Unfunded, public, worthless by construction.
const TREASURY = Object.freeze({
    wif: 'cS9nRNmyK8RA5QC7MQAAErJSgR5kmD7mRjpn1TaiDnLqFn4jj3SF',
    address: 'tb1qz2qzsfp5g3g2ez6k4z4x56vuzs3uh3hehhq469',
});
// sha256('xchain-wallet testnet harness fixture stranger'): a different key,
// whose address the mismatch cases declare.
const STRANGER_ADDRESS = 'tb1qzz55z44a8g0er7wtr4ylk74wwcxpve3z63e0tn';
// The regtest fixture's nobody's-key destination (hash160 d8eba5d7...cf25),
// re-encoded under the testnet HRP.
const DESTINATION = 'tb1qmr46t4ca5wh35k6mczdzrkepqw2d8ne9knscsq';

const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
const TXID_C = 'c'.repeat(64);
const TXID_STAKE = 'd'.repeat(64);

const NOW_SEC = 1_800_000_000;
const now = () => NOW_SEC * 1000;
const noSleep = () => Promise.resolve();

/** A clock that moves a second per read, so a poll loop that never accepts still meets its deadline. */
function tickingClock() {
    let t = NOW_SEC * 1000;
    return () => (t += 1000);
}

function healthyStatus(overrides = {}) {
    return {
        decoder_health: { [TESTNET_COIN]: 'healthy' },
        replica_halted: { [TESTNET_COIN]: false },
        stale: { [TESTNET_COIN]: false },
        chain_lag_blocks: { [TESTNET_COIN]: 0 },
        chain_tip: { [TESTNET_COIN]: 2_900_100 },
        last_block: { [TESTNET_COIN]: 2_900_100 },
        last_block_time: { [TESTNET_COIN]: NOW_SEC - 600 },
        tip_age_seconds: { [TESTNET_COIN]: 600 },
        ...overrides,
    };
}

const PRICED_QUOTE = { status: 'valid', coinUsdPrice: '60000.00000000', xchainUsdPrice: '2.00000000', oracleRound: 41 };

function utxo(txid, value, { confirmations = 3, address = TREASURY.address, vout = 0 } = {}) {
    return { txid, vout, value: String(value), confirmations, scriptPubKey: outputScriptHex(address) };
}

const FORBIDDEN = ['minerRpc', 'generateBlocks', 'sendFunds', 'setMockTime', 'setmocktime', 'healVenueClock',
    'ssh', 'runInIndexer', 'dockerExec', 'db', 'query', 'seedPrices'];

/**
 * A venue whose read-only members answer and whose forbidden members THROW,
 * wrapped in a Proxy that records every member the harness touched.
 */
function guardedVenue(reads) {
    const touched = new Set();
    const target = { ...reads };
    for (const name of FORBIDDEN) {
        target[name] = vi.fn(() => { throw new Error(`${name} must never be invoked on testnet`); });
    }
    const proxy = new Proxy(target, {
        get(obj, prop) {
            // `then` is what an `await` asks any object for; it is not a venue call.
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            touched.add(prop);
            if (!(prop in obj)) throw new Error(`the harness reached for venue.${prop}, which does not exist`);
            return obj[prop];
        },
    });
    return { venue: proxy, touched, target };
}

function stdinOf(object) {
    return Readable.from([JSON.stringify(object)]);
}

describe('testnet harness: venue fitness', () => {
    it('accepts a healthy venue and reports what the run starts against', async () => {
        const { venue, touched } = guardedVenue({
            status: vi.fn(async () => healthyStatus()),
            feeQuote: vi.fn(async () => PRICED_QUOTE),
        });
        const report = await checkTestnetVenue(venue, { now });
        expect(report).toMatchObject({ tip: 2_900_100, indexed: 2_900_100, tipAgeSeconds: 600 });
        expect(report.price).toMatchObject({ usable: true, xchainUsdPrice: '2.00000000', oracleRound: 41 });
        // The probe's source is a fresh testnet address, not a literal.
        const quoted = venue.feeQuote.mock.calls[0][0];
        expect(quoted).toMatchObject({ action: 'MINT', params: '0|XCHAIN|1' });
        expect(quoted.source).toMatch(/^tb1q/);
        expect([...touched]).toEqual(['status', 'feeQuote']);
    });

    it('refuses a stale, halted or lagging venue, each by name', async () => {
        expect(testnetVerdict(healthyStatus(), TESTNET_COIN, { now })).toBeNull();
        expect(testnetVerdict(healthyStatus({ stale: { [TESTNET_COIN]: true } }), TESTNET_COIN, { now }))
            .toMatch(/STALE/);
        expect(testnetVerdict(healthyStatus({ replica_halted: { [TESTNET_COIN]: true } }), TESTNET_COIN, { now }))
            .toMatch(/HALTED/);
        expect(testnetVerdict(healthyStatus({ chain_lag_blocks: { [TESTNET_COIN]: 7 } }), TESTNET_COIN, { now }))
            .toMatch(/7 blocks behind/);
        expect(testnetVerdict(healthyStatus({ last_block: { [TESTNET_COIN]: 2_900_000 } }), TESTNET_COIN, { now }))
            .toMatch(/WEDGED/);
        // The explorer's own flag missing, the age ceiling still catches a tip four hours old.
        const old = healthyStatus({ last_block_time: { [TESTNET_COIN]: NOW_SEC - 4 * 3600 } });
        delete old.stale;
        expect(testnetVerdict(old, TESTNET_COIN, { now })).toMatch(/14400s old/);

        const { venue } = guardedVenue({
            status: vi.fn(async () => healthyStatus({ chain_lag_blocks: { [TESTNET_COIN]: 7 } })),
            feeQuote: vi.fn(async () => PRICED_QUOTE),
        });
        await expect(checkTestnetVenue(venue, { now })).rejects.toThrow(/7 blocks behind/);
        expect(venue.feeQuote).not.toHaveBeenCalled();
    });
});

const treasuryScript = outputScriptHex(TREASURY.address);

describe('testnet harness: treasury inputs and the key that spends them', () => {
    it('excludes unconfirmed inputs from selection', () => {
        const utxos = [
            utxo(TXID_A, 50_000, { confirmations: 0 }),
            utxo(TXID_B, 30_000, { confirmations: 1 }),
            utxo(TXID_C, 20_000, { confirmations: 12 }),
        ];
        const picked = selectTreasuryInputs({ utxos, treasuryScript, sendSats: 40_000 });
        expect(picked.inputs.map((u) => u.txid)).toEqual([TXID_B, TXID_C]);
        expect(picked.total).toBe(50_000);
        // Only the mempool row would cover it: still refused, never spent.
        expect(() => selectTreasuryInputs({ utxos: [utxos[0]], treasuryScript, sendSats: 40_000 }))
            .toThrow(/INSUFFICIENT VALUE/);
    });

    it('refuses a WIF that does not derive the declared address, before touching a UTXO', async () => {
        const broadcast = vi.fn();
        const { venue } = guardedVenue({
            utxos: vi.fn(async () => ({ utxos: [utxo(TXID_A, 100_000, { address: STRANGER_ADDRESS })] })),
            broadcast,
        });
        await expect(fundFromTreasury({
            destination: DESTINATION, sendSats: 10_000, venue,
            stdin: stdinOf({ wif: TREASURY.wif, address: STRANGER_ADDRESS }), log: () => {},
        })).rejects.toThrow(/KEY\/ADDRESS MISMATCH/);
        expect(broadcast).not.toHaveBeenCalled();
        // Same refusal with no venue at all: the check precedes selection.
        expect(() => buildTreasuryFunding({
            treasury: { wif: TREASURY.wif, address: STRANGER_ADDRESS }, utxos: [], destination: DESTINATION, sendSats: 10_000,
        })).toThrow(/KEY\/ADDRESS MISMATCH/);
    });

    it('refuses a confirmed input whose script pays someone else', async () => {
        const broadcast = vi.fn();
        const { venue } = guardedVenue({
            utxos: vi.fn(async () => ({ utxos: [
                utxo(TXID_A, 100_000),
                utxo(TXID_B, 100_000, { address: STRANGER_ADDRESS }),
            ] })),
            broadcast,
        });
        await expect(fundFromTreasury({
            destination: DESTINATION, sendSats: 10_000, venue, stdin: stdinOf(TREASURY), log: () => {},
        })).rejects.toThrow(/INPUT SCRIPT MISMATCH/);
        expect(broadcast).not.toHaveBeenCalled();
    });
});

describe('testnet harness: value, fee and change', () => {
    it('refuses insufficient value before any broadcast', async () => {
        const broadcast = vi.fn();
        const { venue } = guardedVenue({
            utxos: vi.fn(async () => ({ utxos: [utxo(TXID_A, 5_000), utxo(TXID_B, 4_000)] })),
            broadcast,
        });
        await expect(fundFromTreasury({
            destination: DESTINATION, sendSats: 10_000, venue, stdin: stdinOf(TREASURY), log: () => {},
        })).rejects.toThrow(/INSUFFICIENT VALUE: the treasury holds 9000 confirmed sats/);
        expect(broadcast).not.toHaveBeenCalled();
        // And with no destination the treasury is never even read.
        const stdin = stdinOf(TREASURY);
        const consumed = vi.spyOn(stdin, 'on');
        await expect(fundFromTreasury({ destination: undefined, sendSats: 10_000, venue, stdin }))
            .rejects.toThrow(/no testnet destination/);
        expect(consumed).not.toHaveBeenCalled();
    });

    it('returns dust-safe change to the treasury and folds dust into the fee', () => {
        const withChange = buildTreasuryFunding({
            treasury: TREASURY, utxos: [utxo(TXID_A, 20_000)], destination: DESTINATION, sendSats: 10_000,
        });
        // One input, two outputs at 2 sat/vB: ceil((11 + 68 + 62) * 2) = 282.
        expect(withChange).toMatchObject({ fee: 282, change: 9_718, inputs: 1 });
        const tx = bitcoin.Transaction.fromHex(withChange.txHex);
        expect(tx.getId()).toBe(withChange.txid);
        expect(tx.ins).toHaveLength(1);
        expect(tx.outs.map((o) => [o.script.toString('hex'), o.value])).toEqual([
            [outputScriptHex(DESTINATION), 10_000],
            [treasuryScript, 9_718],
        ]);
        expect(bitcoin.address.fromOutputScript(tx.outs[1].script, TESTNET_NETWORK)).toBe(TREASURY.address);

        const dusty = buildTreasuryFunding({
            treasury: TREASURY, utxos: [utxo(TXID_A, 10_500)], destination: DESTINATION, sendSats: 10_000,
        });
        expect(dusty).toMatchObject({ fee: 500, change: 0 });
        const dustyTx = bitcoin.Transaction.fromHex(dusty.txHex);
        expect(dustyTx.outs).toHaveLength(1);
        expect(dustyTx.outs[0].value).toBe(10_000);
    });
});

describe('testnet harness: the whole healthy path never mines, moves a clock, shells out or reads a DB', () => {
    it('funds, waits and judges through reads and one broadcast only', async () => {
        const balances = vi.fn()
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValue({ data: [{ tick: 'XCHAIN', amount: '300' }] });
        const status = vi.fn()
            .mockResolvedValueOnce(healthyStatus())
            .mockResolvedValueOnce(healthyStatus({ last_block: { [TESTNET_COIN]: 2_900_104 } }))
            .mockResolvedValue(healthyStatus({ last_block: { [TESTNET_COIN]: 2_900_107 }, chain_tip: { [TESTNET_COIN]: 2_900_107 } }));
        const broadcast = vi.fn(async () => ({ txid: TXID_C }));
        const { venue, touched, target } = guardedVenue({
            status,
            feeQuote: vi.fn(async () => PRICED_QUOTE),
            utxos: vi.fn(async () => ({ utxos: [utxo(TXID_A, 50_000), utxo(TXID_B, 1_000, { confirmations: 0 })] })),
            broadcast,
            balances,
            actions: vi.fn(async () => ({ data: [{ tx_hash: TXID_STAKE, action_index: 9 }] })),
            action: vi.fn(async () => ({ action_index: 9, action: 'STAKE', status: 'valid', activation_block: 2_900_106 })),
        });
        const log = vi.fn();
        const clock = tickingClock();

        await checkTestnetVenue(venue, { now });
        const funded = await fundFromTreasury({
            destination: DESTINATION, sendSats: 20_000, venue, stdin: stdinOf(TREASURY), log,
        });
        expect(funded.txid).toBe(TXID_C);
        expect(broadcast).toHaveBeenCalledTimes(1);
        // The only line the funding prints carries neither the key nor the treasury address.
        expect(log.mock.calls.flat().join('\n')).not.toMatch(new RegExp(`${TREASURY.wif}|${TREASURY.address}`));

        const row = await waitForTokenBalance(venue, DESTINATION, 'XCHAIN', 300, { sleep: noSleep, now: clock });
        expect(row.amount).toBe('300');
        expect(balances).toHaveBeenCalledTimes(2);
        const detail = await waitForValidAction(venue, TXID_STAKE, { sleep: noSleep, now: clock });
        expect(detail.activation_block).toBe(2_900_106);
        const reached = await waitForActivationHeight(venue, detail.activation_block, { sleep: noSleep, now: clock });
        expect(reached.last_block[TESTNET_COIN]).toBe(2_900_107);
        expect(status).toHaveBeenCalledTimes(3);

        for (const name of FORBIDDEN) expect(target[name], name).not.toHaveBeenCalled();
        expect([...touched].sort()).toEqual(['action', 'actions', 'balances', 'broadcast', 'feeQuote', 'status', 'utxos']);
    });
});
