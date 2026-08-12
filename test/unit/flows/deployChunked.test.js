// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-38: the chunked-DEPLOY orchestrator. What these pin are the three
// consensus rules the flow is built around (xchain-indexer actions/deploy.js):
// carriers all come from ONE deployer, each carrier is INDEXED before the next
// leg is built, and a resumed run only skips chunks the chain still reports
// valid for this group + position. Getting any of them wrong burns real fees:
// every leg is its own transaction.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
    assertValidDestination: vi.fn(),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import {
    planChunkedDeploy,
    chunkCarrierParams,
    assembleParams,
    verifyRecordedChunks,
    deployChunkedRun,
} from '../../../packages/core/src/flows/deployChunked.js';

const FROM = { address: 'addr-1', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
const HASH = 'a'.repeat(64);

// A stand-in for the SDK's planner; the real consensus math is pinned in the
// SDK's own chunkHelper suite, so here we only need a deterministic shape.
function fakeSdk(overrides = {}) {
    return {
        planDeploy: vi.fn((code) => (String(code).length > 100
            ? { codeHash: HASH, single: false, parts: ['p0', 'p1', 'p2'], totalChunks: 3 }
            : { codeHash: HASH, single: true, parts: null, totalChunks: 0 })),
        waitForAction: vi.fn(async () => ({ status: 'valid' })),
        getAction: vi.fn(async () => ({ status: 'valid', code_hash: HASH, chunk_index: 0 })),
        ...overrides,
    };
}
function registryOf(sdk) {
    return { get: vi.fn(() => sdk) };
}
function fakeVault() {
    const store = new Map();
    return {
        store,
        pendingDeploys: {
            put: vi.fn(async (r) => { store.set(r.id, r); return r; }),
            get: vi.fn(async (id) => store.get(id) || null),
            delete: vi.fn(async (id) => { store.delete(id); }),
            findBy: vi.fn(async () => [...store.values()]),
        },
    };
}
function baseOpts(extra = {}) {
    const sdk = extra.sdk || fakeSdk();
    return {
        sdk,
        opts: {
            vault: extra.vault || fakeVault(),
            walletId: 'w1',
            password: 'pw',
            chainRegistry: {},
            sdkRegistry: registryOf(sdk),
            chainId: 'c',
            from: FROM,
            code: 'x'.repeat(500),
            gasLimit: '100000',
            name: 'Thing',
            ...(extra.opts || {}),
        },
    };
}

describe('PC-38 param builders', () => {
    it('chunkCarrierParams emits the DEPLOY v4 carrier wire fields as strings', () => {
        expect(chunkCarrierParams({ codeHash: HASH, index: 2, totalChunks: 5, part: 'abc' })).toEqual({
            VERSION: '4', CODE_HASH: HASH, CHUNK_INDEX: '2', TOTAL_CHUNKS: '5', CODE_PART: 'abc',
        });
    });

    it('assembleParams emits v2 with CODE_HASH and no inline CODE', () => {
        const p = assembleParams({ codeHash: HASH, gasLimit: '100000' });
        expect(p.VERSION).toBe('2');
        expect(p.CODE_HASH).toBe(HASH);
        expect('CODE' in p).toBe(false);
    });

    it('assembleParams switches to v3 and defaults SLASH_DESTINATION to BURN when staking is set', () => {
        const p = assembleParams({ codeHash: HASH, gasLimit: '1', cooldownBlocks: '144' });
        expect(p.VERSION).toBe('3');
        expect(p.COOLDOWN_BLOCKS).toBe('144');
        expect(p.SLASH_DESTINATION).toBe('BURN');
    });

    it('assembleParams never emits NAME: DEPLOY has no name field in any version', () => {
        // Verified on chain: an assembling leg built with a name still emitted
        // `DEPLOY|2|<hash>|<gas>` - the serializer drops it. Emitting it would
        // be a field the protocol cannot carry, so it must not be built at all.
        const p = assembleParams({ codeHash: HASH, gasLimit: '1', name: 'Escrow' });
        expect('NAME' in p).toBe(false);
        expect(Object.keys(p)).toEqual(['VERSION', 'CODE_HASH', 'GAS_LIMIT']);
    });

    // v2 declares `...CONSTRUCTOR_PARAMS` - a REST field, so the serializer
    // emits one wire segment per array entry and must be handed the ARRAY.
    // Pre-joining with '|' yields one value CONTAINING pipes, which the SDK
    // rejects ("CONSTRUCTOR_PARAMS[0] cannot contain pipe"); that is exactly
    // how the first live run of this leg failed, so these pin the shape.
    it('assembleParams passes v2 CONSTRUCTOR_PARAMS through as an ARRAY, never pipe-joined', () => {
        const p = assembleParams({ codeHash: HASH, gasLimit: '1', constructorParams: ['a', 'b'] });
        expect(p.CONSTRUCTOR_PARAMS).toEqual(['a', 'b']);
    });

    it('assembleParams splits a pipe-delimited string into the array the wire wants', () => {
        const p = assembleParams({ codeHash: HASH, gasLimit: '1', constructorParams: 'a|b|c' });
        expect(p.CONSTRUCTOR_PARAMS).toEqual(['a', 'b', 'c']);
    });

    it('assembleParams drops empty segments so a trailing pipe cannot inject a blank arg', () => {
        const p = assembleParams({ codeHash: HASH, gasLimit: '1', constructorParams: 'a||b|' });
        expect(p.CONSTRUCTOR_PARAMS).toEqual(['a', 'b']);
    });

    it('assembleParams refuses multiple constructor args on stakeable v3 (single plain field)', () => {
        expect(() => assembleParams({
            codeHash: HASH, gasLimit: '1', cooldownBlocks: '144', constructorParams: ['a', 'b'],
        })).toThrow(/single field and accepts one entry/);
    });

    it('assembleParams keeps a lone v3 constructor arg as a scalar', () => {
        const p = assembleParams({ codeHash: HASH, gasLimit: '1', cooldownBlocks: '144', constructorParams: ['only'] });
        expect(p.CONSTRUCTOR_PARAMS).toBe('only');
    });
});

describe('PC-38 planChunkedDeploy', () => {
    it('refuses an SDK build without the planner rather than guessing the chunk math', () => {
        expect(() => planChunkedDeploy({
            sdkRegistry: registryOf({}), chainId: 'c', code: 'x',
        })).toThrow(/planDeploy/);
    });
});

describe('PC-38 deployChunkedRun', () => {
    beforeEach(() => submitAction.mockReset());

    function okSubmit() {
        let n = 0;
        submitAction.mockImplementation(async () => {
            n += 1;
            return { txid: `tx${n}`, indexed: { action_index: 1000 + n } };
        });
    }

    it('refuses a source that fits one action (that is deployAction s job)', async () => {
        const { opts } = baseOpts({ opts: { code: 'small' } });
        await expect(deployChunkedRun(opts)).rejects.toThrow(/single DEPLOY/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('sends every carrier in order, then the assembler last', async () => {
        okSubmit();
        const { opts } = baseOpts();
        await deployChunkedRun(opts);
        const sent = submitAction.mock.calls.map((c) => c[0].actionData.params);
        expect(sent).toHaveLength(4);
        expect(sent.slice(0, 3).map((p) => [p.VERSION, p.CHUNK_INDEX, p.CODE_PART]))
            .toEqual([['4', '0', 'p0'], ['4', '1', 'p1'], ['4', '2', 'p2']]);
        expect(sent[3].VERSION).toBe('2');
        expect(sent[3].CODE_HASH).toBe(HASH);
    });

    it('pins every leg to the SAME source address (chunks are gathered per-deployer)', async () => {
        okSubmit();
        const { opts } = baseOpts();
        await deployChunkedRun(opts);
        for (const call of submitAction.mock.calls) {
            expect(call[0].encoderOpts.sourceAddress).toBe(FROM.address);
            expect(call[0].encoderOpts.change).toBe(FROM.address);
        }
    });

    it('waits for the indexer on every leg (carriers must precede the assembly)', async () => {
        okSubmit();
        const { opts } = baseOpts();
        await deployChunkedRun(opts);
        for (const call of submitAction.mock.calls) {
            expect(typeof call[0].waitForTxid).toBe('function');
        }
    });

    it('persists each confirmed chunk BEFORE the next leg, so a crash loses nothing', async () => {
        const vault = fakeVault();
        const putsAtSubmit = [];
        submitAction.mockImplementation(async () => {
            // snapshot how many chunk action_indexes are already persisted
            const rec = [...vault.store.values()][0];
            putsAtSubmit.push(rec ? rec.chunks.filter((c) => c.actionIndex).length : 0);
            return { txid: 'tx', indexed: { action_index: 7 } };
        });
        const { opts } = baseOpts({ vault });
        await deployChunkedRun(opts);
        // leg N sees exactly N-1 chunks already recorded
        expect(putsAtSubmit).toEqual([0, 1, 2, 3]);
    });

    it('stops (resumably) when a carrier does not index instead of assembling a broken group', async () => {
        submitAction.mockImplementation(async () => ({ txid: 'tx', indexed: null }));
        const { opts } = baseOpts();
        await expect(deployChunkedRun(opts)).rejects.toThrow(/did not index/);
        expect(submitAction).toHaveBeenCalledTimes(1);
    });

    // Found by driving a full three-leg deploy on Bitcoin regtest.
    //
    // `waitForTxid` settles from two different shapes and every test above
    // models only one of them. The WEBSOCKET fast path settles with a
    // NEW_ACTION event (`action_index` at the top level); the POLLING fallback
    // settles with the explorer's TRANSACTION row, which carries the index
    // inside `actions[]` and nothing at the top. Reading only the first field
    // meant that on any venue without a live socket - the ordinary case - leg 1
    // resolved fine and then read `null`, so the run aborted with "chunk 1 did
    // not index" over a chunk that was on chain, valid, and paid for.
    it('reads the leg index from the POLLING shape, not just the websocket one', async () => {
        let n = 0;
        submitAction.mockImplementation(async () => {
            n += 1;
            return {
                txid: `tx${n}`,
                // Exactly what explorer.getTransaction returns, which is what
                // ActionWaiter's poll path resolves with.
                indexed: {
                    tx_hash: `tx${n}`,
                    block_index: 100 + n,
                    actions: [{ action_index: 2000 + n, action: 'DEPLOY', status: 'valid' }],
                },
            };
        });
        const vault = fakeVault();
        const { opts } = baseOpts({ vault });
        await deployChunkedRun(opts);
        expect(submitAction).toHaveBeenCalledTimes(4);
        const record = [...vault.store.values()][0];
        expect(record.chunks.map((c) => c.actionIndex)).toEqual(['2001', '2002', '2003']);
        expect(record.contractActionIndex).toBe('2004');
        expect(record.stage).toBe('done');
    });

    it('still prefers the websocket event index when both shapes are present', async () => {
        submitAction.mockImplementation(async () => ({
            txid: 'tx',
            indexed: { action_index: 11, actions: [{ action_index: 99, action: 'DEPLOY' }] },
        }));
        const vault = fakeVault();
        const { opts } = baseOpts({ vault });
        await deployChunkedRun(opts);
        expect([...vault.store.values()][0].chunks.map((c) => c.actionIndex))
            .toEqual(['11', '11', '11']);
    });

    it('still refuses when the transaction carries no action at all', async () => {
        // The honest negative: a transaction row with an empty action list is
        // NOT a leg that indexed, and treating it as one would assemble a group
        // whose carrier the indexer never saw.
        submitAction.mockImplementation(async () => ({
            txid: 'tx', indexed: { tx_hash: 'tx', block_index: 5, actions: [] },
        }));
        const { opts } = baseOpts();
        await expect(deployChunkedRun(opts)).rejects.toThrow(/did not index/);
        expect(submitAction).toHaveBeenCalledTimes(1);
    });

    it('refuses to resume a record whose source changed (CODE_HASH mismatch)', async () => {
        const vault = fakeVault();
        vault.store.set('r1', {
            id: 'r1', walletId: 'w1', chainId: 'c', sourceAddress: FROM.address,
            codeHash: 'b'.repeat(64), totalChunks: 3, chunks: [], stage: 'chunking',
        });
        const { opts } = baseOpts({ vault, opts: { resumeId: 'r1' } });
        await expect(deployChunkedRun(opts)).rejects.toThrow(/CODE_HASH mismatch/);
    });

    it('refuses to resume from a different address (would orphan the paid-for chunks)', async () => {
        const vault = fakeVault();
        vault.store.set('r1', {
            id: 'r1', walletId: 'w1', chainId: 'c', sourceAddress: 'someone-else',
            codeHash: HASH, totalChunks: 3, chunks: [], stage: 'chunking',
        });
        const { opts } = baseOpts({ vault, opts: { resumeId: 'r1' } });
        await expect(deployChunkedRun(opts)).rejects.toThrow(/same address/);
    });

    it('resume re-sends only the chunks the chain does not confirm', async () => {
        okSubmit();
        const vault = fakeVault();
        vault.store.set('r1', {
            id: 'r1', walletId: 'w1', chainId: 'c', sourceAddress: FROM.address,
            codeHash: HASH, code: 'x'.repeat(500), totalChunks: 3, stage: 'chunking',
            assembleParams: {}, deployTxid: null, contractActionIndex: null,
            chunks: [
                { index: 0, txid: 't0', actionIndex: '900' },
                { index: 1, txid: null, actionIndex: null },
                { index: 2, txid: 't2', actionIndex: '902' },
            ],
        });
        const sdk = fakeSdk({
            getAction: vi.fn(async (idx) => ({
                status: 'valid', code_hash: HASH, chunk_index: idx === '900' ? 0 : 2,
            })),
        });
        const { opts } = baseOpts({ vault, sdk, opts: { resumeId: 'r1' } });
        await deployChunkedRun(opts);
        const sent = submitAction.mock.calls.map((c) => c[0].actionData.params);
        // only chunk 1 re-sent, then the assembler
        expect(sent).toHaveLength(2);
        expect([sent[0].VERSION, sent[0].CHUNK_INDEX]).toEqual(['4', '1']);
        expect(sent[1].VERSION).toBe('2');
    });
});

describe('PC-38 verifyRecordedChunks fails toward re-sending', () => {
    const record = {
        codeHash: HASH,
        chunks: [{ index: 0, txid: 't', actionIndex: '900' }],
    };

    it('counts a valid, matching row as confirmed', async () => {
        const sdk = fakeSdk({ getAction: vi.fn(async () => ({ status: 'valid', code_hash: HASH, chunk_index: 0 })) });
        expect([...(await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record })).confirmed]).toEqual([0]);
    });

    it('does NOT confirm an invalid row', async () => {
        const sdk = fakeSdk({ getAction: vi.fn(async () => ({ status: 'invalid: whatever', code_hash: HASH, chunk_index: 0 })) });
        expect([...(await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record })).confirmed]).toEqual([]);
    });

    it('does NOT confirm a row belonging to a different code hash', async () => {
        const sdk = fakeSdk({ getAction: vi.fn(async () => ({ status: 'valid', code_hash: 'b'.repeat(64), chunk_index: 0 })) });
        expect([...(await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record })).confirmed]).toEqual([]);
    });

    it('does NOT confirm a row at a different chunk position', async () => {
        const sdk = fakeSdk({ getAction: vi.fn(async () => ({ status: 'valid', code_hash: HASH, chunk_index: 5 })) });
        expect([...(await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record })).confirmed]).toEqual([]);
    });

    it('does NOT confirm when the read throws (a reorg-dropped chunk must be re-sent)', async () => {
        const sdk = fakeSdk({ getAction: vi.fn(async () => { throw new Error('gone'); }) });
        expect([...(await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record })).confirmed]).toEqual([]);
    });
});

