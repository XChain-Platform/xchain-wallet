// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CoinpayAutopayWatcher,
    pendingTxReferencesMatch,
} from '../../../packages/core/src/notifications/CoinpayAutopayWatcher.js';
import {
    DeadlineWatcher,
    describeWindow,
} from '../../../packages/core/src/notifications/DeadlineWatcher.js';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';
import { GovernancePollWatcher } from '../../../packages/core/src/notifications/GovernancePollWatcher.js';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';

const commonWatcherDeps = {
    getActiveAddresses: vi.fn(async () => []),
    getSdkForChain: vi.fn(() => null),
    getSettings: vi.fn(async () => ({})),
    notify: vi.fn(async () => true),
};

function expectMissingDependencies(Watcher, keys) {
    for (const key of keys) {
        expect(() => new Watcher({ ...commonWatcherDeps, [key]: null })).toThrow(key);
    }
}

function makeCoinpayWatcher() {
    return new CoinpayAutopayWatcher({
        vault: {},
        sdkRegistry: {},
        chainRegistry: {},
        getSigner: vi.fn(),
        getSettings: vi.fn(async () => ({})),
        notify: vi.fn(async () => true),
        shellKind: 'web',
    });
}

afterEach(() => {
    vi.useRealTimers();
});

describe('CoinpayAutopayWatcher uncovered branches', () => {
    it('handles a missing summary and keeps start and stop idempotent', async () => {
        expect(pendingTxReferencesMatch({ action: 'COINPAY' }, '7')).toBe(false);

        vi.useFakeTimers();
        const watcher = makeCoinpayWatcher();
        watcher.pollOnce = vi.fn(async () => {});

        expect(watcher.start()).toBe(watcher);
        const timer = watcher._timer;
        expect(watcher.start()).toBe(watcher);
        expect(watcher._timer).toBe(timer);
        await vi.advanceTimersByTimeAsync(watcher._intervalMs);
        expect(watcher.pollOnce).toHaveBeenCalledTimes(2);

        watcher.stop();
        watcher.stop();
        expect(watcher._timer).toBe(null);
    });
});

describe('DeadlineWatcher uncovered branches', () => {
    it('validates every required callback', () => {
        expectMissingDependencies(DeadlineWatcher, [
            'getActiveAddresses',
            'getSdkForChain',
            'getSettings',
            'notify',
        ]);
    });

    it('formats second boundaries and invalid durations', () => {
        expect(describeWindow('invalid')).toBe('0 seconds');
        expect(describeWindow(1)).toBe('1 second');
        expect(describeWindow(2)).toBe('2 seconds');
    });

    it('returns empty clocks for unsupported, failing, and malformed SDK responses', async () => {
        const watcher = new DeadlineWatcher(commonWatcherDeps);

        await expect(watcher._readClocks({})).resolves.toEqual({ blockTime: null, height: null });
        await expect(watcher._readClocks({
            getStatus: vi.fn(async () => { throw new Error('offline'); }),
        })).resolves.toEqual({ blockTime: null, height: null });
        await expect(watcher._readClocks({
            getStatus: vi.fn(async () => ({})),
            explorer: {},
        })).resolves.toEqual({ blockTime: null, height: null });
    });

    it('drops an overlapping poll and keeps its timer lifecycle idempotent', async () => {
        const watcher = new DeadlineWatcher(commonWatcherDeps);
        watcher._ticking = true;
        await expect(watcher.pollOnce()).resolves.toBeUndefined();

        watcher._ticking = false;
        vi.useFakeTimers();
        watcher.pollOnce = vi.fn(async () => {});
        watcher.start();
        const timer = watcher._timer;
        watcher.start();
        expect(watcher._timer).toBe(timer);
        watcher.stop();
        watcher.stop();
    });
});

