// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    SignerStatusError,
    assertFullInputCoverage,
} from '../../../packages/core/src/signers/Signer.js';

describe('Signer low-coverage branches', () => {
    it('formats a status error without optional detail', () => {
        const error = new SignerStatusError('signer-1', 'disconnected');

        expect(error.message).toBe('Signer "signer-1" is in status "disconnected"');
        expect(error).toMatchObject({ signerId: 'signer-1', status: 'disconnected' });
    });

    it.each([-1, 1.5, NaN, '1'])('refuses invalid input count %j', (inputCount) => {
        expect(() => assertFullInputCoverage('signer-1', inputCount, []))
            .toThrow('could not count the PSBT inputs');
    });
});
