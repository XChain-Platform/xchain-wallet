// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §11.3.2 active (operating) address per chain. Resolution defaults to

// The error carries the colliding address and signer ids so a caller can
// report which rows need manual resolution.

import { describe, it, expect } from 'vitest';
import { AmbiguousSignerMatchError } from '../../../packages/core/src/flows/reconcileAddressSigners.js';

describe('AmbiguousSignerMatchError', () => {
    const signerIds = ['s1', 's2', 's3'];

    it('is an Error subclass named AmbiguousSignerMatchError', () => {
        const err = new AmbiguousSignerMatchError('a1', signerIds);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('AmbiguousSignerMatchError');
    });

    it('stores addressId and signerIds as given', () => {
        const err = new AmbiguousSignerMatchError('a1', signerIds);
        expect(err.addressId).toBe('a1');
        expect(err.signerIds).toBe(signerIds);
    });

    it('names the function, quotes the address id and joins signer ids', () => {
        const err = new AmbiguousSignerMatchError('a1', signerIds);
        expect(err.message).toBe(
            'reconcileAddressSigners: address "a1" matches multiple signers: s1, s2, s3',
        );
    });

    it('survives a throw and catch with instanceof', () => {
        let caught;
        try {
            throw new AmbiguousSignerMatchError('a1', signerIds);
        } catch (e) {
            caught = e;
        }
        expect(caught instanceof AmbiguousSignerMatchError).toBe(true);
        expect(caught.signerIds).toEqual(signerIds);
    });
});
