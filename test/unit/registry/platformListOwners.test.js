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
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';

const bitcoinMainnet = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet');

describe('validateChainDescriptor: platform list owners', () => {
    it('accepts every bundled descriptor', () => {
        for (const descriptor of BUNDLED_DESCRIPTORS) {
            const res = validateChainDescriptor(descriptor);
            expect(res.ok, `${descriptor.id}: ${res.errors?.join('; ')}`).toBe(true);
        }
    });

    it('accepts a descriptor without platformListOwners', () => {
        const descriptor = { ...bitcoinMainnet };
        delete descriptor.platformListOwners;

        expect(validateChainDescriptor(descriptor).ok).toBe(true);
    });

    it('rejects a non-array platformListOwners value', () => {
        const res = validateChainDescriptor({
            ...bitcoinMainnet,
            platformListOwners: 'owner-address',
        });

        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toMatch(/platformListOwners/);
    });

    it('rejects an empty-string platformListOwners entry', () => {
        const res = validateChainDescriptor({
            ...bitcoinMainnet,
            platformListOwners: [''],
        });

        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toMatch(/platformListOwners/);
    });
});
