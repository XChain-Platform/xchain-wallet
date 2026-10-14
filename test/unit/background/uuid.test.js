// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, expect, it, vi } from 'vitest';
import { sessionRandomUUID } from '../../../packages/extension/src/background/uuid.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

it('uses crypto.randomUUID when it is available', () => {
    const randomUUID = vi.fn(() => 'native-uuid');
    vi.stubGlobal('crypto', { randomUUID });

    expect(sessionRandomUUID()).toBe('native-uuid');
    expect(randomUUID).toHaveBeenCalledTimes(1);
});

it('builds an RFC 4122 version 4 UUID from random bytes as a fallback', () => {
    const getRandomValues = vi.fn((bytes) => {
        bytes.set(Array.from({ length: 16 }, (_, index) => index));
        return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    const uuid = sessionRandomUUID();

    expect(uuid).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
});
