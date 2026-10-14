// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    VaultCorruptError,
    VaultEvictedError,
    VaultLockedError,
    VaultUnavailableError,
    vaultErrorKind,
} from '../../../packages/core/src/storage/backend.js';

describe('storage backend error edges', () => {
    it('provides stable default messages for every unavailable subtype', () => {
        expect(new VaultUnavailableError()).toMatchObject({
            name: 'VaultUnavailableError',
            message: 'vault storage unavailable: storage backend is unavailable',
        });
        expect(new VaultLockedError()).toMatchObject({
            name: 'VaultLockedError',
            message: 'vault storage unavailable: the device keystore is locked',
        });
        expect(new VaultCorruptError()).toMatchObject({
            name: 'VaultCorruptError',
            message: 'vault storage unavailable: the stored vault failed its integrity check',
        });
        expect(new VaultEvictedError()).toMatchObject({
            name: 'VaultEvictedError',
            message: expect.stringContaining('meta record remains'),
        });
    });

    it.each([
        [VaultCorruptError, 'corrupt'],
        [VaultLockedError, 'locked'],
        [VaultEvictedError, 'evicted'],
        [VaultUnavailableError, 'unavailable'],
    ])('falls back to instanceof when %s carries a subclass name', (BaseError, kind) => {
        class ShellSpecificError extends BaseError {
            constructor() {
                super();
                this.name = 'ShellSpecificError';
            }
        }

        expect(vaultErrorKind(new ShellSpecificError())).toBe(kind);
    });

    it.each([
        ['VaultLockedError', 'locked'],
        ['VaultEvictedError', 'evicted'],
        ['VaultUnavailableError', 'unavailable'],
    ])('classifies a realm-neutral %s name', (name, kind) => {
        expect(vaultErrorKind({ name })).toBe(kind);
    });
});
