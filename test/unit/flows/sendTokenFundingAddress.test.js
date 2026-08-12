// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sendToken must name the funding address, not just the change sink.
//
// The SDK states outright that `change` is "deliberately NOT a fallback" for
// `sourceAddress` (xchain-sdk/src/encoder.js createTx): a change address is not
// always the spender, so selecting a funding set from it would hand create_tx
// UTXOs the signer cannot sign. sendToken passed only `change` while its comment
// claimed the fallback existed, so every caller composing through it left the
// encoder resolving UTXOs from the raw pubkey and failing with the opaque
// "Error getting utxos: <pubkey> has no matching Script".
//
// Found live on BTC regtest driving the dispenser token-paid Buy button, which
// only became reachable once un-blanked the pay-to address. The same flow
// backs the hardware-wallet send handler (action.send.hw), so this was not
// limited to dispenser buys.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/gatedSendGuard.js', () => ({
    prepareGatedSend: vi.fn(async () => null),
}));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'send-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { sendToken } from '../../../packages/core/src/flows/sendToken.js';

const FROM = {
    address: 'bcrt1qbuyer',
    publicKey: '03dd4688',
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(extra = {}) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ nativeTicker: 'BTC' }) },
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        to: 'bcrt1qdispenser',
        tick: 'MEMEVALID',
        amount: '5',
        ...extra,
    };
}

describe('sendToken names the funding address for UTXO selection', () => {
    beforeEach(() => { vi.mocked(submitAction).mockClear(); });

    it('[REGRESSION] passes sourceAddress, not just change', async () => {
        await sendToken(opts());
        expect(submitAction).toHaveBeenCalledTimes(1);
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.sourceAddress).toBe(FROM.address);
    });

    it('still supplies change, which is a separate concern (the change sink)', async () => {
        await sendToken(opts());
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.change).toBe(FROM.address);
    });

    it('keeps sending the pubkey the encoder signs against', async () => {
        await sendToken(opts());
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.pubkey).toBe(FROM.publicKey);
    });
});