describe('DispenserEscrowWatcher uncovered branches', () => {
    it('validates every required callback', () => {
        expectMissingDependencies(DispenserEscrowWatcher, [
            'getActiveAddresses',
            'getSdkForChain',
            'getSettings',
            'notify',
        ]);
    });

    it('rejects unsupported SDK shapes and overlapping polls', async () => {
        const watcher = new DispenserEscrowWatcher(commonWatcherDeps);

        await expect(watcher._tickChain('chain', 'Chain', [])).resolves.toBe(false);
        watcher._getSdkForChain = () => ({ getDispensers: vi.fn() });
        await expect(watcher._tickChain('chain', 'Chain', [])).resolves.toBe(false);
        watcher._getSdkForChain = () => ({ getAction: vi.fn() });
        await expect(watcher._tickChain('chain', 'Chain', [])).resolves.toBe(false);

        watcher._ticking = true;
        await expect(watcher.pollOnce()).resolves.toBeUndefined();
    });

    it('keeps start and stop idempotent', () => {
        vi.useFakeTimers();
        const watcher = new DispenserEscrowWatcher(commonWatcherDeps);
        watcher.pollOnce = vi.fn(async () => {});

        watcher.start();
        const timer = watcher._timer;
        watcher.start();
        expect(watcher._timer).toBe(timer);
        watcher.stop();
        watcher.stop();
    });
});

describe('GovernancePollWatcher uncovered branches', () => {
    it('validates every required callback', () => {
        expectMissingDependencies(GovernancePollWatcher, [
            'getActiveAddresses',
            'getSdkForChain',
            'getSettings',
            'notify',
        ]);
    });

    it('rejects unsupported SDK shapes and overlapping polls', async () => {
        const watcher = new GovernancePollWatcher(commonWatcherDeps);

        await expect(watcher._tickChain('chain', 'Chain', [])).resolves.toBe(false);
        watcher._getSdkForChain = () => ({});
        await expect(watcher._tickChain('chain', 'Chain', [])).resolves.toBe(false);
        await expect(watcher._getHeldTicks({}, ['address'])).resolves.toEqual(new Set());

        watcher._ticking = true;
        await expect(watcher.pollOnce()).resolves.toBeUndefined();
    });
});

describe('NotificationService uncovered branches', () => {
    it('validates every required callback', () => {
        expectMissingDependencies(NotificationService, [
            'getActiveAddresses',
            'getSdkForChain',
            'getSettings',
            'notify',
        ]);
    });

    it('handles an empty address result and keeps start idempotent', async () => {
        const getActiveAddresses = vi.fn(async () => null);
        const service = new NotificationService({ ...commonWatcherDeps, getActiveAddresses });

        await expect(service.start()).resolves.toBe(service);
        await expect(service.start()).resolves.toBe(service);
        expect(getActiveAddresses).toHaveBeenCalledTimes(1);
        service.stop();
    });

    it('expires announced transactions and sweeps expired entries at capacity', () => {
        let now = 100;
        const service = new NotificationService({ ...commonWatcherDeps, now: () => now });
        service._announced.set('live', 101);
        service._announced.set('expired', 100);

        expect(service._wasAnnounced('missing')).toBe(false);
        expect(service._wasAnnounced('live')).toBe(true);
        expect(service._wasAnnounced('expired')).toBe(false);
        expect(service._announced.has('expired')).toBe(false);

        for (let index = 0; index < 500; index += 1) {
            service._announced.set(`old-${index}`, 100);
        }
        now = 101;
        service._markAnnounced('fresh');
        expect(service._announced).toEqual(new Map([['fresh', 3_600_101]]));
    });

    it('normalizes array and empty pending transaction rosters', async () => {
        const service = new NotificationService({
            ...commonWatcherDeps,
            getPendingTxids: vi.fn()
                .mockResolvedValueOnce(['a', 'b'])
                .mockResolvedValueOnce(null),
        });

        await expect(service._safePendingTxids()).resolves.toEqual(new Set(['a', 'b']));
        await expect(service._safePendingTxids()).resolves.toEqual(new Set());
    });
});
