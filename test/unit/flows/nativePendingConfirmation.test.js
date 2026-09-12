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
    spentByConfirmedSibling,
    reconcileNativePendingTxs,
    INCLUSION_PROBE_AFTER_MS,
    INCLUSION_PROBE_INTERVAL_MS,
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
        expect(out).toEqual({ verdict: 'confirmed', confirmations: 1, blockIndex: null });
    });

    it('is seen while the output exists with zero confirmations', () => {
        const out = nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 0 }],
        } });
        expect(out).toEqual({ verdict: 'seen', confirmations: 0, blockIndex: null });
    });

    it('takes the deepest count when the tracker serves both stores during its cleanup window', () => {
        const out = nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 0 }],
            [OURS]: [{ txid: TXID, vout: 1, confirmations: '3' }],
        } });
        expect(out).toEqual({ verdict: 'confirmed', confirmations: 3, blockIndex: null });
    });

    it('is unknown when no answering address holds an output of it', () => {
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: 'ff'.repeat(32), vout: 0, confirmations: 9 }],
        } })).toEqual({ verdict: 'unknown', confirmations: null, blockIndex: null });
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {} }))
            .toEqual({ verdict: 'unknown', confirmations: null, blockIndex: null });
        expect(nativeSendVerdict({ txid: '', utxosByAddress: { [THEIRS]: [{ txid: TXID, confirmations: 1 }] } }))
            .toEqual({ verdict: 'unknown', confirmations: null, blockIndex: null });
    });

    it('ignores a malformed or negative count rather than reading it as a verdict', () => {
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, confirmations: -1 }, { txid: TXID, confirmations: 'soon' }, null],
        } })).toEqual({ verdict: 'unknown', confirmations: null, blockIndex: null });
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

// ---------------------------------------------------------------------------
// Past the pending window: what the outputs cannot settle is checked against
// the vault's own confirmed spends and then by hash against the explorer.
// ---------------------------------------------------------------------------

const NOW = '2026-09-10T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const iso = (msAgo) => new Date(NOW_MS - msAgo).toISOString();
const OLD = INCLUSION_PROBE_AFTER_MS * 10;
const YOUNG = Math.floor(INCLUSION_PROBE_AFTER_MS / 3);
const COINPAY_TXID = 'f5183536'.padEnd(64, '0');

/** Internal byte order, as a raw transaction carries a previous txid. */
function reverseHex(hex) {
    let out = '';
    for (let i = hex.length - 2; i >= 0; i -= 2) out += hex.slice(i, i + 2);
    return out;
}
const le = (n, bytes) => n.toString(16).padStart(bytes * 2, '0').match(/../g).reverse().join('');

/** A minimal legacy transaction spending `prev:vout`, with one empty output. */
function rawTxSpending(prev, vout) {
    return '01000000'                          // version
        + '01' + reverseHex(prev.toLowerCase()) + le(vout, 4) + '00' + 'ffffffff'
        + '01' + le(1000, 8) + '00'            // one output, empty script
        + '00000000';                          // locktime
}

/** A record for an action-carrying transaction: no `tick`, retired by no feed when rejected. */
function coinpayRecord(over = {}) {
    return record({
        id: 'ptx-coinpay',
        action: 'COINPAY',
        actionSummary: 'Pay 5 DOGE for invoice 648',
        txid: COINPAY_TXID,
        tick: null,
        amount: null,
        toAddress: THEIRS,
        broadcastAt: iso(OLD),
        createdAt: iso(OLD + 1000),
        mempoolSeenAt: iso(OLD - 30000),
        ...over,
    });
}

/**
 * An SDK whose encoder answers UTXOs per address and whose explorer answers
 * transaction lookups per txid (an Error value throws; `undefined` resolves
 * to the empty record the explorer returns for a hash it never decoded).
 */
function sdkWith({ utxos = {}, tx = {}, utxoCalls = [], txCalls = [], explorer = true } = {}) {
    const sdk = {
        encoder: {
            getUTXOs: async (address) => {
                utxoCalls.push(address);
                const a = utxos[address];
                if (a instanceof Error) throw a;
                return a === undefined ? { utxos: [] } : a;
            },
        },
    };
    if (explorer) {
        sdk.getTransaction = async (query, type) => {
            txCalls.push([query, type]);
            const a = tx[query];
            if (a instanceof Error) throw a;
            return a === undefined ? { actions: [], tx_data: null } : a;
        };
    }
    return { get: () => sdk };
}

const run = (vault, sdkRegistry, extra = {}) => reconcileNativePendingTxs({
    vault, chainRegistry: registry, chainId: CHAIN_ID, address: OURS, sdkRegistry,
    opts: { now: () => NOW, probeMemo: new Map(), ...extra },
});

