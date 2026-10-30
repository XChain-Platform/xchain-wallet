// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The delegate and revoke composers read the address's indexed stakes and
// delegations again before signing. A revoke of a key revoked while the review
// was open, a rotate to a key another stake holds, a rotate from an address
// with no active stake, and any of these with the indexer unreachable are
// refused with nothing signed; the indexer would record each as invalid and
// keep the fee. A valid delegation is signed with the params it was given.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'tx' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { delegateAction, revokeDelegationAction } from '../../../packages/core/src/flows/delegateRevokeActions.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const key = (i) => bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(i)));
const K0 = key(1); // this address's stake key
const K1 = key(2); // this address's delegated key
const K2 = key(3); // a fresh key
const KV = key(4); // another validator's stake key
const SOURCE = 'bcrt1qsource';
const OTHER = 'bcrt1qother';
const HEIGHT = 200;

const stake = (source, k, extra = {}) => ({ source, signing_pubkey: k, amount: '1000', activation_block: 150, deactivation_block: null, status: 'valid', ...extra });
const delegation = (k, extra = {}) => ({ source: SOURCE, signing_pubkey: k, activation_block: 170, deactivation_block: null, status: 'valid', action_index: 120, ...extra });

function fakeSdk({ stakes = [stake(SOURCE, K0)], delegations = [delegation(K1)], roster = [stake(SOURCE, K0), stake(OTHER, KV)], status, fail } = {}) {
    const answer = (rows) => (fail ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve({ data: rows, total: rows.length }));
    return {
        explorer: { coin: 'RBTC' },
        getStatus: vi.fn(async () => status ?? { last_block: { RBTC: HEIGHT } }),
        getStakes: vi.fn(() => answer(stakes)),
        getDelegations: vi.fn(() => answer(delegations)),
        getValidators: vi.fn(() => answer(roster)),
    };
}

function base(sdk) {
    return {
        chainRegistry: defaultRegistry(),
        sdkRegistry: { get: () => sdk },
        chainId: 'bitcoin-regtest',
        walletId: 'w',
        password: 'pw',
        from: { address: SOURCE, publicKey: '02' + 'a'.repeat(64), derivationPath: "m/84'/1'/0'/0/0" },
    };
}
const revoke = (sdk, k) => revokeDelegationAction({ ...base(sdk), params: { VERSION: '2', SIGNING_PUBKEY: k } });
const rotate = (sdk, k) => delegateAction({ ...base(sdk), params: { VERSION: '0', NEW_SIGNING_PUBKEY: k } });

beforeEach(() => { vi.mocked(submitAction).mockClear(); });

describe('revoke at signing', () => {
    it('refuses a key whose revocation took effect while the review was open', async () => {
        const sdk = fakeSdk({ delegations: [delegation(K1, { deactivation_block: 195 })] });
        await expect(revoke(sdk, K1)).rejects.toThrow('nothing to revoke');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('refuses a key whose revocation is recorded and still pending', async () => {
        const sdk = fakeSdk({ delegations: [delegation(K1, { deactivation_block: 206 })] });
        await expect(revoke(sdk, K1)).rejects.toThrow("This key's revocation is already recorded.");
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('signs a revoke of an active delegation, unchanged', async () => {
        await revoke(fakeSdk(), K1);
        expect(vi.mocked(submitAction).mock.calls[0][0].actionData).toEqual({ action: 'DELEGATE', params: { VERSION: '2', SIGNING_PUBKEY: K1 } });
    });

    it('signs a revoke of a key delegated again after an earlier revocation', async () => {
        const sdk = fakeSdk({ delegations: [delegation(K1, { deactivation_block: 100, action_index: 80 }), delegation(K1)] });
        await revoke(sdk, K1);
        expect(submitAction).toHaveBeenCalledTimes(1);
    });

    it("signs a revoke of the address's own stake key", async () => {
        await revoke(fakeSdk(), K0);
        expect(submitAction).toHaveBeenCalledTimes(1);
    });
});

describe('rotate at signing', () => {
    it("refuses another validator's stake key", async () => {
        await expect(rotate(fakeSdk(), KV)).rejects.toThrow('already signs for a stake');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('refuses a key this address already delegates, in either case', async () => {
        await expect(rotate(fakeSdk(), K1.toUpperCase())).rejects.toThrow('already delegated from this address');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('refuses an address with no active stake', async () => {
        const sdk = fakeSdk({ stakes: [stake(SOURCE, K0, { deactivation_block: 190 })], delegations: [] });
        await expect(rotate(sdk, K2)).rejects.toThrow('no active stake');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('signs a fresh key, unchanged', async () => {
        await rotate(fakeSdk(), K2);
        expect(vi.mocked(submitAction).mock.calls[0][0].actionData).toEqual({ action: 'DELEGATE', params: { VERSION: '0', NEW_SIGNING_PUBKEY: K2 } });
    });
});

describe('unreadable indexer at signing', () => {
    it.each([
        ['the reads fail', fakeSdk({ fail: true })],
        ['the indexed height is missing', fakeSdk({ status: { last_block: {} } })],
    ])('refuses delegate and revoke when %s', async (_name, sdk) => {
        await expect(rotate(sdk, K2)).rejects.toThrow('Could not check this delegation against the network. Try again.');
        await expect(revoke(sdk, K1)).rejects.toThrow('Could not check this delegation against the network. Try again.');
        expect(submitAction).not.toHaveBeenCalled();
    });
});

describe('refusal copy', () => {
    it('reaches the form as the sentence itself, not the generic failure line', async () => {
        const { submitFailureMessage } = await import('../../../packages/core/src/shared/utils/submitFailureMessage.js');
        const err = await rotate(fakeSdk(), KV).catch((e) => e);
        // Only name and message cross the messaging boundary.
        const crossed = Object.assign(new Error(err.message), { name: err.name });
        expect(submitFailureMessage(crossed, { chainId: 'bitcoin-regtest', coinTicker: 'BTC', fallback: crossed.message }))
            .toBe('This key already signs for a stake. Choose a key no stake or delegation uses.');
    });
});
