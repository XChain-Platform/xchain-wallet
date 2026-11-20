// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { normalizeSendLegs } from '../../../packages/core/src/flows/sendLegs.js';

const base = { to: 'bc1qrecipient', tick: 'XCP' };

function thrown(opts) {
    try {
        normalizeSendLegs(opts, 'sendToken');
        return null;
    } catch (error) {
        return error;
    }
}

describe('normalizeSendLegs unsafe JavaScript numbers', () => {
    it.each([9007199254740993, 0.12345678901234567, NaN, Infinity])(
        'refuses the lossy numeric amount %s', (amount) => {
            expect(thrown({ ...base, amount })?.code).toBe('UNSAFE_JS_NUMBER');
        },
    );

    it('names the affected recipient in a multi-leg refusal', () => {
        const error = thrown({
            tick: 'XCP',
            legs: [{ to: 'bc1qfirst', amount: '1' }, { to: 'bc1qsecond', amount: 9007199254740993 }],
        });
        expect(error?.code).toBe('UNSAFE_JS_NUMBER');
        expect(error?.message).toContain('legs[1]');
    });

    it('keeps safe numbers and exact decimal strings supported', () => {
        expect(normalizeSendLegs({ ...base, amount: 5 }).legs[0].amount).toBe('5');
        expect(normalizeSendLegs({ ...base, amount: '9007199254740993' }).legs[0].amount)
            .toBe('9007199254740993');
    });
});
