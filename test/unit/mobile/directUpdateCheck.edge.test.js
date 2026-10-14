// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    checkForDirectUpdate,
    isUpdateCheckEnabled,
    setUpdateCheckEnabled,
} from '../../../packages/web/src/update/directUpdateCheck.js';

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const currentVersion = '1.2.3';

afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    vi.restoreAllMocks();
});

describe('direct update storage and response edge paths', () => {
    it('stays disabled only for a parsed false preference', async () => {
        const fetchImpl = vi.fn();
        for (const raw of ['null', 'false', '42', '"text"', '{broken']) {
            const storage = {
                getItem: vi.fn(() => raw),
                setItem: vi.fn(),
            };
            expect(isUpdateCheckEnabled(storage), raw).toBe(true);
        }

        const storage = {
            getItem: vi.fn(() => '{"enabled":false}'),
            setItem: vi.fn(),
        };
        expect(await checkForDirectUpdate({ currentVersion, fetchImpl, storage })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('continues a check when preference writes are refused', async () => {
        const storage = {
            getItem: vi.fn(() => null),
            setItem: vi.fn(() => { throw new Error('quota exceeded'); }),
        };
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            text: async () => '{"version":"1.2.4"}',
        }));

        await expect(checkForDirectUpdate({ currentVersion, fetchImpl, storage }))
            .resolves.toMatchObject({ version: '1.2.4' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('uses no storage when the browser blocks access to localStorage', async () => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get: () => { throw new Error('storage denied'); },
        });
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            text: async () => '{"version":"1.2.4"}',
        }));

        await expect(checkForDirectUpdate({ currentVersion, fetchImpl }))
            .resolves.toMatchObject({ version: '1.2.4' });
        expect(() => setUpdateCheckEnabled(false)).not.toThrow();
        expect(isUpdateCheckEnabled()).toBe(true);
    });

    it('rejects missing fetch support and non-string response bodies quietly', async () => {
        await expect(checkForDirectUpdate({ currentVersion, fetchImpl: null })).resolves.toBeNull();

        const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => new Uint8Array([1]) }));
        await expect(checkForDirectUpdate({ currentVersion, fetchImpl, storage: null })).resolves.toBeNull();
    });
});
