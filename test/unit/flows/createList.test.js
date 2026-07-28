// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// createList must name the funding address, not just the pubkey .
//
// Wallet E2E session 20: Manage Token -> More -> Official list -> Publish list
// died at step 1 with "Error getting utxos: <pubkey> has no matching Script".
// The pubkey was the wallet's own funding key; the encoder resolved it to the
// p2pkh script, which held nothing, while the funded address was the p2wpkh
// (bech32) form of the same key. createList passed only `pubkey`, so the SDK
// never got the address it needed to pre-select UTXOs.
//
// Sibling of sendToken , advancedAction (D-17/D-18) and
// dispenserAction . It stayed latent because the confirm-modal lane
// hands submitAction a prebuiltPsbt and skips createTx entirely; only the
// legacy direct-dispatch publishes (official-token list, list fork, airdrop,
// watcher/HW branches) build the tx from these encoderOpts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'list-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { createList } from '../../../packages/core/src/flows/createList.js';

// The reproduction source: a bech32 address whose pubkey resolves to a
// DIFFERENT (p2pkh) script, which is exactly what broke the live lane.
const FROM = {
    address: 'bcrt1qu00xeemayv8s503x4zfp7sdhxn73xwnvxjtnfc',
    publicKey: '02d29101b24f1a3d7aa030c799a94c805d6828b1176523a5c1fb7ebae7b5c12e4b',
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(params, extra = {}) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ nativeTicker: 'BTC' }) },
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
        ...extra,
    };
}

// v0 TYPE=1 is the official-token roster shape (ProjectRosterForm);
// TYPE=2 is the airdrop address list; v1 is the edit-existing shape.
const ROSTER = { VERSION: '0', TYPE: '1', ITEM: ['PEPECREATURE', 'EXAMPLE'] };
const ADDRESS_LIST = { VERSION: '0', TYPE: '2', ITEM: ['bcrt1qrecipient'] };
const EDIT_ADD = { VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '412', ITEM: ['EXAMPLE'] };
const EDIT_REMOVE = { VERSION: '1', EDIT: '2', LIST_ACTION_INDEX: '412', ITEM: ['EXAMPLE'] };

function encoderOptsOfLastCall() {
    const calls = vi.mocked(submitAction).mock.calls;
    return calls[calls.length - 1][0].encoderOpts;
}

describe('createList names the funding address for UTXO selection', () => {
    beforeEach(() => { vi.mocked(submitAction).mockClear(); });

    it('[REGRESSION] the official-token roster publish passes sourceAddress', async () => {
        await createList(opts(ROSTER));
        expect(encoderOptsOfLastCall().sourceAddress).toBe(FROM.address);
    });

    it('[REGRESSION] the address list (airdrop half) passes sourceAddress', async () => {
        await createList(opts(ADDRESS_LIST));
        expect(encoderOptsOfLastCall().sourceAddress).toBe(FROM.address);
    });

    it('[REGRESSION] v1 add passes sourceAddress', async () => {
        await createList(opts(EDIT_ADD));
        expect(encoderOptsOfLastCall().sourceAddress).toBe(FROM.address);
    });

    it('[REGRESSION] v1 remove passes sourceAddress', async () => {
        await createList(opts(EDIT_REMOVE));
        expect(encoderOptsOfLastCall().sourceAddress).toBe(FROM.address);
    });

    it('supplies change as well, which is a separate concern (the change sink)', async () => {
        await createList(opts(ROSTER));
        expect(encoderOptsOfLastCall().change).toBe(FROM.address);
    });

    it('keeps sending the pubkey the encoder signs against', async () => {
        await createList(opts(ROSTER));
        expect(encoderOptsOfLastCall().pubkey).toBe(FROM.publicKey);
    });

    it('never leaks sourceAddress onto the action params (SDK-side only)', async () => {
        await createList(opts(ROSTER));
        const { actionData } = vi.mocked(submitAction).mock.calls[0][0];
        expect(actionData.action).toBe('LIST');
        expect(actionData.params).not.toHaveProperty('sourceAddress');
        expect(actionData.params).not.toHaveProperty('change');
    });

    it('leaves the optional fee knobs alone', async () => {
        await createList(opts(ROSTER, { feePerKb: 2500, rbf: true, payFeeInNativeCoin: true }));
        const encoderOpts = encoderOptsOfLastCall();
        expect(encoderOpts.feePerKb).toBe(2500);
        expect(encoderOpts.rbf).toBe(true);
        expect(encoderOpts.payFeeInNativeCoin).toBe(true);
        expect(encoderOpts).not.toHaveProperty('fee');
    });
});