// Found by interrupting a real two-chunk run on Bitcoin regtest during
// leg 2's indexer wait. The result was THREE carriers: 2223 (chunk 0), 2224
// (chunk 1, from the interrupted run) and 2225 (chunk 1 again, from the resume).
// Rule 3 dedups by position so nothing corrupted, but 2225 was a fee paid for
// nothing - against a banner that promises "Finishing costs only the remaining
// ones".
//
// The cause is a WINDOW, not a wrong check: a chunk's action_index is only
// knowable after the indexer answers, so the record held nothing for a chunk
// that was already broadcast. The txid is knowable at broadcast.
describe('a chunk broadcast but not yet indexed is recoverable from its txid', () => {
    const txidRecord = {
        codeHash: HASH,
        chunks: [{ index: 0, txid: 'abc', actionIndex: null }],
    };
    const txWith = (actions) => vi.fn(async () => ({ tx_hash: 'abc', actions }));

    it('resolves the txid to its action and counts the chunk as confirmed', async () => {
        const sdk = fakeSdk({
            getTransaction: txWith([{ action: 'DEPLOY', action_index: '2224' }]),
            getAction: vi.fn(async () => ({ status: 'valid', code_hash: HASH, chunk_index: 0 })),
        });
        const out = await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record: txidRecord });
        expect([...out.confirmed]).toEqual([0]);
        // And the recovered index is handed back so the caller can persist it:
        // a second interruption should not have to re-derive it.
        expect(out.backfilled).toEqual([{ index: 0, actionIndex: '2224' }]);
        expect(sdk.getAction).toHaveBeenCalledWith('2224');
    });

    it('holds a txid-resolved chunk to the SAME standard as a recorded index', async () => {
        // An indexed-but-INVALID carrier is not a chunk the assembler can use;
        // skipping it would buy an assembly that cannot succeed.
        const sdk = fakeSdk({
            getTransaction: txWith([{ action: 'DEPLOY', action_index: '2224' }]),
            getAction: vi.fn(async () => ({ status: 'invalid: insufficient funds (GAS)', code_hash: HASH, chunk_index: 0 })),
        });
        const out = await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record: txidRecord });
        expect([...out.confirmed]).toEqual([]);
        expect(out.backfilled).toEqual([]);
    });

    it('does not confirm a txid the chain has no action for yet', async () => {
        const sdk = fakeSdk({ getTransaction: txWith([]) });
        const out = await verifyRecordedChunks({ sdkRegistry: registryOf(sdk), chainId: 'c', record: txidRecord });
        expect([...out.confirmed]).toEqual([]);
    });

    it('does not confirm when the transaction read throws, or the SDK cannot do it', async () => {
        const throwing = fakeSdk({ getTransaction: vi.fn(async () => { throw new Error('nope'); }) });
        expect([...(await verifyRecordedChunks({ sdkRegistry: registryOf(throwing), chainId: 'c', record: txidRecord })).confirmed])
            .toEqual([]);
        const older = fakeSdk({});
        delete older.getTransaction;
        expect([...(await verifyRecordedChunks({ sdkRegistry: registryOf(older), chainId: 'c', record: txidRecord })).confirmed])
            .toEqual([]);
    });

    it('records the txid at BROADCAST, not after the indexer answers', async () => {
        // The write side of the same defect: without this the record is empty
        // for the whole indexer wait, which is the window the interruption fell
        // into. `submitWithSigner` emits 'waiting' with the final txid right
        // after broadcast.
        const vault = fakeVault();
        const seenAtWaiting = [];
        submitAction.mockImplementation(async (args) => {
            args.onProgress('waiting', { txid: 'tx-in-flight' });
            const rec = [...vault.store.values()][0];
            seenAtWaiting.push((rec.chunks || []).filter((c) => c.txid).map((c) => c.txid));
            return { txid: 'tx-in-flight', indexed: { action_index: 7 } };
        });
        const { opts } = baseOpts({ vault });
        await deployChunkedRun(opts);
        // Leg 1's txid is in the record DURING leg 1, before its wait returned.
        expect(seenAtWaiting[0]).toEqual(['tx-in-flight']);
    });
});

