// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    hasNativePaymentOutput,
    isBareNativePayment,
    nativePaymentOutput,
    withNativePaymentOutput,
} from '../../../packages/core/src/flows/nativePayment.js';

const descriptor = { coin: 'bitcoin' };
const payment = {
    action: 'SEND',
    params: {
        TICK: 'BTC',
        AMOUNT: '12345678901234567890.12345678',
        DESTINATION: 'bc1qrecipient',
    },
};

describe('nativePayment', () => {
    it('converts a native decimal to base units without number rounding', () => {
        expect(nativePaymentOutput({
            tick: payment.params.TICK,
            amount: payment.params.AMOUNT,
            destination: `  ${payment.params.DESTINATION}  `,
            descriptor,
        })).toEqual({
            address: payment.params.DESTINATION,
            value: '1234567890123456789012345678',
        });
    });

    it.each([
        [{ ...payment.params, TICK: 'XCP' }],
        [{ ...payment.params, AMOUNT: '0' }],
        [{ ...payment.params, AMOUNT: '-1' }],
        [{ ...payment.params, DESTINATION: '' }],
    ])('does not create an output for a non-payment %#', (params) => {
        expect(nativePaymentOutput({
            tick: params.TICK,
            amount: params.AMOUNT,
            destination: params.DESTINATION,
            descriptor,
        })).toBeNull();
    });

    it('recognizes only a plain native SEND as a bare payment', () => {
        expect(isBareNativePayment(payment, descriptor)).toBe(true);
        expect(isBareNativePayment({
            ...payment,
            params: { ...payment.params, MEMO: 'keep this action' },
        }, descriptor)).toBe(false);
        expect(isBareNativePayment({ ...payment, rest: ['extra'] }, descriptor)).toBe(false);
    });

    it('appends the exact payment once and preserves other outputs', () => {
        const encoderOpts = {
            fee: 1200,
            customOutputs: [{ address: 'bc1qdonation', value: '1000' }],
        };
        const withPayment = withNativePaymentOutput({
            actionData: payment,
            descriptor,
            encoderOpts,
        });

        expect(withPayment).toEqual({
            fee: 1200,
            customOutputs: [
                { address: 'bc1qdonation', value: '1000' },
                { address: 'bc1qrecipient', value: '1234567890123456789012345678' },
            ],
        });
        expect(hasNativePaymentOutput(payment, descriptor, withPayment)).toBe(true);
        expect(withNativePaymentOutput({
            actionData: payment,
            descriptor,
            encoderOpts: withPayment,
        })).toBe(withPayment);
    });

    it('leaves token encoder options untouched', () => {
        const encoderOpts = { customOutputs: [] };
        const tokenSend = {
            ...payment,
            params: { ...payment.params, TICK: 'XCP' },
        };

        expect(withNativePaymentOutput({
            actionData: tokenSend,
            descriptor,
            encoderOpts,
        })).toBe(encoderOpts);
        expect(hasNativePaymentOutput(tokenSend, descriptor, encoderOpts)).toBe(false);
    });
});
