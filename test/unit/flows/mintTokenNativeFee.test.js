// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// U81: MINT carries no protocol fee in xchain-indexer (ruled with 3a1160b68),
// so the flow never forwards payFeeInNativeCoin and no chain gets a native fee
// output, whatever a caller passes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'mint-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { mintToken } from '../../../packages/core/src/flows/mintToken.js';

const FROM = { address: 'addr-1', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
function base(extra = {}) {
    return {
        vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
        chainId: 'c', from: FROM, params: { TICK: 'PEPE', AMOUNT: '10' }, ...extra,
    };
}

describe('mintToken sends no native protocol fee (U81)', () => {
    beforeEach(() => submitAction.mockClear());

    it('drops payFeeInNativeCoin even when a caller passes true', async () => {
        await mintToken(base({ payFeeInNativeCoin: true }));
        const arg = submitAction.mock.calls[0][0];
        expect(arg.actionData).toEqual({ action: 'MINT', params: { TICK: 'PEPE', AMOUNT: '10' } });
        expect('payFeeInNativeCoin' in arg.encoderOpts).toBe(false);
    });

    it('omits payFeeInNativeCoin when unset', async () => {
        await mintToken(base());
        const arg = submitAction.mock.calls[0][0];
        expect('payFeeInNativeCoin' in arg.encoderOpts).toBe(false);
    });

    it('omits the key when explicitly false-y via undefined (form passes `|| undefined`)', async () => {
        await mintToken(base({ payFeeInNativeCoin: undefined }));
        const arg = submitAction.mock.calls[0][0];
        expect('payFeeInNativeCoin' in arg.encoderOpts).toBe(false);
    });
});