describe('nativeSendVerdict names the block beside a confirmed output', () => {
    it('reads the tracker height off the deepest confirmed output, and nothing off a mempool one', () => {
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 2, height: 500 }],
        } })).toEqual({ verdict: 'confirmed', confirmations: 2, blockIndex: 500 });
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 0, height: 0 }],
        } })).toEqual({ verdict: 'seen', confirmations: 0, blockIndex: null });
        // A height the tracker did not serve is not invented.
        expect(nativeSendVerdict({ txid: TXID, utxosByAddress: {
            [THEIRS]: [{ txid: TXID, vout: 0, confirmations: 1 }],
        } })).toEqual({ verdict: 'confirmed', confirmations: 1, blockIndex: null });
    });
});

describe('spentByConfirmedSibling', () => {
    it('proves the transactions a confirmed record of ours spends an output of', () => {
        const child = record({ id: 'child', txid: 'cc'.repeat(32), status: 'indexed', txHex: rawTxSpending(TXID, 1) });
        const out = spentByConfirmedSibling({ txids: [TXID, 'ee'.repeat(32)], siblings: [child] });
        expect(out).toEqual(new Set([TXID.toLowerCase()]));
    });

    it('takes evidence only from an indexed record with hex that parses, never from the record itself', () => {
        const spend = rawTxSpending(TXID, 0);
        expect(spentByConfirmedSibling({ txids: [TXID], siblings: [
            record({ id: 'live', txid: 'cc'.repeat(32), status: 'broadcast', txHex: spend }),
            record({ id: 'junk', txid: 'dd'.repeat(32), status: 'indexed', txHex: 'not hex at all' }),
            record({ id: 'bare', txid: 'ee'.repeat(32), status: 'indexed', txHex: null }),
            // Its own txid in its own inputs would be a malformed transaction; it must not self-certify.
            record({ id: 'self', txid: TXID, status: 'indexed', txHex: spend }),
        ] })).toEqual(new Set());
    });
});