// that second window, found by re-driving the fix for the first one: a chunk
// whose txid is recorded but which the chain carries no action for YET, because
// the transaction is still unmined. Measured live - a resume re-sent a chunk that
// was in the mempool and confirmed a moment later, so one position ended up with
// two paid carriers. The txid is known, so the honest move is to WAIT on it.
describe('a recorded txid that has not been mined yet is waited on, not re-sent', () => {
    beforeEach(() => submitAction.mockReset());

    function resumableVault(chunk0) {
        const vault = fakeVault();
        vault.store.set('r1', {
            id: 'r1', walletId: 'w1', chainId: 'c', sourceAddress: FROM.address,
            codeHash: HASH, code: 'x'.repeat(500), totalChunks: 3, stage: 'chunking',
            assembleParams: { VERSION: '2', CODE_HASH: HASH, GAS_LIMIT: '100000' },
            chunks: [chunk0,
                { index: 1, txid: null, actionIndex: null },
                { index: 2, txid: null, actionIndex: null }],
        });
        return vault;
    }

    it('waits on the txid and skips the chunk when it confirms', async () => {
        submitAction.mockImplementation(async () => ({ txid: 'tx', indexed: { action_index: 1 } }));
        // Unresolvable at verify time (still in the mempool), then it confirms.
        const sdk = fakeSdk({
            getTransaction: vi.fn(async () => ({ tx_hash: 'in-flight', actions: [] })),
            getAction: vi.fn(async () => ({ status: 'valid', code_hash: HASH, chunk_index: 0 })),
            waitForAction: vi.fn(async () => ({
                tx_hash: 'in-flight', actions: [{ action: 'DEPLOY', action_index: '2233' }],
            })),
        });
        const vault = resumableVault({ index: 0, txid: 'in-flight', actionIndex: null });
        const { opts } = baseOpts({ vault, sdk, opts: { resumeId: 'r1' } });
        await deployChunkedRun(opts);
        const sent = submitAction.mock.calls.map((c) => c[0].actionData.params);
        // Chunk 0 was NOT re-sent: only chunks 1 and 2, then the assembler.
        expect(sent.filter((p) => p.VERSION === '4').map((p) => p.CHUNK_INDEX)).toEqual(['1', '2']);
        expect(sdk.waitForAction).toHaveBeenCalledWith('in-flight', undefined);
        // And the recovered index is persisted, so a later interruption sees it.
        expect([...vault.store.values()][0].chunks[0].actionIndex).toBe('2233');
    });

    it('re-sends when the recorded txid never confirms', async () => {
        // The honest fallback: a transaction that is genuinely gone must not
        // block the run forever, and rule 3 makes a duplicate harmless.
        submitAction.mockImplementation(async () => ({ txid: 'tx', indexed: { action_index: 1 } }));
        const sdk = fakeSdk({
            getTransaction: vi.fn(async () => ({ tx_hash: 'dead', actions: [] })),
            waitForAction: vi.fn(async () => { throw new Error('CONFIRMATION_TIMEOUT'); }),
        });
        const vault = resumableVault({ index: 0, txid: 'dead', actionIndex: null });
        const { opts } = baseOpts({ vault, sdk, opts: { resumeId: 'r1' } });
        await deployChunkedRun(opts);
        const sent = submitAction.mock.calls.map((c) => c[0].actionData.params);
        expect(sent.filter((p) => p.VERSION === '4').map((p) => p.CHUNK_INDEX)).toEqual(['0', '1', '2']);
    });

    it('does not skip a chunk whose awaited action belongs to another group', async () => {
        // A txid that confirmed as something else entirely is not this chunk;
        // skipping it would assemble a group with a hole in it.
        submitAction.mockImplementation(async () => ({ txid: 'tx', indexed: { action_index: 1 } }));
        const sdk = fakeSdk({
            getTransaction: vi.fn(async () => ({ tx_hash: 'other', actions: [] })),
            waitForAction: vi.fn(async () => ({
                tx_hash: 'other', actions: [{ action: 'DEPLOY', action_index: '5000' }],
            })),
            getAction: vi.fn(async () => ({ status: 'valid', code_hash: 'b'.repeat(64), chunk_index: 0 })),
        });
        const vault = resumableVault({ index: 0, txid: 'other', actionIndex: null });
        const { opts } = baseOpts({ vault, sdk, opts: { resumeId: 'r1' } });
        await deployChunkedRun(opts);
        const sent = submitAction.mock.calls.map((c) => c[0].actionData.params);
        expect(sent.filter((p) => p.VERSION === '4').map((p) => p.CHUNK_INDEX)).toEqual(['0', '1', '2']);
    });
});

