// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The signing-secret session slot now carries the 25th word beside the
// password when one was typed, so an MV3 worker restart can re-pool a
// passphrase wallet. A slot written by an older worker (bare password
// bytes) must keep reading, and a password can never be mistaken for the
// marked shape.

import { describe, it, expect } from 'vitest';
import {
    saveSigningSecret,
    loadSigningSecret,
    loadSigningCredentials,
} from '../../../packages/extension/src/background/signingSecretSession.js';

function memoryBackend() {
    let blob = null;
    return {
        async save(b) { blob = new Uint8Array(b); },
        async load() { return blob; },
        async clear() { blob = null; },
    };
}

describe('background/signingSecretSession', () => {
    it('stores a bare password unchanged and reads it back through both loaders', async () => {
        const be = memoryBackend();
        await saveSigningSecret(be, 'hunter2');
        expect(new TextDecoder().decode(await be.load())).toBe('hunter2');
        expect(await loadSigningSecret(be)).toBe('hunter2');
        expect(await loadSigningCredentials(be)).toEqual({ password: 'hunter2', bip39Passphrase: '' });
    });

    it('carries the 25th word alongside the password when one was typed', async () => {
        const be = memoryBackend();
        await saveSigningSecret(be, 'hunter2', 'my 25th word');
        expect(await loadSigningCredentials(be)).toEqual({ password: 'hunter2', bip39Passphrase: 'my 25th word' });
        expect(await loadSigningSecret(be)).toBe('hunter2');
    });

    it('reads a slot written by an older worker (raw password bytes) as a password', async () => {
        const be = memoryBackend();
        await be.save(new TextEncoder().encode('legacy-pw'));
        expect(await loadSigningCredentials(be)).toEqual({ password: 'legacy-pw', bip39Passphrase: '' });
    });

    it('does not mistake a JSON-looking password for the marked shape', async () => {
        const be = memoryBackend();
        const tricky = '{"password":"x","bip39Passphrase":"y"}';
        await saveSigningSecret(be, tricky);
        expect(await loadSigningCredentials(be)).toEqual({ password: tricky, bip39Passphrase: '' });
    });

    it('returns null for an empty slot or a missing backend', async () => {
        expect(await loadSigningCredentials(memoryBackend())).toBeNull();
        expect(await loadSigningCredentials(null)).toBeNull();
        expect(await loadSigningSecret(undefined)).toBeNull();
    });

    it('treats an empty passphrase exactly like none', async () => {
        const be = memoryBackend();
        await saveSigningSecret(be, 'hunter2', '');
        expect(new TextDecoder().decode(await be.load())).toBe('hunter2');
    });
});
