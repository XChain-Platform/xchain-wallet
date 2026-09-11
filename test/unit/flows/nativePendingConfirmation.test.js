// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A plain native-coin send is retired by the chain's UTXO set, the
// one feed that can see a transaction carrying no XChain action.

import { describe, it, expect } from 'vitest';
import {
    isNativePendingTx,
    nativeSendVerdict,
    utxoListOf,
    reconcileNativePendingTxs,
} from '../../../packages/core/src/flows/nativePendingConfirmation.js';

const CHAIN_ID = 'litecoin-regtest';
const OURS = 'mtkx2FQownAddress';
const THEIRS = 'moV6MFmTheirs';
const TXID = 'AaBbCc'.repeat(10) + 'dead';
const descriptor = { coin: 'litecoin', networkKind: 'regtest' };
const registry = { get: () => descriptor };

function record(over = {}) {
    return {
        id: 'ptx-1',
        chain: 'litecoin',
        network: 'regtest',
        fromAddress: OURS,
        toAddress: THEIRS,
        action: 'SEND',
        actionSummary: 'Send 0.5 LTC',
        psbtHex: '',
        txHex: 'cafebabe'.repeat(64),
        txid: TXID,
        status: 'broadcast',
        createdAt: '2026-09-08T00:00:00.000Z',
        broadcastAt: '2026-09-08T00:00:10.000Z',
        confirmedAt: null,
        rbfReplacement: null,
        error: null,
        tick: 'LTC',
        amount: '0.5',
        mempoolSeenAt: null,
        ...over,
    };
}

/** An in-memory pendingTxs store with the three methods the flow uses. */
function vaultOf(records) {
    const rows = records.map((r) => ({ ...r }));
    return {
        rows,
        pendingTxs: {
            list: async () => rows.map((r) => ({ ...r })),
            findBy: async (field, value) => rows.filter((r) => r[field] === value).map((r) => ({ ...r })),
            put: async (rec) => {
                const i = rows.findIndex((r) => r.id === rec.id);
                if (i >= 0) rows[i] = { ...rec }; else rows.push({ ...rec });
            },
        },
    };
}

/** An SDK registry whose encoder answers per address from `answers` (a thrown Error when the value is one). */
function sdkOf(answers, calls = []) {
    return {
        get: () => ({
            encoder: {
                getUTXOs: async (address) => {
                    calls.push(address);
                    const a = answers[address];
                    if (a instanceof Error) throw a;
                    return a;
                },
            },
        }),
    };
}

describe('isNativePendingTx', () => {
    it('is the live send whose ticker is the chain\'s own coin', () => {
        expect(isNativePendingTx(record(), descriptor)).toBe(true);
        expect(isNativePendingTx(record({ tick: 'ltc' }), descriptor)).toBe(true);
    });

    it('resolves the descriptor\'s coin NAME to the ticker the record carries', () => {
        // Descriptors say `litecoin`; a record says `LTC`. A direct
        // comparison of the two matches nothing on a real venue, and a unit
        // fixture using `coin: 'LTC'` cannot see that miss, so the fixture
        // uses the real name and this pins it.
        expect(isNativePendingTx(record({ tick: 'LTC' }), { coin: 'litecoin' })).toBe(true);
        expect(isNativePendingTx(record({ tick: 'litecoin' }), { coin: 'litecoin' })).toBe(false);
        expect(isNativePendingTx(record({ tick: 'DOGE' }), { coin: 'dogecoin' })).toBe(true);
        expect(isNativePendingTx(record({ tick: 'DOGE' }), { coin: 'litecoin' })).toBe(false);
        expect(isNativePendingTx(record(), { coin: 'not-a-coin' })).toBe(false);
    });

    it('is not a token send, which the action feeds retire', () => {
        expect(isNativePendingTx(record({ tick: 'XCHAIN' }), descriptor)).toBe(false);
        expect(isNativePendingTx(record({ tick: null }), descriptor)).toBe(false);
    });

    it('is not a record that is off the network', () => {
        expect(isNativePendingTx(record({ status: 'indexed' }), descriptor)).toBe(false);
        expect(isNativePendingTx(record({ status: 'queued' }), descriptor)).toBe(false);
        expect(isNativePendingTx(record({ status: 'failed' }), descriptor)).toBe(false);
        expect(isNativePendingTx(record({ txid: null }), descriptor)).toBe(false);
        expect(isNativePendingTx(record(), null)).toBe(false);
        expect(isNativePendingTx(null, descriptor)).toBe(false);
    });
});

