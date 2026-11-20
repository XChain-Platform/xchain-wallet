// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-29 activation gate. The load-bearing property is the PRE-train
// state: with the shipped map all-null, nothing may emit or honor
// GATE_MIN_AMOUNT anywhere, at any height, with zero network calls.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { siblingCheckout, skipOrFail } from '../../helpers/siblingCheckout.js';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { buildActionPsbt } from '../../../packages/core/src/flows/buildActionPsbt.js';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

import {
    GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS,
    gateMinAmountScheduledHeight,
    isGateMinAmountActive,
    resolveGateMinAmountActive,
    VOTE_BINDING_MINIMUMS_TIMES,
    VOTE_CALLBACK_TIMELOCK_TIMES,
    isVoteBindingMinimumsActive,
    isVoteCallbackTimelockActive,
    LIST_EDIT_REMOVE_ACTIVATION_HEIGHTS,
    isListEditRemoveActive,
    XBRIDGE_ACTIVATION_HEIGHTS,
    TOKEN_BRIDGE_ACTIVATION_HEIGHTS,
    xbridgeScheduledHeight,
    resolveXbridgeActive,
    xbridgeVersionsIn,
} from '../../../packages/core/src/flows/protocolActivations.js';

describe('XBRIDGE activation', () => {
    it('fails closed on mainnet and is live from genesis on regtest', () => {
        for (const coin of ['bitcoin', 'litecoin', 'dogecoin']) {
            expect(XBRIDGE_ACTIVATION_HEIGHTS[`${coin}-mainnet`]).toBeNull();
            expect(TOKEN_BRIDGE_ACTIVATION_HEIGHTS[`${coin}-mainnet`]).toBeNull();
            expect(xbridgeScheduledHeight(`${coin}-regtest`, 0)).toBe(0);
            expect(xbridgeScheduledHeight(`${coin}-regtest`, 3)).toBe(0);
        }
        expect(Object.isFrozen(XBRIDGE_ACTIVATION_HEIGHTS)).toBe(true);
        expect(Object.isFrozen(TOKEN_BRIDGE_ACTIVATION_HEIGHTS)).toBe(true);
    });

    it('compares scheduled heights inclusively and avoids unnecessary reads', async () => {
        const getBlockHeight = vi.fn(async () => 152929);
        await expect(resolveXbridgeActive({
            chainId: 'bitcoin-testnet', version: 0, getBlockHeight,
        })).resolves.toBe(true);
        expect(getBlockHeight).toHaveBeenCalledOnce();

        const unused = vi.fn(async () => 9e9);
        await expect(resolveXbridgeActive({
            chainId: 'bitcoin-mainnet', version: 0, getBlockHeight: unused,
        })).resolves.toBe(false);
        await expect(resolveXbridgeActive({
            chainId: 'bitcoin-regtest', version: 3, getBlockHeight: unused,
        })).resolves.toBe(true);
        expect(unused).not.toHaveBeenCalled();
    });

    it('reads a missing, empty or unknown bridge version as unscheduled', () => {
        for (const version of [null, undefined, '', ' ', '2', 5, 'x']) {
            expect(xbridgeScheduledHeight('bitcoin-regtest', version), String(version)).toBeNull();
        }
        expect(xbridgeScheduledHeight('bitcoin-regtest', '4')).toBe(0);
        expect(xbridgeScheduledHeight('signet-unknown', 0)).toBeNull();
    });

    it('finds the bridge versions in a top-level XBRIDGE and inside a BATCH command', () => {
        expect(xbridgeVersionsIn({ action: 'XBRIDGE', actionString: 'XBRIDGE|3|x' })).toEqual(['3']);
        expect(xbridgeVersionsIn({ action: 'XBRIDGE', actionString: '' })).toEqual([undefined]);
        expect(xbridgeVersionsIn({ action: 'BATCH', actionString: 'BATCH|0|SEND|0|a|1|;XBRIDGE|0|x;xbridge|4|y' }))
            .toEqual(['0', '4']);
        expect(xbridgeVersionsIn({ action: 'BATCH', actionString: 'BATCH|0|SEND|0|a|1|' })).toEqual([]);
        expect(xbridgeVersionsIn({ action: 'SEND', actionString: 'SEND|0|XBRIDGE|1|' })).toEqual([]);
    });
});

