// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    annotateEncoderFeeRequirement,
    encoderErrorCode,
    encoderErrorDetails,
    encoderErrorMessage,
} from '../../../packages/core/src/sdk/encoderErrors.js';

const encoderError = (code, message) => Object.assign(new Error(message), {
    name: 'SDKEncoderError',
    code,
});

describe('encoder error edge branches', () => {
    it('lifts a direct RPC data reason when nested details are absent', () => {
        const noUtxos = encoderError(
            'ENCODER_RPC_ERROR',
            'Encoder RPC error: no utxos were provided and no utxos found on the blockchain',
        );
        noUtxos.data = { reason: 'NO_UTXOS' };

        expect(encoderErrorCode(noUtxos)).toBe('NO_UTXOS');
        expect(encoderErrorMessage(noUtxos, { coinTicker: 'LTC' })).toMatch(/add LTC/);
    });

    it('claims the encoder half of the shared rate-limit class only for that service', () => {
        const rateLimited = Object.assign(new Error('service busy'), {
            name: 'SDKRateLimitedError',
            code: 'RATE_LIMITED',
            service: 'encoder',
            retryAfterSeconds: 4,
        });
        expect(encoderErrorCode(rateLimited)).toBe('ENCODER_HTTP_429');
        expect(encoderErrorMessage(rateLimited)).toMatch(/4 seconds/);

        const explorer = Object.assign(new Error('service busy'), {
            name: 'SDKRateLimitedError', code: 'RATE_LIMITED', service: 'explorer',
        });
        expect(encoderErrorCode(explorer)).toBeNull();
    });

    it('does not throw while annotating a frozen encoder error', () => {
        const frozen = Object.freeze(encoderError(
            'NO_UTXOS', 'no spendable UTXOs found for the funding address',
        ));

        expect(() => annotateEncoderFeeRequirement(
            frozen, { requiredFeeNative: '12.50000000' },
        )).not.toThrow();
        expect(frozen.message).not.toMatch(/protocol fee requires/);
    });

    it('rejects malformed fee annotations and trims a valid fractional amount', () => {
        for (const amount of [null, '', -1, '1e2', 'not-a-number']) {
            const err = encoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address');
            annotateEncoderFeeRequirement(err, { requiredFeeNative: amount });
            expect(err.message).not.toMatch(/protocol fee requires/);
        }

        const valid = encoderError('NO_UTXOS', 'no spendable UTXOs found for the funding address');
        annotateEncoderFeeRequirement(valid, { requiredFeeNative: '12.50000000' });
        expect(valid.message).toMatch(/protocol fee requires 12\.5 in native coin$/);
    });

    it('returns technical details only for encoder-owned errors', () => {
        expect(encoderErrorDetails(encoderError('ENCODER_TIMEOUT', '  timed out  '))).toBe('timed out');
        expect(encoderErrorDetails(new Error('unrelated'))).toBe('');
        expect(encoderErrorDetails(null)).toBe('');
    });
});
