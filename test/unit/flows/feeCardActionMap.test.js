// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    FEE_BEARING_ACTIONS,
    feeSurfaceForAction,
    nativeFeeForFeelessAction,
} from '../../../packages/core/src/flows/feeBearingActions.js';

const RULED_ACTIONS = [
    'AIRDROP', 'BATCH', 'BET', 'CALLBACK', 'DEPLOY', 'DISPENSER', 'DIVIDEND',
    'EXECUTE', 'ISSUE', 'LIST', 'ORDER', 'SWAP', 'SWEEP', 'XBRIDGE',
];

const FEELESS_ACTIONS = [
    'SEND', 'MINT', 'DESTROY', 'SLEEP', 'BROADCAST', 'FILE', 'LINK', 'ADDRESS',
    'PRICE', 'COINPAY', 'DELEGATE', 'DEPOSIT', 'MESSAGE', 'STAKE', 'UNSTAKE',
    'VOTE', 'WITHDRAW',
];

describe('fee card action map', () => {
    it('maps every protocol-fee action to the Fees card', () => {
        expect(FEE_BEARING_ACTIONS).toEqual(RULED_ACTIONS);
        for (const action of RULED_ACTIONS.filter((name) => name !== 'ISSUE')) {
            expect(feeSurfaceForAction(action), action).toBe('feesCard');
        }
        expect(feeSurfaceForAction('ISSUE', { newToken: true })).toBe('feesCard');
    });

    it('maps every feeless action and token update to the Network fee field', () => {
        for (const action of FEELESS_ACTIONS) {
            expect(feeSurfaceForAction(action), action).toBe('networkFeeField');
        }
        expect(feeSurfaceForAction('ISSUE', { newToken: false })).toBe('networkFeeField');
    });

    it('keeps the required native flag on feeless Litecoin and Dogecoin actions', () => {
        expect(nativeFeeForFeelessAction('litecoin-regtest')).toEqual({
            payFeeInNativeCoin: true,
            flag: true,
            mandatory: true,
        });
        expect(nativeFeeForFeelessAction({ coin: 'dogecoin' })).toEqual({
            payFeeInNativeCoin: true,
            flag: true,
            mandatory: true,
        });
        expect(nativeFeeForFeelessAction('bitcoin-regtest')).toEqual({
            payFeeInNativeCoin: false,
            flag: undefined,
            mandatory: false,
        });
    });
});
