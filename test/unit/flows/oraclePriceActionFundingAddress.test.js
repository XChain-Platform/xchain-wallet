// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-146: oraclePriceAction must name the funding ADDRESS, not just the pubkey.
//
// Fourth instance of the D-7 family (sendToken , dispenserAction D-43,
// the three ORDER flows D-134), and the first where the missing address broke
// something OTHER than UTXO selection. `submitWithSigner` hands the address on
// to the native-coin fee pre-flight as the quoted action's SOURCE, and the
// indexer's PRICE dry run writes a row keyed on it: with no source it answers
// `valid:false` carrying a raw SQL error, the wallet classifies that as an
// unpriceable action, and the form says "the LTC fee price is temporarily
// unavailable". On LTC/DOGE the coin fee is the ONLY lane , so
// publishing an oracle price was impossible there and the message named the
// wrong cause, the wrong component and the wrong remedy (waiting).
//
// This form is on the LEGACY sign path - it has no confirm screen, so nothing
// hands it a prebuilt PSBT and both the quote and the encoder's UTXO selection
// run live. That is the same reason cancel/edit stayed latent in D-134.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'price-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { oraclePriceAction } from '../../../packages/core/src/flows/oraclePriceAction.js';
import { addressPreferencesAction } from '../../../packages/core/src/flows/addressPreferences.js';

const FROM = {
    address: 'rltc1qoracle',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/1'/0'/0/0",
};

const PARAMS = {
    VERSION: '1', COIN: 'LTC', TICK: 'XCHAIN', FIAT: 'USD', VALUE: '1.5', FEE: '0.01',
};

function opts(extra) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ nativeTicker: 'LTC' }) },
        sdkRegistry: {},
        chainId: 'litecoin-regtest',
        from: FROM,
        params: PARAMS,
        ...extra,
    };
}

beforeEach(() => { submitAction.mockClear(); });

describe('D-146: oraclePriceAction funding address', () => {
    it('passes the source address to the encoder, not only its public key', async () => {
        await oraclePriceAction(opts());
        const { encoderOpts } = submitAction.mock.calls[0][0];
        expect(encoderOpts.sourceAddress,
            'the encoder is left to resolve UTXOs from a bare public key, which the '
            + 'utxo-tracker cannot turn into a script').toBe(FROM.address);
        expect(encoderOpts.change,
            'change has nowhere to go, so the fee quote has no source either').toBe(FROM.address);
    });

    // The half that actually broke publishing. `change` is what
    // submitWithSigner reads for the fee quote's source, so a fix that set
    // only `sourceAddress` would still have left the quote sourceless.
    it('is the value the native-fee quote reads as the spender', async () => {
        await oraclePriceAction(opts({ payFeeInNativeCoin: true }));
        const { encoderOpts } = submitAction.mock.calls[0][0];
        expect(encoderOpts.payFeeInNativeCoin,
            'the native-coin fee lane was dropped on the way to submitAction').toBe(true);
        expect(encoderOpts.change || encoderOpts.sourceAddress,
            'the native-coin fee pre-flight would quote this PRICE with no SOURCE, which '
            + 'the indexer cannot dry-run - and on LTC/DOGE there is no XCHAIN lane to fall '
            + 'back to, so the publish is simply impossible').toBe(FROM.address);
    });

    it('keeps naming the address when the caller sets a custom fee rate', async () => {
        await oraclePriceAction(opts({ feePerKb: 2000, rbf: true }));
        const { encoderOpts } = submitAction.mock.calls[0][0];
        expect(encoderOpts.feePerKb).toBe(2000);
        expect(encoderOpts.sourceAddress).toBe(FROM.address);
        expect(encoderOpts.change).toBe(FROM.address);
    });
});

// The sibling sweep. Every OTHER wallet form composes through the 
// confirm pipeline, which supplies the address itself (composeForConfirm sets
// `sourceAddress`/`change` from the caller's `source`), so a flow that omits it
// is only exposed where nothing hands down a prebuilt PSBT. Exactly two forms
// are still on that legacy path - "My oracle" and address preferences - and both
// are fixed here. If a third ever appears, it will fail this test only by being
// written, so the sweep line above is the thing to re-run:
//   for f in packages/core/src/shared/routes/*.jsx; do grep -q useActionForm $f \
//     && ! grep -qE 'useActionConfirmFlow|useConfirmAction|composeForConfirm' $f && echo $f; done
describe('D-146 sweep: addressPreferencesAction, the other legacy-path flow', () => {
    it('names the funding address too', async () => {
        await addressPreferencesAction(opts({
            params: { FEE_PREFERENCE: '0', REQUIRE_MEMO: '0', DISPENSER_PREFERENCE: '1' },
        }));
        const { encoderOpts } = submitAction.mock.calls[0][0];
        expect(encoderOpts.sourceAddress,
            'the encoder would resolve UTXOs from a bare public key on a form that has no '
            + 'confirm screen to hand it a prebuilt PSBT').toBe(FROM.address);
        expect(encoderOpts.change).toBe(FROM.address);
    });
});
