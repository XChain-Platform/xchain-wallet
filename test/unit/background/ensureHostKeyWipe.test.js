// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The extension's ensureHost() must zero the master key it loads.
//
// It read a plaintext 32-byte key out of chrome.storage.session and handed it
// to the Vault, which keeps a PRIVATE COPY: vault.close() zeroes that copy and
// never the caller's buffer, so the loaded one survived on the service-worker
// heap for the whole unlocked session. Every other key-loading path in this
// tree ends in fill(0).
//
// Coverage is in two halves because background.js cannot be imported here (it
// registers chrome.* listeners at module load): the first half proves the
// remedy is SAFE against the real Vault, the second pins that ensureHost
// actually applies it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Vault } from '../../../packages/core/src/storage/Vault.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

function memBackend() {
    let blob = null;
    return {
        async load() { return blob; },
        async save(next) { blob = next; },
        async clear() { blob = null; },
    };
}

describe('ensureHost master-key hygiene', () => {
    it('leaves the Vault usable after the caller zeroes its own buffer', async () => {
        const backend = memBackend();
        const masterKey = new Uint8Array(32).fill(9);

        const writer = new Vault({ backend, masterKey });
        await writer.open();
        await writer.save();
        writer.close();

        const vault = new Vault({ backend, masterKey });
        // Exactly what ensureHost now does the moment the constructor returns.
        masterKey.fill(0);

        await expect(vault.open()).resolves.toBeUndefined();
        expect(masterKey.every((b) => b === 0)).toBe(true);
        vault.close();
    });

    it('proves close() cannot be what clears the caller buffer', async () => {
        const backend = memBackend();
        const masterKey = new Uint8Array(32).fill(9);
        const vault = new Vault({ backend, masterKey });

        await vault.open();
        vault.close();

        // Unwiped, the loaded key is still plaintext here; only an explicit
        // fill(0) at the load site removes it.
        expect(masterKey.every((b) => b === 9)).toBe(true);
    });

    it('wipes the loaded key inside ensureHost', () => {
        const bg = readFileSync(join(wsRoot, 'packages', 'extension', 'src', 'background.js'), 'utf8');
        const start = bg.indexOf('async function ensureHost()');
        expect(start).toBeGreaterThan(-1);
        // Up to the guarded vault.open(), which is the next thing ensureHost
        // does after building the Vault.
        const head = bg.slice(start, bg.indexOf('await vault.open();', start));

        expect(head).toMatch(/const masterKey = await sessionBackend\.load\(\)/);
        expect(head).toMatch(/finally\s*\{\s*masterKey\.fill\(0\);\s*\}/);
    });
});
