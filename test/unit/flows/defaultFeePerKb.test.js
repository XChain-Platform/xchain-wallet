// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    normalFeePerKb,
    withDefaultFeePerKb,
} from '../../../packages/core/src/flows/feeEstimate.js';

const descriptors = {
    btc: { coin: 'bitcoin', feeStrategy: { unit: 'sats-per-vbyte' } },
    doge: { coin: 'dogecoin', feeStrategy: { unit: 'sats-per-kbyte' } },
};
const chainRegistry = { get: (chainId) => descriptors[chainId] || null };

describe('default transaction fee rate', () => {
    it('converts each chain Normal tier to the encoder per-kilobyte value', () => {
        expect(normalFeePerKb({ chainId: 'btc', chainRegistry })).toBe(6_000);
        expect(normalFeePerKb({ chainId: 'doge', chainRegistry })).toBe(100_000_000);
    });

    it('fills only a missing fee choice', () => {
        expect(withDefaultFeePerKb({
            chainId: 'doge', chainRegistry, encoderOpts: { rbf: false },
        })).toEqual({ rbf: false, feePerKb: 100_000_000 });

        const explicitRate = { feePerKb: 7, rbf: true };
        expect(withDefaultFeePerKb({
            chainId: 'btc', chainRegistry, encoderOpts: explicitRate,
        })).toBe(explicitRate);

        const explicitFee = { fee: 0 };
        expect(withDefaultFeePerKb({
            chainId: 'btc', chainRegistry, encoderOpts: explicitFee,
        })).toBe(explicitFee);
    });

    it('leaves an unsupported chain unchanged', () => {
        const encoderOpts = { rbf: false };
        expect(withDefaultFeePerKb({
            chainId: 'unknown', chainRegistry, encoderOpts,
        })).toBe(encoderOpts);
    });
});
