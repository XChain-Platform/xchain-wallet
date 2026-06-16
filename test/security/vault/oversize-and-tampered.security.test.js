// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security: Vault refuses tampered / oversized / wrong-key blobs.

import { describe, it, expect } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { encodeDocument, emptyDocument } from '../../../packages/core/src/storage/codec.js';

const KEY = new Uint8Array(32).fill(1);

describe('security/vault/oversize-and-tampered', () => {
    it('refuses to open with the wrong master key', async () => {
        const backend = new InMemoryBackend();
        const blob = await encodeDocument(KEY, emptyDocument());
        await backend.save(blob);
        const wrong = new Uint8Array(32).fill(2);
        const v = new Vault({ backend, masterKey: wrong });
        await expect(v.open()).rejects.toThrow();
    });

    it('refuses to open when the auth tag has been mangled', async () => {
        const backend = new InMemoryBackend();
        const blob = await encodeDocument(KEY, emptyDocument());
        blob[blob.length - 1] ^= 0xff;
        await backend.save(blob);
        const v = new Vault({ backend, masterKey: KEY });
        await expect(v.open()).rejects.toThrow();
    });

    it('refuses a blob shorter than the IV+tag minimum', async () => {
        const backend = new InMemoryBackend();
        await backend.save(new Uint8Array(20));
        const v = new Vault({ backend, masterKey: KEY });
        await expect(v.open()).rejects.toThrow();
    });
});
