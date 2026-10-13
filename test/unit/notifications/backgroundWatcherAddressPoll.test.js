// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GovernancePollWatcher } from '../../../packages/core/src/notifications/GovernancePollWatcher.js';
import { DeadlineWatcher } from '../../../packages/core/src/notifications/DeadlineWatcher.js';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';

const WATCHERS = [
    ['governance', GovernancePollWatcher],
    ['deadline', DeadlineWatcher],
    ['dispenser escrow', DispenserEscrowWatcher],
];

function makeWatcher(Watcher, getActiveAddresses, overrides = {}) {
    const logger = {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const getSdkForChain = vi.fn(() => ({}));
    const watcher = new Watcher({
        getActiveAddresses,
        getSdkForChain,
        getSettings: vi.fn(async () => ({ notifications: {} })),
        notify: vi.fn(),
        intervalMs: 1_000,
        logger,
        ...overrides,
    });
    return { watcher, logger, getSdkForChain };
}

function lockedError() {
    const error = new Error('Vault is not open');
    error.name = 'VaultStateError';
    return error;
}

afterEach(() => {
    vi.useRealTimers();
});

describe.each(WATCHERS)('%s watcher address polling', (_name, Watcher) => {
    it('quietly skips locked and empty wallets without reaching an SDK', async () => {
        const loadSeen = vi.fn();
        const getActiveAddresses = vi.fn()
            .mockRejectedValueOnce(lockedError())
            .mockRejectedValueOnce(new Error('VaultStateError: vault is closed'))
            .mockResolvedValueOnce([]);
        const { watcher, logger, getSdkForChain } = makeWatcher(Watcher, getActiveAddresses, { loadSeen });

        await watcher.pollOnce();
        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(getActiveAddresses).toHaveBeenCalledTimes(3);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(loadSeen).not.toHaveBeenCalled();
        expect(getSdkForChain).not.toHaveBeenCalled();
    });

    it('quietly skips when settings detect that the wallet is locked', async () => {
        const getActiveAddresses = vi.fn();
        const { watcher, logger, getSdkForChain } = makeWatcher(Watcher, getActiveAddresses, {
            getSettings: vi.fn(async () => { throw lockedError(); }),
        });

        await watcher.pollOnce();

        expect(getActiveAddresses).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(getSdkForChain).not.toHaveBeenCalled();
    });

    it('backs off repeated failures and logs once until an address read recovers', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const getActiveAddresses = vi.fn()
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockRejectedValueOnce(new Error('still failing'))
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error('new failure streak'));
        const { watcher, logger, getSdkForChain } = makeWatcher(Watcher, getActiveAddresses);

        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1_000);
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1_000);
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(1_000);
        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(4);
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.error.mock.calls[0][0]).toContain('getActiveAddresses failed');
        expect(getSdkForChain).not.toHaveBeenCalled();
    });
});
