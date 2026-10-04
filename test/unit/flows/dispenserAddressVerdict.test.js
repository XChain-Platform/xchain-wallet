// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    OWNER_ONLY_REFUSAL,
    dispenserAddressVerdict,
} from '../../../packages/core/src/flows/dispenserAddressStanding.js';

const SOURCE = 'source-address';
const TARGET = 'target-address';

function verdict(overrides = {}) {
    return dispenserAddressVerdict({
        address: TARGET, source: SOURCE, preference: 1, seen: true, origin: false, ...overrides,
    });
}

describe('dispenserAddressVerdict', () => {
    it.each(['', '   '])('returns null for an empty address', (address) => {
        expect(verdict({ address })).toBe(null);
    });

    it('allows the trimmed source address as self', () => {
        expect(verdict({ address: `  ${SOURCE}  ` })).toMatchObject({ kind: 'self', allowed: true });
    });

    it('allows an address with preference 2', () => {
        expect(verdict({ preference: 2 })).toMatchObject({ kind: 'preference', allowed: true });
    });

    it('allows an address with no history as fresh', () => {
        expect(verdict({ seen: false })).toMatchObject({ kind: 'fresh', allowed: true });
    });

    it('allows an address previously opened by the source', () => {
        expect(verdict({ origin: true })).toMatchObject({ kind: 'origin', allowed: true });
    });

    it('refuses an owner-only address', () => {
        expect(verdict({ preference: 0 })).toEqual({
            kind: 'refused', allowed: false, message: OWNER_ONLY_REFUSAL,
        });
    });

    it.each([null, undefined])('allows an unread preference as unknown', (preference) => {
        expect(verdict({ preference })).toMatchObject({ kind: 'unknown', allowed: true });
    });

    it('lets the self rule win over a refusal-shaped input', () => {
        expect(verdict({ address: ` ${SOURCE} `, preference: 0 })).toMatchObject({
            kind: 'self', allowed: true,
        });
    });
});
