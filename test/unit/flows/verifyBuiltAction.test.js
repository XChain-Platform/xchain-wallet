// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The lanes the OP_RETURN cases in submitWithSignerVerifyBuiltTx.test.js do
// not reach: the P2SH chunk lane, whose commit carries no custom output and
// whose carrier scripts must be verified, and the refusals that fail closed.

import { describe, it, expect, vi } from 'vitest';
import { assertBuiltActionMatchesIntent } from '../../../packages/core/src/flows/verifyBuiltAction.js';

const SOURCE = 'bcrt1qsource';
const DEST = 'bcrt1qdest';
const ACTION = `SEND|0|JDOG|1|${DEST}|a long memo`;
const P2SH_CARRIER = { address: '2Ncarrier', scriptPubKeyHex: 'a914cc', scriptType: 'p2sh', value: 6000 };
const CHANGE = { address: SOURCE, scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 90000 };

function sdkWith(outputs, { carrierOk = true } = {}) {
    return {
        config: { network: 'regtest' },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs }) },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(),
            verifyCarrierScripts: vi.fn(() => (carrierOk ? { ok: true, checked: 1 } : { ok: false, reason: 'PAYLOAD_MISMATCH' })),
        },
    };
}

const base = (sdk, encoded) => ({
    sdk,
    encoded: { psbt: 'BUILT', encoding: 'P2SH', carrierScripts: ['51'], ...encoded },
    actionString: ACTION,
    bareNativePayment: false,
    customOutputs: [{ address: 'bcrt1qdonate', value: '1000' }],
    ownAddresses: [SOURCE],
});

describe('assertBuiltActionMatchesIntent on the P2SH chunk lane', () => {
    it('accepts a commit that carries the carrier and change, with the custom outputs deferred to the reveal', () => {
        const sdk = sdkWith([P2SH_CARRIER, CHANGE]);
        expect(() => assertBuiltActionMatchesIntent(base(sdk))).not.toThrow();
        expect(sdk.decoder.verifyCarrierScripts).toHaveBeenCalledWith(expect.objectContaining({
            actionString: ACTION, encoding: 'P2SH', carrierScripts: ['51'],
        }));
        // Inline byte match is for OP_RETURN only.
        expect(sdk.decoder.decodeActionStringFromPsbt).not.toHaveBeenCalled();
    });

    it('refuses carrier scripts that do not spell the approved action', () => {
        const sdk = sdkWith([P2SH_CARRIER, CHANGE], { carrierOk: false });
        expect(() => assertBuiltActionMatchesIntent(base(sdk))).toThrow(/does not match what you approved/);
    });

    it('refuses a chunk lane with no verifier rather than reading "cannot check" as "checked"', () => {
        const sdk = sdkWith([P2SH_CARRIER, CHANGE]);
        delete sdk.decoder.verifyCarrierScripts;
        expect(() => assertBuiltActionMatchesIntent(base(sdk))).toThrow(/does not match what you approved/);
    });

    it('refuses a foreign output on the commit', () => {
        const sdk = sdkWith([P2SH_CARRIER, { ...CHANGE, address: 'bcrt1qattacker' }]);
        expect(() => assertBuiltActionMatchesIntent(base(sdk))).toThrow(/did not approve/);
    });
});

describe('assertBuiltActionMatchesIntent fails closed', () => {
    it('on a payload the encoder reports it compressed, which this lane never asks for', () => {
        const sdk = sdkWith([P2SH_CARRIER, CHANGE]);
        expect(() => assertBuiltActionMatchesIntent(base(sdk, { compression: { compressed: true } })))
            .toThrow(/does not match what you approved/);
    });

    it('on an envelope missing its reveal or its recovery record', () => {
        const sdk = sdkWith([CHANGE]);
        expect(() => assertBuiltActionMatchesIntent(base(sdk, { encoding: 'TAPROOT', revealPsbt: 'REVEAL' })))
            .toThrow(/does not match what you approved/);
    });

    it('on an answer with no PSBT', () => {
        expect(() => assertBuiltActionMatchesIntent(base(sdkWith([]), { psbt: '' })))
            .toThrow(/does not match what you approved/);
    });
});
