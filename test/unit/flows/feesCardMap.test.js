// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { AUTHORABLE_ACTIONS } from '../../../packages/core/src/registry/actions.js';
import {
    FEE_BEARING_ACTIONS,
    feeCardOptionsForAction,
    feeSurfaceForAction,
} from '../../../packages/core/src/flows/feeBearingActions.js';
import {
    formatFeesTotal,
    selectedNetworkFee,
} from '../../../packages/core/src/flows/feesCard.js';

const RULED_ACTIONS = [
    'AIRDROP', 'BATCH', 'BET', 'CALLBACK', 'DEPLOY', 'DISPENSER', 'DIVIDEND',
    'EXECUTE', 'ISSUE', 'LIST', 'ORDER', 'SWAP', 'SWEEP', 'XBRIDGE',
];

describe('fee-bearing action surfaces', () => {
    it('covers exactly the actions with indexer protocol-fee paths', () => {
        expect(FEE_BEARING_ACTIONS).toEqual(RULED_ACTIONS);
        expect(Object.isFrozen(FEE_BEARING_ACTIONS)).toBe(true);
    });

    it('maps every other authorable action to the plain network fee field', () => {
        for (const action of AUTHORABLE_ACTIONS) {
            const expected = RULED_ACTIONS.includes(action) && action !== 'ISSUE'
                ? 'feesCard'
                : 'networkFeeField';
            expect(feeSurfaceForAction(action), action).toBe(expected);
        }
    });

    it('shows the ISSUE card only for a new token', () => {
        expect(feeSurfaceForAction('ISSUE', { newToken: true })).toBe('feesCard');
        expect(feeSurfaceForAction('ISSUE', { newToken: false })).toBe('networkFeeField');
        expect(feeSurfaceForAction('ISSUE')).toBe('networkFeeField');
    });

    it('provides the per-action card options', () => {
        expect(feeCardOptionsForAction('BATCH')).toEqual({
            nativeSwitch: false, unverified: false,
        });
        expect(feeCardOptionsForAction('DEPLOY')).toEqual({
            nativeSwitch: true, unverified: true,
        });
        expect(feeCardOptionsForAction('EXECUTE')).toEqual({
            nativeSwitch: true, unverified: true,
        });
    });
});

describe('Fees card figures', () => {
    const tiers = {
        low: { coinAmount: '0.00001' },
        normal: { coinAmount: '0.00001500' },
        fast: { coinAmount: '0.00002' },
    };

    it('reads the selected tier and custom estimate', () => {
        expect(selectedNetworkFee({ tiers, value: { mode: 'normal' } })).toBe('0.00001500');
        expect(selectedNetworkFee({
            tiers,
            value: { mode: 'custom', customRate: 7 },
            customEstimate: { coinAmount: '0.0000175' },
        })).toBe('0.0000175');
        expect(selectedNetworkFee({ tiers: null, value: { mode: 'normal' } })).toBeNull();
    });

    it('formats the native-coin total with exact eight-decimal math', () => {
        expect(formatFeesTotal({
            coinTicker: 'BTC', networkFee: '0.000015', protocolNativeSats: 197,
            protocolXchain: '0.064', payInNative: true, fiatText: '~$1.11',
        })).toBe('0.00001697 BTC ~$1.11');
    });

    it('formats the split XCHAIN total', () => {
        expect(formatFeesTotal({
            coinTicker: 'BTC', networkFee: '0.000015', protocolNativeSats: 197,
            protocolXchain: '0.064', payInNative: false, fiatText: '~$1.11',
        })).toBe('0.000015 BTC + 0.064 XCHAIN ~$1.11');
    });

    it('returns the coin total without fiat when fiat is unknown', () => {
        expect(formatFeesTotal({
            coinTicker: 'BTC', networkFee: '0.000015', protocolNativeSats: 197,
            protocolXchain: '0.064', payInNative: true, fiatText: null,
        })).toBe('0.00001697 BTC');
    });

    it('returns a coin-only total for a free quote', () => {
        expect(formatFeesTotal({
            coinTicker: 'BTC', networkFee: '0.000015', protocolNativeSats: 0,
            protocolXchain: '0', payInNative: false, fiatText: '~$0.98',
        })).toBe('0.000015 BTC ~$0.98');
    });

    it('returns null when a required fee part is unknown', () => {
        expect(formatFeesTotal({
            coinTicker: 'BTC', networkFee: null, protocolNativeSats: 197,
            protocolXchain: '0.064', payInNative: true, fiatText: '~$1.11',
        })).toBeNull();
        expect(formatFeesTotal({
            coinTicker: 'BTC', networkFee: '0.000015', protocolNativeSats: null,
            protocolXchain: '0.064', payInNative: true, fiatText: '~$1.11',
        })).toBeNull();
        expect(formatFeesTotal({
            coinTicker: 'BTC', networkFee: '0.000015', protocolNativeSats: 197,
            protocolXchain: null, payInNative: false, fiatText: '~$1.11',
        })).toBeNull();
    });
});
