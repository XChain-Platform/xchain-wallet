// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-51 sweep: every quotable authoring flow must forward a truthy
// payFeeInNativeCoin into submitAction's encoderOpts (where the submit-time
// preflight prices it or forfeit-refuses), and must NOT emit the key when the
// toggle is off, so the default XCHAIN-fee path stays byte-identical.
// mintToken has its own file (mintTokenNativeFee.test.js); orderAction /
// swapAction / dispenserAction / issueToken / advancedAction predate PC-51
// and are covered by their flow suites.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
    assertValidDestination: vi.fn(),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { dividendAction } from '../../../packages/core/src/flows/dividendAction.js';
import { airdropAction } from '../../../packages/core/src/flows/airdropAction.js';
import { broadcastAction } from '../../../packages/core/src/flows/broadcastAction.js';
import { createList } from '../../../packages/core/src/flows/createList.js';
import { destroyToken } from '../../../packages/core/src/flows/destroyToken.js';
import { linkAction } from '../../../packages/core/src/flows/linkAction.js';
import { sleepAction } from '../../../packages/core/src/flows/sleepAction.js';
import { fileAction } from '../../../packages/core/src/flows/fileAction.js';
import { oraclePriceAction } from '../../../packages/core/src/flows/oraclePriceAction.js';
import { callbackAction } from '../../../packages/core/src/flows/callbackAction.js';
import { sweepToken } from '../../../packages/core/src/flows/sweepToken.js';

const FROM = { address: 'addr-1', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
const COMMON = {
    vault: {}, walletId: 'w1', password: 'pw',
    chainRegistry: {}, sdkRegistry: {}, chainId: 'c', from: FROM,
};

// Minimal valid opts per flow (just enough to clear each flow's own guards;
// submitAction is mocked so nothing composes).
const FLOWS = [
    ['dividendAction', dividendAction, { params: { TICK: 'PEPE', DIVIDEND_TICK: 'XCHAIN', AMOUNT: '1' } }],
    ['airdropAction', airdropAction, { params: { TICK: 'PEPE', AMOUNT: '1', LIST_ACTION_INDEX: '7' } }],
    ['broadcastAction', broadcastAction, { params: { MESSAGE: 'hello' } }],
    ['createList', createList, { params: { VERSION: '0', TYPE: '2', ITEM: ['addr-x'] } }],
    ['destroyToken', destroyToken, { params: { TICK: 'PEPE', AMOUNT: '1' } }],
    ['linkAction', linkAction, { coin1: 'BTC', coin1ActionIndex: '1', coin2: 'BTC', coin2ActionIndex: '2' }],
    ['sleepAction', sleepAction, { params: { VERSION: '1', TICK: 'PEPE', RESUME_BLOCK: '100' } }],
    ['fileAction', fileAction, { name: 'a.txt', type: 'text/plain', rawData: 'x' }],
    ['oraclePriceAction', oraclePriceAction, { params: { VERSION: '1', COIN: 'BTC', TICK: 'XCHAIN', FIAT: 'USD', VALUE: '1.00000000' } }],
    ['callbackAction', callbackAction, { params: { TICK: 'PEPE' } }],
    ['sweepToken', sweepToken, { to: 'dest-addr' }],
];

describe('PC-51 native-fee threading across quotable flows', () => {
    beforeEach(() => submitAction.mockClear());

    for (const [name, fn, opts] of FLOWS) {
        it(`${name} forwards payFeeInNativeCoin: true into encoderOpts`, async () => {
            await fn({ ...COMMON, ...opts, payFeeInNativeCoin: true });
            expect(submitAction).toHaveBeenCalledTimes(1);
            const arg = submitAction.mock.calls[0][0];
            expect(arg.encoderOpts.payFeeInNativeCoin).toBe(true);
        });

        it(`${name} omits the key when unset (XCHAIN-fee path unchanged)`, async () => {
            await fn({ ...COMMON, ...opts });
            expect(submitAction).toHaveBeenCalledTimes(1);
            const arg = submitAction.mock.calls[0][0];
            expect('payFeeInNativeCoin' in arg.encoderOpts).toBe(false);
        });

        it(`${name} omits the key on undefined (forms pass \`|| undefined\`)`, async () => {
            await fn({ ...COMMON, ...opts, payFeeInNativeCoin: undefined });
            expect(submitAction).toHaveBeenCalledTimes(1);
            const arg = submitAction.mock.calls[0][0];
            expect('payFeeInNativeCoin' in arg.encoderOpts).toBe(false);
        });
    }
});
