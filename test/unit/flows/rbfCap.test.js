// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// capRbfToDescriptor keeps rbf:true only on a chain that declares RBF support.

import { describe, it, expect } from 'vitest';
import { capRbfToDescriptor } from '../../../packages/core/src/flows/rbfCap.js';
import { dogecoinDescriptors } from '../../../packages/core/src/registry/descriptors/dogecoin.js';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';

const [DOGECOIN] = dogecoinDescriptors;
const [BITCOIN] = bitcoinDescriptors;

describe('capRbfToDescriptor', () => {
    it('turns rbf:true into an explicit rbf:false on the shipped Dogecoin descriptor', () => {
        expect(capRbfToDescriptor(DOGECOIN, { fee: 1, rbf: true })).toEqual({ fee: 1, rbf: false });
    });

    it('keeps rbf:true on the shipped Bitcoin descriptor, by identity', () => {
        const opts = { fee: 1, rbf: true };
        expect(capRbfToDescriptor(BITCOIN, opts)).toBe(opts);
    });

    it('fails closed on a missing descriptor or an undeclared capability', () => {
        expect(capRbfToDescriptor(null, { rbf: true }).rbf).toBe(false);
        expect(capRbfToDescriptor(undefined, { rbf: true }).rbf).toBe(false);
        expect(capRbfToDescriptor({ feeStrategy: {} }, { rbf: true }).rbf).toBe(false);
    });

    it('leaves options that do not ask for RBF untouched', () => {
        const off = { rbf: false };
        const absent = { fee: 2 };
        expect(capRbfToDescriptor(DOGECOIN, off)).toBe(off);
        expect(capRbfToDescriptor(DOGECOIN, absent)).toBe(absent);
        expect(capRbfToDescriptor(DOGECOIN, undefined)).toBe(undefined);
    });
});