// Every core path that hands an action to the encoder runs the bridge gate on
// the SDK's own wire string, so the version the indexer grades is the one checked.
describe('XBRIDGE activation holds on every encode path', () => {
    const descriptorFor = (chainId) => ({
        coin: 'bitcoin', networkKind: chainId.split('-')[1], feeStrategy: { rbfSupported: true },
    });
    function harness(actionString, tip) {
        const createTx = vi.fn(async () => ({ psbt: '70736274ff', encoding: 'OP_RETURN' }));
        const [action, version] = actionString.split('|');
        const sdk = {
            explorer: { coin: 'TBTC' },
            getStatus: async () => ({ last_block: { TBTC: tip } }),
            encoder: { createTx, broadcastTx: vi.fn(async () => ({})) },
            actions: { createAction: vi.fn(() => ({ actionString, action, version: Number(version) })) },
            wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        };
        return { createTx, sdkRegistry: { get: () => sdk } };
    }
    const PATHS = {
        compose: (h, chainId, actionData) => composeForConfirm({
            sdkRegistry: h.sdkRegistry, chainRegistry: { get: () => descriptorFor(chainId) },
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainId, actionData, encoderOpts: { pubkey: '03dd', change: 'src' }, source: 'src',
        }),
        watcher: (h, chainId, actionData) => buildActionPsbt({
            sdkRegistry: h.sdkRegistry, chainRegistry: { get: () => descriptorFor(chainId) },
            chainId, from: { address: 'src', publicKey: '03dd', derivationPath: 'm/0' }, actionData,
        }),
        submit: (h, chainId, actionData) => submitWithSigner({
            sdkRegistry: h.sdkRegistry, chainRegistry: { get: () => descriptorFor(chainId) }, chainId, actionData,
            encoderOpts: { pubkey: '03dd', sourceAddress: 'src', change: 'src' },
            signer: { kind: 'software', signPsbt: vi.fn(async () => ({ txHex: 'aa', txid: 'bb' })) },
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        }),
    };
    const ACTIONS = [
        ['XBRIDGE|3|x', { action: 'XBRIDGE', params: { VERSION: '3' } }],
        ['BATCH|0|SEND|0|a|1|;XBRIDGE|0|x', { action: 'BATCH', params: { VERSION: '0', COMMAND: 'SEND|0|a|1|;XBRIDGE|0|x' } }],
    ];

    for (const [name, run] of Object.entries(PATHS)) {
        it(`${name} refuses an unarmed bridge before encoding and encodes a live one`, async () => {
            for (const [wire, actionData] of ACTIONS) {
                const early = harness(wire, 100);
                await expect(run(early, 'bitcoin-testnet', actionData), wire)
                    .rejects.toThrow('cross-chain moves are not active on this network yet');
                expect(early.createTx, wire).not.toHaveBeenCalled();
                for (const [chainId, tip] of [['bitcoin-testnet', 154567], ['bitcoin-regtest', null]]) {
                    const live = harness(wire, tip);
                    await run(live, chainId, actionData).catch(() => {});
                    expect(live.createTx, `${wire} on ${chainId}`).toHaveBeenCalled();
                }
            }
        });
    }
});

// The indexer's bridge gate rows, read as text so the pin needs no indexer
// runtime. UNARMED and an absent key both read as null (never active), the
// same fail-closed reading the indexer's resolveThreshold gives them.
const BRIDGE_COINS = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const INDEXER_UNARMED = 9999999999;

function indexerGateTable(sources, key) {
    const opener = `addGate('${key}', 'height', {`;
    const bodies = sources.flatMap((text) => text.split(opener).slice(1));
    if (bodies.length !== 1) throw new Error(`${key}: expected one addGate row, found ${bodies.length}`);
    const body = bodies[0].slice(0, bodies[0].indexOf('});'));
    const table = {};
    for (const raw of body.split('\n')) {
        const line = raw.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        const m = line.match(/^(?:'([^']+)'|(\w+))\s*:\s*([A-Za-z0-9_]+)\s*,?$/);
        if (!m) throw new Error(`${key}: unreadable row line: ${line}`);
        const value = m[3] === 'UNARMED' ? INDEXER_UNARMED : Number(m[3]);
        if (!Number.isInteger(value)) throw new Error(`${key}: unreadable height ${m[3]}`);
        table[m[1] || m[2]] = value;
    }
    return table;
}

function walletMirrorOf(table) {
    const out = {};
    for (const [coin, code] of Object.entries(BRIDGE_COINS)) {
        for (const network of ['mainnet', 'testnet', 'regtest']) {
            const scoped = `${code}:${network}`;
            const h = Object.hasOwn(table, scoped) ? table[scoped] : table[network];
            out[`${coin}-${network}`] = h === undefined || h === INDEXER_UNARMED ? null : h;
        }
    }
    return out;
}

