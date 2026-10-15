// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ChromeUnlockThrottleStore,
    checkUnlockAllowed,
    computeBackoffMs,
    recordFailure,
} from '../../../packages/extension/src/background/unlockThrottle.js';

afterEach(() => {
    delete globalThis.chrome;
});

describe('unlock throttle edge branches', () => {
    it('normalizes invalid, negative, and fractional failure counts', () => {
        expect(computeBackoffMs(Number.NaN)).toBe(0);
        expect(computeBackoffMs(-1)).toBe(0);
        expect(computeBackoffMs(3.9)).toBe(5_000);
        expect(recordFailure({ failCount: '2' }, 10)).toEqual({ failCount: 3, lockedUntil: 5_010 });
    });

    it('allows a deadline made implausible by a backward clock correction', () => {
        expect(checkUnlockAllowed({ failCount: 3, lockedUntil: 20_000 }, 1_000))
            .toEqual({ allowed: true });
    });

    it('loads and normalizes persisted state', async () => {
        const area = {
            get: vi.fn(async () => ({
                'xchain:unlockThrottle': { failCount: '4', lockedUntil: '9000' },
            })),
            set: vi.fn(async () => {}),
            remove: vi.fn(async () => {}),
        };
        globalThis.chrome = { storage: { local: area } };
        const store = new ChromeUnlockThrottleStore();

        await expect(store.load()).resolves.toEqual({ failCount: 4, lockedUntil: 9000 });
        await store.save({ failCount: 4, lockedUntil: 9000 });
        await store.clear();
        expect(area.set).toHaveBeenCalledWith({
            'xchain:unlockThrottle': { failCount: 4, lockedUntil: 9000 },
        });
        expect(area.remove).toHaveBeenCalledWith('xchain:unlockThrottle');
    });

    it('treats missing, malformed, and failing storage as empty best-effort state', async () => {
        const store = new ChromeUnlockThrottleStore();
        await expect(store.load()).resolves.toBeNull();
        await expect(store.save({ failCount: 1, lockedUntil: 0 })).resolves.toBeUndefined();
        await expect(store.clear()).resolves.toBeUndefined();

        const area = {
            get: vi.fn(async () => ({ 'xchain:unlockThrottle': 'invalid' })),
            set: vi.fn(async () => { throw new Error('write refused'); }),
            remove: vi.fn(async () => { throw new Error('delete refused'); }),
        };
        globalThis.chrome = { storage: { local: area } };
        await expect(store.load()).resolves.toBeNull();
        area.get.mockRejectedValueOnce(new Error('read refused'));
        await expect(store.load()).resolves.toBeNull();
        await expect(store.save({ failCount: 1, lockedUntil: 0 })).resolves.toBeUndefined();
        await expect(store.clear()).resolves.toBeUndefined();
    });
});
