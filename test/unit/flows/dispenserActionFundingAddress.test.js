// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// dispenserAction must name the funding address, not just the pubkey (D-43).
//
// Sibling of the sendToken regression : the SDK says `change` is
// "deliberately NOT a fallback" for `sourceAddress` (xchain-sdk/src/encoder.js
// createTx), and dispenserAction supplied NEITHER - only `pubkey`. The encoder
// then resolved UTXOs from the raw pubkey and failed with
// "Error getting utxos: <pubkey> has no matching Script".
//
// Found live on BTC regtest refilling dispenser #35. It had stayed latent
// because Refill / Edit / Close were disabled on every real dispenser until
// ; the create lane composes through the confirm modal, which passes the
// address, so only the owner-lifecycle actions were affected.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'disp-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { dispenserAction } from '../../../packages/core/src/flows/dispenserAction.js';

const FROM = {
    address: 'bcrt1qowner',
    publicKey: '021d41c2',
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(params) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ nativeTicker: 'BTC' }) },
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
    };
}

// The three owner-lifecycle shapes: refill/edit (v2), cancel (v1).
const REFILL = { VERSION: '2', DISPENSER_ACTION_INDEX: '35', GIVE_ESCROW: '250' };
const EDIT = { VERSION: '2', DISPENSER_ACTION_INDEX: '35', EXPIRATION: '1900000000' };
const CANCEL = { VERSION: '1', DISPENSER_ACTION_INDEX: '35' };

describe('dispenserAction names the funding address for UTXO selection', () => {
    beforeEach(() => { vi.mocked(submitAction).mockClear(); });

    it('[REGRESSION] refill passes sourceAddress', async () => {
        await dispenserAction(opts(REFILL));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.sourceAddress).toBe(FROM.address);
    });

    it('[REGRESSION] edit passes sourceAddress', async () => {
        await dispenserAction(opts(EDIT));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.sourceAddress).toBe(FROM.address);
    });

    it('[REGRESSION] cancel passes sourceAddress', async () => {
        await dispenserAction(opts(CANCEL));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.sourceAddress).toBe(FROM.address);
    });

    it('supplies change as well, which is a separate concern (the change sink)', async () => {
        await dispenserAction(opts(REFILL));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.change).toBe(FROM.address);
    });

    it('keeps sending the pubkey the encoder signs against', async () => {
        await dispenserAction(opts(REFILL));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.pubkey).toBe(FROM.publicKey);
    });
});