describe('XBRIDGE activation mirrors the indexer gate rows', () => {
    const ROWS = [
        ['xchain_bridge_activation.XCHAIN_BRIDGE_ACTIVATION', XBRIDGE_ACTIVATION_HEIGHTS],
        ['token_bridge_activation.TOKEN_BRIDGE_ACTIVATION', TOKEN_BRIDGE_ACTIVATION_HEIGHTS],
    ];

    it('reads an armed mainnet row as a height the wallet map would disagree with', () => {
        const text = "addGate('k.K', 'height', {\n    'BTC:mainnet': 900000, // armed\n"
            + "    mainnet: UNARMED,\n    'LTC:testnet': 42,\n    testnet: UNARMED,\n    regtest: 0,\n});\n";
        const mirror = walletMirrorOf(indexerGateTable([text], 'k.K'));
        expect(mirror['bitcoin-mainnet']).toBe(900000);
        expect(mirror['litecoin-mainnet']).toBeNull();
        expect(mirror['litecoin-testnet']).toBe(42);
        expect(mirror['dogecoin-testnet']).toBeNull();
        expect(mirror['dogecoin-regtest']).toBe(0);
        expect(mirror).not.toEqual({ ...XBRIDGE_ACTIVATION_HEIGHTS });
        expect(() => indexerGateTable([text, text], 'k.K')).toThrow('expected one addGate row');
        expect(() => indexerGateTable(["addGate('k.K', 'height', {\n  mainnet: 1 + 2,\n});"], 'k.K'))
            .toThrow('unreadable row line');
    });

    // Skips without the sibling checkout; XCHAIN_REQUIRE_SIBLINGS=1 makes it fail instead.
    it('pins both wallet maps to the indexer XCHAIN_BRIDGE and TOKEN_BRIDGE rows', (ctx) => {
        const dir = process.env.XCHAIN_INDEXER_DIR || '../xchain-indexer';
        const sibling = siblingCheckout(process.cwd(), join(dir, 'src', 'protocol_changes'));
        if (!skipOrFail(ctx, sibling, 'the bridge activation height pin')) return;
        const sources = readdirSync(sibling.path).filter((f) => f.endsWith('.js'))
            .map((f) => readFileSync(join(sibling.path, f), 'utf8'));
        for (const [key, walletMap] of ROWS) {
            expect(Object.keys(walletMap).sort(), key).toEqual(Object.keys(walletMirrorOf({})).sort());
            expect(walletMirrorOf(indexerGateTable(sources, key)), key).toEqual({ ...walletMap });
        }
    });
});

describe('LIST_EDIT_REMOVE activation', () => {
    it('is live from genesis on regtest only', () => {
        for (const coin of ['bitcoin', 'litecoin', 'dogecoin']) {
            expect(LIST_EDIT_REMOVE_ACTIVATION_HEIGHTS[`${coin}-regtest`]).toBe(0);
            expect(isListEditRemoveActive({ chainId: `${coin}-regtest` })).toBe(true);
            expect(isListEditRemoveActive({ chainId: `${coin}-testnet`, blockHeight: 9e9 })).toBe(false);
            expect(isListEditRemoveActive({ chainId: `${coin}-mainnet`, blockHeight: 9e9 })).toBe(false);
        }
    });

    it('fails closed for unknown chains and future scheduled heights', () => {
        expect(isListEditRemoveActive({ chainId: 'unknown' })).toBe(false);
        const heights = { 'bitcoin-mainnet': 100 };
        expect(isListEditRemoveActive({ chainId: 'bitcoin-mainnet', blockHeight: 99, heights })).toBe(false);
        expect(isListEditRemoveActive({ chainId: 'bitcoin-mainnet', blockHeight: 100, heights })).toBe(true);
    });
});

describe('shipped GATE_MIN_AMOUNT map (testnet genesis-active, mainnet unscheduled)', () => {
    const TESTNET = ['bitcoin-testnet', 'litecoin-testnet', 'dogecoin-testnet'];

    it('covers all nine chains', () => {
        expect(Object.keys(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS)).toHaveLength(9);
    });

    it('activates the three testnets from block 0', () => {
        for (const id of TESTNET) {
            expect(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS[id]).toBe(0);
            expect(gateMinAmountScheduledHeight(id)).toBe(0);
            expect(isGateMinAmountActive({ chainId: id, blockHeight: 0 })).toBe(true);
        }
    });

    it('leaves every mainnet and regtest chain unscheduled', () => {
        const ids = Object.keys(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS).filter((id) => !TESTNET.includes(id));
        expect(ids).toHaveLength(6);
        for (const id of ids) {
            expect(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS[id]).toBeNull();
            expect(gateMinAmountScheduledHeight(id)).toBeNull();
            expect(isGateMinAmountActive({ chainId: id, blockHeight: Number.MAX_SAFE_INTEGER })).toBe(false);
        }
    });

    it('is frozen (a height cannot be poked in at runtime)', () => {
        expect(Object.isFrozen(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS)).toBe(true);
        expect(() => { GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS['bitcoin-mainnet'] = 1; }).toThrow();
    });

    it('treats unknown chains as unscheduled', () => {
        expect(gateMinAmountScheduledHeight('not-a-chain')).toBeNull();
        expect(isGateMinAmountActive({ chainId: 'not-a-chain', blockHeight: 1 })).toBe(false);
    });

    it('resolveGateMinAmountActive never fetches a height while unscheduled', async () => {
        const getBlockHeight = vi.fn(async () => { throw new Error('must not be called'); });
        await expect(resolveGateMinAmountActive({ chainId: 'bitcoin-mainnet', getBlockHeight }))
            .resolves.toBe(false);
        expect(getBlockHeight).not.toHaveBeenCalled();
    });
});