describe('nativeSendVerdict', () => {
    it('is confirmed once any output of the transaction has a confirmation', () => {
        const out = nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID.toLowerCase(), vout: 0, confirmations: 1 }],
        } });
        expect(out).toEqual({ verdict: 'confirmed', confirmations: 1 });
    });

    it('is seen while the output exists with zero confirmations', () => {
        const out = nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 0 }],
        } });
        expect(out).toEqual({ verdict: 'seen', confirmations: 0 });
    });

    it('takes the deepest count when the tracker serves both stores during its cleanup window', () => {
        const out = nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 0 }],
            [OURS]: [{ txid: TXID, vout: 1, confirmations: '3' }],
        } });
        expect(out).toEqual({ verdict: 'confirmed', confirmations: 3 });
    });

    it('is unknown when no answering address holds an output of it', () => {
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: 'ff'.repeat(32), vout: 0, confirmations: 9 }],
        } })).toEqual({ verdict: 'unknown', confirmations: null });
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {} }))
            .toEqual({ verdict: 'unknown', confirmations: null });
        expect(nativeSendVerdict({ txid: '', utxosByAddress: { [THEIRS]: [{ txid: TXID, confirmations: 1 }] } }))
            .toEqual({ verdict: 'unknown', confirmations: null });
    });

    it('ignores a malformed or negative count rather than reading it as a verdict', () => {
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, confirmations: -1 }, { txid: TXID, confirmations: 'soon' }, null],
        } })).toEqual({ verdict: 'unknown', confirmations: null });
    });
});

describe('utxoListOf', () => {
    it('accepts the documented envelope and the bare array, nothing else', () => {
        expect(utxoListOf({ utxos: [{ txid: 'a' }], sync: {} })).toEqual([{ txid: 'a' }]);
        expect(utxoListOf([{ txid: 'a' }])).toEqual([{ txid: 'a' }]);
        expect(utxoListOf({ utxos: null })).toBeNull();
        expect(utxoListOf(undefined)).toBeNull();
        expect(utxoListOf('nope')).toBeNull();
    });
});

