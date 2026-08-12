// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// `submitAction` is the one flow every issuer action funnels through
// (ISSUE, and so ownership transfer / description / mint settings; MINT; LOCK;
// DESTROY; CALLBACK), so it is where a broadcast that just changed a token
// drops the tick metadata that now describes the token as it used to be.
//
// The failure this guards against is not cosmetic: after the wallet broadcast
// an ownership transfer, Manage Token kept naming the previous owner and hid
// every issuer action from the new one until a full page reload.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const submitWithSignerMock = vi.fn();

vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', () => ({
    submitWithSigner: (...args) => submitWithSignerMock(...args),
    BroadcastFailedError: class BroadcastFailedError extends Error {},
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const {
    readTokenInfoCache,
    writeTokenInfoCache,
    tokenInfoCacheKey,
    clearTokenInfoCache,
} = await import('../../../packages/core/src/shared/utils/tokenInfoCache.js');

const CHAIN = 'bitcoin-regtest';
const TICK = 'S18PROBE';
const OTHER = 'UNRELATED';

/** Minimal collaborators: submitAction only needs a chain descriptor + settings. */
function harness() {
    return {
        vault: { settings: { get: async () => ({}), put: async () => {} } },
        chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) },
        sdkRegistry: {},
        signer: { signPsbt: async () => ({}) },
    };
}

function seedCache() {
    writeTokenInfoCache(tokenInfoCacheKey(CHAIN, TICK), { creator: 'previous-owner' });
    writeTokenInfoCache(tokenInfoCacheKey(CHAIN, OTHER), { creator: 'someone-else' });
}

beforeEach(() => {
    clearTokenInfoCache();
    submitWithSignerMock.mockReset();
    submitWithSignerMock.mockResolvedValue({
        txid: 'e870d83219f457bbe8f33db18e11a12d706f6fab0ea268ffc7c8fe5db28b56c8',
        actionString: 'ISSUE|...',
        action: 'ISSUE',
        encoding: 'OP_RETURN',
        signed: { txHex: '00', txid: 'e870d8', signedPsbtHex: '00' },
        indexed: null,
    });
});

afterEach(() => { clearTokenInfoCache(); });

describe('submitAction tick-metadata invalidation', () => {
    it('drops the cached record for the tick an ownership transfer moved', async () => {
        seedCache();
        const h = harness();

        await submitAction({
            vault: h.vault,
            walletId: 'w1',
            chainRegistry: h.chainRegistry,
            sdkRegistry: h.sdkRegistry,
            chainId: CHAIN,
            actionData: { action: 'ISSUE', params: { TICK, TRANSFER: 'bcrt1qnewowner' } },
            encoderOpts: { pubkey: 'ab' },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            signer: h.signer,
        });

        expect(readTokenInfoCache(tokenInfoCacheKey(CHAIN, TICK)).hit).toBe(false);
        expect(readTokenInfoCache(tokenInfoCacheKey(CHAIN, OTHER)).hit).toBe(true);
    });

    it('drops it for a MINT too, whose supply the issuer panel would keep showing stale', async () => {
        seedCache();
        const h = harness();

        await submitAction({
            vault: h.vault,
            walletId: 'w1',
            chainRegistry: h.chainRegistry,
            sdkRegistry: h.sdkRegistry,
            chainId: CHAIN,
            actionData: { action: 'MINT', params: { TICK, AMOUNT: '100' } },
            encoderOpts: { pubkey: 'ab' },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            signer: h.signer,
        });

        expect(readTokenInfoCache(tokenInfoCacheKey(CHAIN, TICK)).hit).toBe(false);
    });

    it('keeps the record when the broadcast never succeeded', async () => {
        seedCache();
        const h = harness();
        submitWithSignerMock.mockRejectedValue(new Error('encoder unreachable'));

        await expect(submitAction({
            vault: h.vault,
            walletId: 'w1',
            chainRegistry: h.chainRegistry,
            sdkRegistry: h.sdkRegistry,
            chainId: CHAIN,
            actionData: { action: 'ISSUE', params: { TICK, TRANSFER: 'bcrt1qnewowner' } },
            encoderOpts: { pubkey: 'ab' },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            signer: h.signer,
        })).rejects.toThrow('encoder unreachable');

        expect(readTokenInfoCache(tokenInfoCacheKey(CHAIN, TICK)).hit).toBe(true);
    });
});
