// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Chaos: backend.load() returns malformed bytes. Vault.open() must
// throw a meaningful error, not corrupt the in-process state of any
// other Vault that's currently open against the same master key.

import { describe, it, expect } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const KEY = new Uint8Array(32).fill(77);

describe('chaos/vault/load-corruption', () => {
    it('throws when the backend returns random bytes', async () => {
        const backend = new InMemoryBackend();
        // Save a chunk of garbage.
        const garbage = new Uint8Array(64);
        crypto.getRandomValues(garbage);
        await backend.save(garbage);

        const v = new Vault({ backend, masterKey: KEY });
        await expect(v.open()).rejects.toThrow();
    });

    it('throws when the backend returns a near-real blob with one bit flipped', async () => {
        // Encrypt + save a real blob via the codec so we have something
        // legitimate to corrupt one bit of.
        const backend = new InMemoryBackend();
        const { encodeDocument, emptyDocument } = await import('../../../packages/core/src/storage/codec.js');
        const blob = await encodeDocument(KEY, emptyDocument());
        // Flip a bit deep in the ciphertext (past the 12-byte IV).
        blob[20] ^= 0x01;
        await backend.save(blob);

        const v2 = new Vault({ backend, masterKey: KEY });
        await expect(v2.open()).rejects.toThrow();
    });

    it('throws when the backend returns truncated bytes (shorter than IV+tag)', async () => {
        const backend = new InMemoryBackend();
        await backend.save(new Uint8Array(10));
        const v = new Vault({ backend, masterKey: KEY });
        await expect(v.open()).rejects.toThrow();
    });
});
