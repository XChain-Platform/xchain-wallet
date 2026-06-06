// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Boundary: HD derivation path lengths + hardened-vs-non-hardened.

import { describe, it, expect } from 'vitest';
import { hdKeyFromSeed, derive } from '../../../packages/core/src/crypto/hd.js';
import { mnemonicToSeedSync } from '@scure/bip39';

const SEED = mnemonicToSeedSync(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
);

describe('boundary/crypto/hd-paths', () => {
    it('root itself has depth 0 (HDKey raw)', () => {
        const root = hdKeyFromSeed(SEED);
        expect(root.depth).toBe(0);
    });

    it('depth 1 — single hardened child', () => {
        const root = hdKeyFromSeed(SEED);
        const c = derive(root, "m/0'");
        // derive() returns a DerivedKey (plain object); depth is on
        // the underlying HDKey, but we can verify the path field.
        expect(c.path).toBe("m/0'");
        expect(c.publicKey.length).toBe(33);
    });

    it('depth 5 — typical BIP44 leaf', () => {
        const root = hdKeyFromSeed(SEED);
        const c = derive(root, "m/44'/0'/0'/0/0");
        expect(c.path).toBe("m/44'/0'/0'/0/0");
        expect(c.privateKey.length).toBe(32);
    });

    it('depth 8 — past typical leaf', () => {
        const root = hdKeyFromSeed(SEED);
        const c = derive(root, "m/44'/0'/0'/0/0/0/0/0");
        expect(c.publicKey.length).toBe(33);
    });

    it('hardened vs non-hardened at the same index produce different keys', () => {
        const root = hdKeyFromSeed(SEED);
        const hardened = derive(root, "m/5'").publicKey;
        const soft = derive(root, 'm/5').publicKey;
        expect(Buffer.from(hardened).toString('hex'))
            .not.toBe(Buffer.from(soft).toString('hex'));
    });

    it('rejects malformed path', () => {
        const root = hdKeyFromSeed(SEED);
        expect(() => derive(root, 'not/a/path')).toThrow();
    });
});
