/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    mkdir: vi.fn(),
    readFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock('node:fs', () => ({ promises: fs }));

import {
    KeychainSessionBackend,
    sessionKeyPathFor,
} from '../../../packages/desktop/main/keychain.js';

function safeStorage(overrides = {}) {
    return {
        isEncryptionAvailable: vi.fn(() => true),
        getSelectedStorageBackend: vi.fn(() => 'keychain'),
        encryptString: vi.fn((plain) => Buffer.from(`encrypted:${plain}`)),
        decryptString: vi.fn((cipher) => Buffer.from(cipher).toString('utf8')),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    fs.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    fs.rename.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
});

describe('KeychainSessionBackend', () => {
    it('persists encrypted hex through an atomic file replacement', async () => {
        const storage = safeStorage();
        const backend = new KeychainSessionBackend({
            safeStorage: storage,
            filePath: '/profile/session.bin',
        });
        const key = new Uint8Array([0, 1, 127, 128, 255]);

        await backend.save(key);
        key.fill(9);

        expect(storage.encryptString).toHaveBeenCalledWith('00017f80ff');
        expect(fs.mkdir).toHaveBeenCalledWith('/profile', { recursive: true });
        expect(fs.writeFile).toHaveBeenCalledWith(
            '/profile/session.bin.tmp',
            Buffer.from('encrypted:00017f80ff'),
            { mode: 0o600 },
        );
        expect(fs.rename).toHaveBeenCalledWith('/profile/session.bin.tmp', '/profile/session.bin');
        expect(await backend.load()).toEqual(new Uint8Array([0, 1, 127, 128, 255]));
    });

    it.each(['', '0g', 'g0', '00ffzz'])('rejects a malformed decrypted hex payload %j', async (plain) => {
        const storage = safeStorage({ decryptString: vi.fn(() => plain) });
        fs.readFile.mockResolvedValue(Buffer.from('ciphertext'));
        const backend = new KeychainSessionBackend({
            safeStorage: storage,
            filePath: '/profile/session.bin',
        });

        await expect(backend.load()).resolves.toBeNull();
    });

    it('keeps the current-process copy without touching disk when Electron has no secure backend', async () => {
        const storage = safeStorage({
            getSelectedStorageBackend: vi.fn(() => 'basic_text'),
        });
        const backend = new KeychainSessionBackend({
            safeStorage: storage,
            filePath: '/profile/session.bin',
        });

        await backend.save(new Uint8Array([4, 5, 6]));

        expect(await backend.load()).toEqual(new Uint8Array([4, 5, 6]));
        expect(storage.encryptString).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('revokes the session and attempts both cleanup paths after an unlink refusal', async () => {
        const refusal = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        fs.unlink.mockRejectedValueOnce(refusal).mockResolvedValueOnce(undefined);
        const backend = new KeychainSessionBackend({
            safeStorage: safeStorage(),
            filePath: '/profile/session.bin',
        });
        await backend.save(new Uint8Array([7, 8]));

        await expect(backend.clear()).rejects.toBe(refusal);

        expect(fs.unlink.mock.calls).toEqual([
            ['/profile/session.bin'],
            ['/profile/session.bin.tmp'],
        ]);
        expect(await backend.load()).toBeNull();
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it.each([undefined, null, '', 0, {}])('rejects an invalid session path %j', (path) => {
        expect(() => sessionKeyPathFor(path)).toThrow(/userDataDir is required/);
    });
});
