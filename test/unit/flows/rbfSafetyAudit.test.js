// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { planRbfReplacement } from '../../../packages/core/src/flows/rbfPlan.js';
import {
    cancelUndoSnapshot,
    sendRbfRequest,
} from '../../../packages/core/src/flows/rbfReplace.js';
import { probeTxInclusion } from '../../../packages/core/src/flows/txInclusionProbe.js';
import { livePendingTxs } from '../../../packages/core/src/flows/pendingTxFeed.js';

const HASH = 'aa'.repeat(32);
const OTHER_HASH = 'bb'.repeat(32);
const SOURCE = 'bcrt1qwallet';

function replacementTx() {
    return {
        inputs: [{
            prevTxHash: HASH,
            prevTxIndex: 0,
            sequence: 0xfffffffd,
            value: 10_000,
            scriptPubKeyHex: `0014${'11'.repeat(20)}`,
        }],
        outputs: [
            { address: 'bcrt1qrecipient', value: 7_000 },
            { address: SOURCE, value: 2_000 },
        ],
    };
}

describe('RBF safety audit regressions', () => {
    it('rejects a replacement plan that counts one outpoint twice', () => {
        const conflict = replacementTx();
        conflict.inputs.push({ ...conflict.inputs[0] });

        expect(() => planRbfReplacement({
            strategy: 'speedup', conflict, sourceAddress: SOURCE,
        })).toThrow(/duplicates an earlier outpoint/);
    });

    it('treats differently cased transaction hashes as the same self-replacement', async () => {
        const replaceTx = vi.fn();
        await expect(sendRbfRequest({
            messaging: { replaceTx },
            request: {
                chainId: 'bitcoin-regtest',
                originalTxHash: HASH.toUpperCase(),
                restoreTxHash: HASH,
                strategy: 'restore',
            },
        })).rejects.toThrow(/must differ/);
        expect(replaceTx).not.toHaveBeenCalled();
        expect(cancelUndoSnapshot({
            entry: { chainId: 'bitcoin-regtest', txHash: HASH.toUpperCase() },
            result: { replacementTxHash: HASH },
        })).toBeNull();
    });

    it('shares concurrent duplicate broadcasts and refuses a competing replacement', async () => {
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        const replaceTx = vi.fn(() => pending);
        const messaging = { replaceTx };
        const request = {
            chainId: 'bitcoin-regtest', walletId: 'wallet-1', originalTxHash: HASH, strategy: 'speedup',
        };

        const first = sendRbfRequest({ messaging, request });
        const duplicate = sendRbfRequest({ messaging, request: { ...request } });
        await expect(sendRbfRequest({
            messaging,
            request: { ...request, strategy: 'cancel' },
        })).rejects.toThrow(/already in progress/);
        expect(replaceTx).toHaveBeenCalledTimes(1);

        const result = { replacementTxHash: OTHER_HASH };
        release(result);
        await expect(Promise.all([first, duplicate])).resolves.toEqual([result, result]);
        expect(replaceTx).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed probe hashes before calling either lookup service', async () => {
        const getTxBlock = vi.fn();
        const getTransaction = vi.fn();
        await expect(probeTxInclusion({
            sdk: { encoder: { getTxBlock }, getTransaction },
            txids: [HASH, 'not-a-txid'],
        })).rejects.toThrow(/32-byte hexadecimal/);
        expect(getTxBlock).not.toHaveBeenCalled();
        expect(getTransaction).not.toHaveBeenCalled();
    });

    it('logs a failed cleanup write and still loads the pending list', async () => {
        const live = {
            id: 'live',
            chain: 'BTC',
            network: 'regtest',
            fromAddress: SOURCE,
            txid: 'b'.repeat(64),
            status: 'broadcast',
        };
        const stale = {
            id: 'stale',
            chain: 'BTC',
            network: 'regtest',
            fromAddress: SOURCE,
            txid: HASH,
            status: 'indexed',
            chainConfirmed: true,
            confirmedAt: '2000-01-01T00:00:00.000Z',
        };
        const failure = new Error('vault save failed');
        const vault = {
            pendingTxs: {
                list: vi.fn(async () => [stale, live]),
                delete: vi.fn(async () => { throw failure; }),
            },
        };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            const out = await livePendingTxs({
                vault,
                chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest' }) },
                chainId: 'bitcoin-regtest',
            });
            // Under storage pressure the list still loads, so Speed up and
            // Cancel stay reachable for the live send; the record the cleanup
            // could not remove is still listed rather than reported as gone.
            expect(out.map((row) => row.id).sort()).toEqual(['live', 'stale']);
            expect(vault.pendingTxs.delete).toHaveBeenCalledWith('stale');
            expect(warn).toHaveBeenCalledWith('[xchain] pending transaction cleanup failed:', failure);
        } finally {
            warn.mockRestore();
        }
    });
});