describe('reconcileNativePendingTxs', () => {
    it('retires a native send once the recipient\'s output is in a block', async () => {
        const vault = vaultOf([record()]);
        const calls = [];
        const now = () => '2026-09-08T00:05:00.000Z';
        const out = await reconcileNativePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS, opts: { now },
            sdkRegistry: sdkOf({
                [THEIRS]: { utxos: [{ txid: TXID.toLowerCase(), vout: 0, value: '50000000', confirmations: 1 }] },
                [OURS]: { utxos: [] },
            }, calls),
        });
        expect(out.confirmed).toEqual(new Set([TXID.toLowerCase()]));
        expect(out.seenNow.size).toBe(0);
        expect(vault.rows[0].status).toBe('indexed');
        expect(vault.rows[0].confirmedAt).toBe('2026-09-08T00:05:00.000Z');
        // One fetch per distinct address, recipient and sender both asked.
        expect(calls.sort()).toEqual([OURS, THEIRS].sort());
    });

    it('stamps the sighting, once, while the output is only in the mempool', async () => {
        const vault = vaultOf([record()]);
        const sdk = sdkOf({ [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 0 }], [OURS]: [] });
        const first = await reconcileNativePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS, sdkRegistry: sdk,
            opts: { now: () => '2026-09-08T00:01:00.000Z' },
        });
        expect(first.seenNow).toEqual(new Set([TXID.toLowerCase()]));
        expect(first.confirmed.size).toBe(0);
        expect(vault.rows[0].status).toBe('broadcast');
        expect(vault.rows[0].mempoolSeenAt).toBe('2026-09-08T00:01:00.000Z');

        const second = await reconcileNativePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS, sdkRegistry: sdk,
            opts: { now: () => '2026-09-08T00:02:00.000Z' },
        });
        // Reported as seen again (History refreshes its clock from this), but
        // the first sighting on the record is kept, as the WS path keeps it.
        expect(second.seenNow.has(TXID.toLowerCase())).toBe(true);
        expect(vault.rows[0].mempoolSeenAt).toBe('2026-09-08T00:01:00.000Z');
    });

    it('leaves the record alone when nothing answers, and when the encoder refuses', async () => {
        const vault = vaultOf([record()]);
        const out = await reconcileNativePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS,
            sdkRegistry: sdkOf({ [THEIRS]: new Error('utxo-tracker is not synced'), [OURS]: new Error('nope') }),
        });
        expect(out).toEqual({ seenNow: new Set(), confirmed: new Set() });
        expect(vault.rows[0].status).toBe('broadcast');
        expect(vault.rows[0].mempoolSeenAt).toBeNull();

        // An answering address that simply does not hold it is the same: an
        // absence is never a verdict about the transaction.
        const empty = await reconcileNativePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS,
            sdkRegistry: sdkOf({ [THEIRS]: { utxos: [] }, [OURS]: { utxos: [] } }),
        });
        expect(empty.confirmed.size).toBe(0);
        expect(vault.rows[0].status).toBe('broadcast');
    });

    it('never asks the tracker about a token send or another address\'s send', async () => {
        const calls = [];
        const vault = vaultOf([
            record({ id: 'token', tick: 'XCHAIN', txid: 'ee'.repeat(32) }),
            record({ id: 'other', fromAddress: 'mOtherAddress', txid: 'dd'.repeat(32) }),
        ]);
        const out = await reconcileNativePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS,
            sdkRegistry: sdkOf({}, calls),
        });
        expect(calls).toEqual([]);
        expect(out.confirmed.size + out.seenNow.size).toBe(0);
    });

    it('scopes to the chain by coin and network, and covers every address when none is named', async () => {
        const calls = [];
        const vault = vaultOf([
            record({ id: 'mainnet-twin', network: 'mainnet', txid: 'bb'.repeat(32) }),
            record({ id: 'ours', fromAddress: 'mAnotherOfOurs', toAddress: THEIRS }),
        ]);
        const out = await reconcileNativePendingTxs({
            vault, chainRegistry: registry, chainId: CHAIN_ID,
            sdkRegistry: sdkOf({
                [THEIRS]: [{ txid: TXID, confirmations: 2 }],
                mAnotherOfOurs: [],
            }, calls),
        });
        expect(calls.sort()).toEqual([THEIRS, 'mAnotherOfOurs'].sort());
        expect(out.confirmed.has(TXID.toLowerCase())).toBe(true);
        expect(vault.rows.find((r) => r.id === 'ours').status).toBe('indexed');
        expect(vault.rows.find((r) => r.id === 'mainnet-twin').status).toBe('broadcast');
    });

    it('is a no-op without a vault, a chain the registry knows, or an encoder', async () => {
        const nothing = { seenNow: new Set(), confirmed: new Set() };
        expect(await reconcileNativePendingTxs({ vault: null, chainRegistry: registry, chainId: CHAIN_ID }))
            .toEqual(nothing);
        expect(await reconcileNativePendingTxs({
            vault: vaultOf([record()]), chainRegistry: { get: () => null }, chainId: CHAIN_ID,
        })).toEqual(nothing);
        expect(await reconcileNativePendingTxs({
            vault: vaultOf([record()]), chainRegistry: registry, chainId: CHAIN_ID, sdkRegistry: { get: () => ({}) },
        })).toEqual(nothing);
    });
});
