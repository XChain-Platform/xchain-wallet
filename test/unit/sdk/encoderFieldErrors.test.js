// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { encoderFieldError } from '../../../packages/core/src/sdk/encoderFieldErrors.js';
import { encoderErrorMessage } from '../../../packages/core/src/sdk/encoderErrors.js';

const rpc = (reason) => Object.assign(new Error(`Encoder RPC error: ${reason}`), {
    name: 'SDKEncoderError', code: 'ENCODER_RPC_ERROR',
});

describe('encoderFieldError', () => {
    it('names the minimum fee rate for a rate under the relay floor', () => {
        const got = encoderFieldError(rpc(
            'feePerKb 500 base units/kB produces fee 83, below the node relay minimum 165 base units for a ~165-byte transaction',
        ), { coinTicker: 'BTC', feeUnit: 'sat/vB' });
        expect(got).toEqual({
            field: 'fee',
            message: 'This fee rate is below the network minimum of 1 sat/vB. Raise the fee rate and try again.',
        });
    });

    it('rounds a fractional minimum up so the suggestion always clears the floor', () => {
        const got = encoderFieldError(rpc(
            'feePerKb 500 base units/kB produces fee 100, below the node relay minimum 208 base units for a ~166-byte transaction',
        ), { feeUnit: 'sat/vB' });
        expect(got.message).toContain('1.26 sat/vB');
    });

    it('states an explicit fee floor in the coin units', () => {
        const got = encoderFieldError(rpc(
            'fee 83 is below the node relay minimum 165 base units for a ~165-byte transaction',
        ), { coinTicker: 'LTC' });
        expect(got.field).toBe('fee');
        expect(got.message).toContain('0.00000165 LTC');
    });

    it('puts a short balance on the amount field with the shortfall', () => {
        const got = encoderFieldError(rpc(
            'insufficient funds: selected inputs total 2000 but 2536 is required (outputs 1546 + fee 990)',
        ), { coinTicker: 'BTC' });
        expect(got.field).toBe('amount');
        expect(got.message).toContain('0.00002536 BTC');
        expect(got.message).toContain('0.00000536 BTC');
    });

    it('puts a fee-only shortfall on the fee field', () => {
        const got = encoderFieldError(rpc(
            'insufficient funds: selected inputs total 1000 but 1206 is required (outputs 0 + fee 1206)',
        ), { coinTicker: 'BTC' });
        expect(got.field).toBe('fee');
    });

    it('leaves a reservation shortfall and unrelated errors alone', () => {
        expect(encoderFieldError(rpc(
            'insufficient funds: selected inputs total 777777 but 50000990 is required (outputs 50000000 + fee 990); 2 candidate input(s) are reserved by a transaction built in the last 5 minutes; broadcast that transaction or wait for the reservation to lapse',
        ))).toBeNull();
        expect(encoderFieldError(new Error('boom'))).toBeNull();
        expect(encoderFieldError(null)).toBeNull();
    });

    it('feeds the general encoder message so no surface shows the wire wording', () => {
        const text = encoderErrorMessage(rpc(
            'insufficient funds: selected inputs total 2000 but 2536 is required (outputs 1546 + fee 990)',
        ), { coinTicker: 'BTC' });
        expect(text).toMatch(/^Not enough BTC/);
        expect(text).not.toMatch(/selected inputs|outputs 1546/);
    });
});
