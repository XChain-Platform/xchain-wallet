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
import {
    AUTOPAY_SHELL_KINDS,
    CURRENT_VERSION,
    PAYER_LEASE_ID,
    createAutopayLease,
    validateAutopayLease,
} from '../../../packages/core/src/schemas/autopayLease.js';

const BASE_INPUT = {
    holderId: 'engine-instance-1',
    shellKind: 'desktop',
};

describe('createAutopayLease', () => {
    it('creates a valid payer lease', () => {
        const lease = createAutopayLease(BASE_INPUT);

        expect(lease).toMatchObject({
            schemaVersion: CURRENT_VERSION,
            id: PAYER_LEASE_ID,
            holderId: BASE_INPUT.holderId,
            shellKind: BASE_INPUT.shellKind,
        });
        expect(Number.isFinite(Date.parse(lease.renewedAt))).toBe(true);
        expect(validateAutopayLease(lease)).toEqual({ ok: true, errors: [] });
    });

    it.each(AUTOPAY_SHELL_KINDS)('creates a valid %s lease', (shellKind) => {
        expect(validateAutopayLease(createAutopayLease({ ...BASE_INPUT, shellKind })).ok).toBe(true);
    });
});

describe('validateAutopayLease', () => {
    it.each([null, [], 'lease', 1])('rejects non-record input %#', (record) => {
        expect(validateAutopayLease(record)).toEqual({
            ok: false,
            errors: ['autopayLease: must be an object'],
        });
    });

    it.each([
        ['schemaVersion', 2],
        ['id', 'standby'],
        ['holderId', ''],
        ['shellKind', 'mobile'],
        ['renewedAt', 'not-a-date'],
    ])('rejects an invalid %s', (field, value) => {
        const lease = createAutopayLease(BASE_INPUT);
        const result = validateAutopayLease({ ...lease, [field]: value });

        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(new RegExp(`^${field}:`));
    });
});