// The assembling leg on a resume must be the one that was PLANNED.
describe('a resumed run assembles from the record, not from current arguments', () => {
    // Own the mock's state: these read `mock.calls` to find the ASSEMBLER, and a
    // call recorded by an earlier describe would shift which leg that is.
    beforeEach(() => submitAction.mockReset());

    it('uses the stored assembleParams rather than rebuilding from opts', async () => {
        const vault = fakeVault();
        vault.store.set('r1', {
            id: 'r1', walletId: 'w1', chainId: 'c', sourceAddress: FROM.address,
            codeHash: HASH, code: 'x'.repeat(500), totalChunks: 3, stage: 'chunking',
            // What the ORIGINAL deploy planned: a stakeable v3 with a constructor arg.
            assembleParams: {
                VERSION: '3', CODE_HASH: HASH, GAS_LIMIT: '250000',
                CONSTRUCTOR_PARAMS: 'seed', COOLDOWN_BLOCKS: '144', SLASH_DESTINATION: 'BURN',
            },
            chunks: [
                { index: 0, txid: 't0', actionIndex: '900' },
                { index: 1, txid: 't1', actionIndex: '901' },
                { index: 2, txid: null, actionIndex: null },
            ],
        });
        const sdk = fakeSdk({
            getAction: vi.fn(async () => ({ status: 'valid', code_hash: HASH, chunk_index: 0 })),
        });
        // Deliberately WRONG current arguments - the shape a resume actually has,
        // since the form's resume button restores only the code and the name.
        submitAction.mockImplementation(async () => ({ txid: 'tx', indexed: { action_index: 1 } }));
        const { opts } = baseOpts({
            vault,
            sdk,
            opts: { resumeId: 'r1', gasLimit: '999', constructorParams: undefined, cooldownBlocks: undefined },
        });
        // getAction is stubbed to report chunk_index 0 for every read, so only
        // chunk 0 verifies; chunks 1 and 2 are re-sent. What matters here is the
        // ASSEMBLER, which is the last leg.
        await deployChunkedRun(opts);
        const sent = submitAction.mock.calls.map((c) => c[0].actionData.params);
        const assembler = sent[sent.length - 1];
        expect(assembler.VERSION, 'a stakeable v3 deploy resumed as a non-stakeable v2').toBe('3');
        expect(assembler.GAS_LIMIT, 'the resumed assembler used the current field, not the planned limit')
            .toBe('250000');
        expect(assembler.CONSTRUCTOR_PARAMS, 'the constructor argument was dropped on resume').toBe('seed');
        expect(assembler.COOLDOWN_BLOCKS).toBe('144');
        expect(assembler.SLASH_DESTINATION).toBe('BURN');
    });

    it('still rebuilds from opts for a FRESH run, and when the stored params are for another source', async () => {
        submitAction.mockImplementation(async () => ({ txid: 'tx', indexed: { action_index: 1 } }));
        const { opts } = baseOpts({ opts: { gasLimit: '123456' } });
        await deployChunkedRun(opts);
        const sent = submitAction.mock.calls.map((c) => c[0].actionData.params);
        expect(sent[sent.length - 1].GAS_LIMIT).toBe('123456');

        // A record whose stored params carry a different CODE_HASH cannot be
        // trusted for this group; fall back to rebuilding rather than assembling
        // someone else's plan.
        submitAction.mockReset();
        submitAction.mockImplementation(async () => ({ txid: 'tx', indexed: { action_index: 1 } }));
        const vault = fakeVault();
        vault.store.set('r2', {
            id: 'r2', walletId: 'w1', chainId: 'c', sourceAddress: FROM.address,
            codeHash: HASH, code: 'x'.repeat(500), totalChunks: 3, stage: 'chunking',
            assembleParams: { VERSION: '2', CODE_HASH: 'c'.repeat(64), GAS_LIMIT: '777' },
            chunks: [{ index: 0, txid: null, actionIndex: null },
                { index: 1, txid: null, actionIndex: null },
                { index: 2, txid: null, actionIndex: null }],
        });
        const { opts: o2 } = baseOpts({ vault, opts: { resumeId: 'r2', gasLimit: '4242' } });
        await deployChunkedRun(o2);
        const sent2 = submitAction.mock.calls.map((c) => c[0].actionData.params);
        expect(sent2[sent2.length - 1].GAS_LIMIT).toBe('4242');
    });
});
