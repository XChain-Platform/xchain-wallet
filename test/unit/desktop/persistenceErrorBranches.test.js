/** @vitest-environment node */

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

import { KeychainSessionBackend } from '../../../packages/desktop/main/keychain.js';
import { FileMetaBackend } from '../../../packages/desktop/main/meta.js';
import { FileStorageBackend } from '../../../packages/desktop/main/storage.js';

function safeStorage(overrides = {}) {
    return {
        isEncryptionAvailable: vi.fn(() => true),
        getSelectedStorageBackend: vi.fn(() => 'keychain'),
        encryptString: vi.fn((plain) => Buffer.from(plain)),
        decryptString: vi.fn(() => '0102'),
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

describe('keychain fallback and refusal branches', () => {
    it('requires safe storage and treats missing or unavailable encryption as unavailable', () => {
        expect(() => new KeychainSessionBackend({ filePath: '/profile/session.bin' }))
            .toThrow(/safeStorage is required/);
        expect(new KeychainSessionBackend({
            filePath: '/profile/session.bin', safeStorage: {},
        }).isAvailable()).toBe(false);
        expect(new KeychainSessionBackend({
            filePath: '/profile/session.bin',
            safeStorage: safeStorage({ isEncryptionAvailable: vi.fn(() => false) }),
        }).isAvailable()).toBe(false);
    });

    it('propagates a permission refusal while reading the encrypted session', async () => {
        const refusal = Object.assign(new Error('denied'), { code: 'EACCES' });
        fs.readFile.mockRejectedValue(refusal);
        const backend = new KeychainSessionBackend({
            filePath: '/profile/session.bin', safeStorage: safeStorage(),
        });

        await expect(backend.load()).rejects.toBe(refusal);
    });

    it('keeps a failed clear revoked until a fresh save', async () => {
        const refusal = Object.assign(new Error('denied'), { code: 'EPERM' });
        fs.unlink.mockRejectedValueOnce(refusal).mockResolvedValueOnce(undefined);
        const backend = new KeychainSessionBackend({
            filePath: '/profile/session.bin', safeStorage: safeStorage(),
        });
        await backend.save(new Uint8Array([1, 2]));

        await expect(backend.clear()).rejects.toBe(refusal);
        await expect(backend.load()).resolves.toBeNull();
        await backend.save(new Uint8Array([3, 4]));
        await expect(backend.load()).resolves.toEqual(new Uint8Array([3, 4]));
    });
});

describe('file backend permission refusals', () => {
    it.each([
        ['vault', () => new FileStorageBackend('/profile/vault.bin')],
        ['metadata', () => new FileMetaBackend('/profile/meta.json')],
    ])('propagates a %s read refusal instead of treating it as missing', async (_name, makeBackend) => {
        const refusal = Object.assign(new Error('denied'), { code: 'EACCES' });
        fs.readFile.mockRejectedValue(refusal);

        await expect(makeBackend().load()).rejects.toBe(refusal);
    });

    it.each([
        ['vault', () => new FileStorageBackend('/profile/vault.bin')],
        ['metadata', () => new FileMetaBackend('/profile/meta.json')],
    ])('propagates a %s cleanup refusal', async (_name, makeBackend) => {
        const refusal = Object.assign(new Error('read only'), { code: 'EROFS' });
        fs.unlink.mockRejectedValueOnce(refusal);

        await expect(makeBackend().clear()).rejects.toBe(refusal);
    });
});