describe('reconcileNativePendingTxs past the pending window', () => {
    it('retires a native send whose outputs are all spent once the explorer names its block', async () => {
        const vault = vaultOf([record({ broadcastAt: iso(OLD), createdAt: iso(OLD + 1000) })]);
        const txCalls = [];
        const out = await run(vault, sdkWith({
            utxos: { [THEIRS]: { utxos: [] }, [OURS]: { utxos: [] } },
            tx: { [TXID.toLowerCase()]: { tx_hash: TXID.toLowerCase(), block_index: 67881853, actions: [], tx_data: null } },
            txCalls,
        }));
        expect(out.confirmed).toEqual(new Set([TXID.toLowerCase()]));
        expect(txCalls).toEqual([[TXID.toLowerCase(), 'tx_hash']]);
        const row = vault.rows[0];
        expect(row.status).toBe('indexed');
        expect(row.chainConfirmed).toBe(true);
        expect(row.confirmedBlockIndex).toBe(67881853);
        expect(row.confirmedAt).toBe(NOW);
    });

    it('leaves the record exactly as it was when the explorer names no block', async () => {
        const before = record({ broadcastAt: iso(OLD), createdAt: iso(OLD + 1000) });
        const vault = vaultOf([before]);
        const txCalls = [];
        const out = await run(vault, sdkWith({ txCalls }));
        expect(txCalls.length).toBe(1);
        expect(out.confirmed.size).toBe(0);
        expect(vault.rows[0]).toEqual(before);
    });

    it('retires an action-carrying record with no tick and no action row once its block is named', async () => {
        const vault = vaultOf([coinpayRecord()]);
        const utxoCalls = [];
        const txCalls = [];
        const out = await run(vault, sdkWith({
            tx: { [COINPAY_TXID]: { tx_hash: COINPAY_TXID, block_index: 67881869, actions: [], tx_data: 'COINPAY|0|648' } },
            utxoCalls, txCalls,
        }));
        // Not a native send: the tracker is never asked about it.
        expect(utxoCalls).toEqual([]);
        expect(txCalls).toEqual([[COINPAY_TXID, 'tx_hash']]);
        expect(out.confirmed).toEqual(new Set([COINPAY_TXID]));
        const row = vault.rows[0];
        expect(row.status).toBe('indexed');
        expect(row.chainConfirmed).toBe(true);
        expect(row.confirmedBlockIndex).toBe(67881869);
    });

    it('does not probe a record still inside the pending window', async () => {
        const vault = vaultOf([
            record({ broadcastAt: iso(YOUNG), createdAt: iso(YOUNG + 1000) }),
            coinpayRecord({ broadcastAt: iso(YOUNG), createdAt: iso(YOUNG + 1000) }),
        ]);
        const txCalls = [];
        const out = await run(vault, sdkWith({
            tx: {
                [TXID.toLowerCase()]: { block_index: 10, actions: [] },
                [COINPAY_TXID]: { block_index: 11, actions: [] },
            },
            txCalls,
        }));
        expect(txCalls).toEqual([]);
        expect(out.confirmed.size).toBe(0);
        expect(vault.rows.every((r) => r.status === 'broadcast')).toBe(true);
    });

    it('leaves every record untouched and does not throw when the explorer fails or is absent', async () => {
        const rows = [record({ broadcastAt: iso(OLD), createdAt: iso(OLD + 1000) }), coinpayRecord()];
        const failing = vaultOf(rows);
        const out = await run(failing, sdkWith({
            tx: { [TXID.toLowerCase()]: new Error('ECONNRESET'), [COINPAY_TXID]: new Error('503') },
        }));
        expect(out).toEqual({ seenNow: new Set(), confirmed: new Set() });
        expect(failing.rows).toEqual(rows);

        const bare = vaultOf(rows);
        await expect(run(bare, sdkWith({ explorer: false }))).resolves.toEqual({ seenNow: new Set(), confirmed: new Set() });
        expect(bare.rows).toEqual(rows);
    });

    it('takes a confirmed spend of its own output as proof, before asking anyone', async () => {
        const vault = vaultOf([
            record({ broadcastAt: iso(OLD), createdAt: iso(OLD + 1000) }),
            // Our later send, already confirmed by a feed, spending the change output.
            record({
                id: 'later', txid: 'cc'.repeat(32), fromAddress: 'mRotatedChange', toAddress: THEIRS,
                status: 'indexed', confirmedAt: iso(1000), txHex: rawTxSpending(TXID, 1),
            }),
        ]);
        const txCalls = [];
        const out = await run(vault, sdkWith({ txCalls }));
        expect(txCalls).toEqual([]);
        expect(out.confirmed).toEqual(new Set([TXID.toLowerCase()]));
        const row = vault.rows.find((r) => r.id === 'ptx-1');
        expect(row.status).toBe('indexed');
        expect(row.chainConfirmed).toBe(true);
        // A descendant proves inclusion, not the block; none is invented.
        expect(row.confirmedBlockIndex).toBeNull();
    });

    it('retires a send whose change a later send spent in the same pass the tracker settles that later send', async () => {
        const CHILD = 'cc'.repeat(32);
        const vault = vaultOf([
            record({ broadcastAt: iso(OLD), createdAt: iso(OLD + 1000) }),
            // Our later send, still reading broadcast in the vault, spends the change output.
            record({
                id: 'later', txid: CHILD, fromAddress: OURS, toAddress: THEIRS,
                broadcastAt: iso(YOUNG), createdAt: iso(YOUNG + 1000), txHex: rawTxSpending(TXID, 1),
            }),
        ]);
        const txCalls = [];
        const out = await run(vault, sdkWith({
            utxos: { [THEIRS]: { utxos: [{ txid: CHILD, vout: 0, confirmations: 2, height: 9001 }] } },
            txCalls,
        }));
        expect(out.confirmed).toEqual(new Set([TXID.toLowerCase(), CHILD]));
        expect(txCalls).toEqual([]);
        expect(vault.rows.map((r) => r.status)).toEqual(['indexed', 'indexed']);
        expect(vault.rows[0].confirmedBlockIndex).toBeNull();
        expect(vault.rows[1].confirmedBlockIndex).toBe(9001);
    });

    it('retires a record plainly when the explorer holds a valid action for it, leaving that row to the feed', async () => {
        const vault = vaultOf([coinpayRecord()]);
        const out = await run(vault, sdkWith({
            tx: { [COINPAY_TXID]: {
                tx_hash: COINPAY_TXID, block_index: '67882092', tx_data: 'COINPAY|0|666',
                actions: [{ action_index: '667', action: 'COINPAY', status: 'valid' }],
            } },
        }));
        expect(out.confirmed).toEqual(new Set([COINPAY_TXID]));
        const row = vault.rows[0];
        expect(row.status).toBe('indexed');
        expect(row.confirmedAt).toBe(NOW);
        expect(row.chainConfirmed).toBeUndefined();
        expect(row.confirmedBlockIndex).toBeUndefined();
    });

    it('asks the explorer about one hash at most once per interval', async () => {
        const vault = vaultOf([coinpayRecord()]);
        const txCalls = [];
        const memo = new Map();
        const sdk = sdkWith({ txCalls });
        await run(vault, sdk, { probeMemo: memo });
        await run(vault, sdk, { probeMemo: memo });
        expect(txCalls.length).toBe(1);
        const later = new Date(NOW_MS + INCLUSION_PROBE_INTERVAL_MS).toISOString();
        await run(vault, sdk, { probeMemo: memo, now: () => later });
        expect(txCalls.length).toBe(2);
    });

    it('stamps the block off the tracker when the outputs settle a young send', async () => {
        const vault = vaultOf([record({ broadcastAt: iso(YOUNG), createdAt: iso(YOUNG + 1000) })]);
        const out = await run(vault, sdkWith({
            utxos: { [THEIRS]: { utxos: [{ txid: TXID.toLowerCase(), vout: 0, confirmations: 3, height: 7707 }] } },
        }));
        expect(out.confirmed).toEqual(new Set([TXID.toLowerCase()]));
        expect(vault.rows[0].chainConfirmed).toBe(true);
        expect(vault.rows[0].confirmedBlockIndex).toBe(7707);
    });
});
