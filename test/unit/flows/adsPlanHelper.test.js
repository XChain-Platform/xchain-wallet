// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// applyAdsPlanToEncoderOpts (§5.3.1 ADS extraction). The refactor
// that hoists the donation-output merge out of submitAction so
// composeForConfirm resolves it pre-modal, side-effect-free.

import { describe, it, expect } from 'vitest';
import { applyAdsPlanToEncoderOpts } from '../../../packages/core/src/flows/ads.js';

const registry = (addr) => ({ get: () => ({ adsDonationAddress: addr }) });
const PLACEHOLDER = 'PLACEHOLDER_REPLACE_BEFORE_MAINNET';

function settings(accumulated, trigger = 1000) {
    return { ads: { enabled: true, perChain: { btc: { accumulatedSats: accumulated, triggerAmountSats: trigger, perTxAmountSats: 1, lifetimeTxCount: 0, lifetimeDonatedSats: 0 } } } };
}

describe('applyAdsPlanToEncoderOpts', () => {

    it('folds the donation output into customOutputs when canSubmit', () => {
        const { encoderOpts, adsPlan, adsEnabledForChain } = applyAdsPlanToEncoderOpts(
            settings(5000), 'btc', registry('donateHere'), { pubkey: 'p', customOutputs: [{ address: 'x', value: 1 }] });
        expect(adsPlan.canSubmit).toBe(true);
        expect(adsEnabledForChain).toBe(true);
        expect(encoderOpts.customOutputs).toHaveLength(2);
        expect(encoderOpts.customOutputs.find((o) => o.address === 'donateHere' && o.value === 5000)).toBeTruthy();
    });

    it('does not mutate encoderOpts when the trigger is not reached', () => {
        const input = { pubkey: 'p' };
        const { encoderOpts, adsPlan } = applyAdsPlanToEncoderOpts(
            settings(500), 'btc', registry('donateHere'), input);
        expect(adsPlan.canSubmit).toBe(false);
        expect(encoderOpts).toBe(input); // same reference, no injection
    });

    it('does not inject when the donation address is the placeholder', () => {
        const { encoderOpts, adsPlan } = applyAdsPlanToEncoderOpts(
            settings(5000), 'btc', registry(PLACEHOLDER), { pubkey: 'p' });
        expect(adsPlan.canSubmit).toBe(false);
        expect(encoderOpts.customOutputs).toBeUndefined();
    });

    it('reports adsEnabledForChain=false when ADS is disabled', () => {
        const { adsEnabledForChain } = applyAdsPlanToEncoderOpts(
            { ads: { enabled: false, perChain: {} } }, 'btc', registry('donateHere'), { pubkey: 'p' });
        expect(adsEnabledForChain).toBe(false);
    });
});