describe('scheduled behavior (test override map)', () => {
    const HEIGHTS = { 'bitcoin-regtest': 100 };

    it('activation is inclusive at the pinned height', () => {
        const at = (blockHeight) => isGateMinAmountActive({ chainId: 'bitcoin-regtest', blockHeight, heights: HEIGHTS });
        expect(at(99)).toBe(false);
        expect(at(100)).toBe(true);
        expect(at(101)).toBe(true);
    });

    it('a null/garbage height reads as not active', () => {
        const at = (blockHeight) => isGateMinAmountActive({ chainId: 'bitcoin-regtest', blockHeight, heights: HEIGHTS });
        expect(at(null)).toBe(false);
        expect(at(undefined)).toBe(false);
        expect(at(NaN)).toBe(false);
    });

    it('resolveGateMinAmountActive fetches once and compares', async () => {
        const getBlockHeight = vi.fn(async () => 100);
        await expect(resolveGateMinAmountActive({ chainId: 'bitcoin-regtest', getBlockHeight, heights: HEIGHTS }))
            .resolves.toBe(true);
        expect(getBlockHeight).toHaveBeenCalledTimes(1);
    });

    it('resolve fails closed on a fetch error or null watermark', async () => {
        await expect(resolveGateMinAmountActive({
            chainId: 'bitcoin-regtest', heights: HEIGHTS,
            getBlockHeight: async () => { throw new Error('explorer down'); },
        })).resolves.toBe(false);
        await expect(resolveGateMinAmountActive({
            chainId: 'bitcoin-regtest', heights: HEIGHTS,
            getBlockHeight: async () => null,
        })).resolves.toBe(false);
    });
});

// PC-42: the two VOTE flag-days. Unlike GATE_MIN_AMOUNT these carry REAL
// scheduled values and are BLOCK TIMESTAMPS, not heights.
describe('VOTE binding-poll flag-days (PC-42)', () => {
    const MAINNET_FLAG_DAY = 1786060800; // 2026-08-07, per xchain-indexer protocol_changes.js

    it('matches the indexer schedule: mainnet 2026-08-07, testnet and regtest from genesis', () => {
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['bitcoin-mainnet']).toBe(MAINNET_FLAG_DAY);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['litecoin-mainnet']).toBe(MAINNET_FLAG_DAY);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['dogecoin-mainnet']).toBe(MAINNET_FLAG_DAY);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['bitcoin-regtest']).toBe(0);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['bitcoin-testnet']).toBe(0);
        // The two changes activate together today.
        expect(VOTE_BINDING_MINIMUMS_TIMES).toEqual(VOTE_CALLBACK_TIMELOCK_TIMES);
    });

    it('is live on regtest and testnet at any block time', () => {
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-regtest', blockTime: 1 })).toBe(true);
        expect(isVoteBindingMinimumsActive({ chainId: 'bitcoin-testnet', blockTime: 1 })).toBe(true);
    });

    it('gates mainnet on the flag day, inclusive', () => {
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-mainnet', blockTime: MAINNET_FLAG_DAY - 1 })).toBe(false);
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-mainnet', blockTime: MAINNET_FLAG_DAY })).toBe(true);
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-mainnet', blockTime: MAINNET_FLAG_DAY + 1 })).toBe(true);
    });

    it('fails closed on an unusable block time or an unknown chain', () => {
        // A status outage must withhold the field, never emit one the chain drops.
        for (const blockTime of [null, undefined, NaN, 'soon']) {
            expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-regtest', blockTime })).toBe(false);
        }
        expect(isVoteCallbackTimelockActive({ chainId: 'ethereum-mainnet', blockTime: 9e9 })).toBe(false);
    });
});
