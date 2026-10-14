// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ActiveAddressPoll,
    isVaultLockedError,
} from '../../../packages/core/src/notifications/activeAddressPoll.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('isVaultLockedError', () => {
    it('recognizes direct and wrapped closed-vault errors', () => {
        expect(isVaultLockedError({ name: 'VaultStateError' })).toBe(true);
        expect(isVaultLockedError(new Error('Vault is closed'))).toBe(true);
        expect(isVaultLockedError(new Error('IPC: VaultStateError: vault not open'))).toBe(true);
        expect(isVaultLockedError(new Error('network unavailable'))).toBe(false);
        expect(isVaultLockedError('Vault is closed')).toBe(false);
    });
});

describe('ActiveAddressPoll', () => {
    it('normalizes successful reads and resets a failure streak', async () => {
        const getActiveAddresses = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce('malformed')
            .mockRejectedValueOnce(new Error('offline again'));
        const logger = { error: vi.fn() };
        let now = 1_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const poll = new ActiveAddressPoll({
            getActiveAddresses, intervalMs: 100, logger, owner: 'deadline',
        });

        await expect(poll.read()).resolves.toBeNull();
        expect(logger.error).toHaveBeenCalledTimes(1);
        now = 1_100;
        await expect(poll.read()).resolves.toEqual([]);
        now = 1_101;
        await expect(poll.read()).resolves.toBeNull();
        expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it('backs off exponentially, caps the delay, and logs once per streak', async () => {
        const getActiveAddresses = vi.fn(async () => { throw new Error('offline'); });
        const logger = { error: vi.fn() };
        let now = 10_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const poll = new ActiveAddressPoll({
            getActiveAddresses, intervalMs: 100, logger, owner: 'governance',
        });

        await poll.read();
        now += 99;
        await poll.read();
        expect(getActiveAddresses).toHaveBeenCalledTimes(1);
        now += 1;
        await poll.read();
        now += 200;
        await poll.read();
        now += 400;
        await poll.read();
        now += 800;
        await poll.read();
        now += 799;
        await poll.read();
        expect(getActiveAddresses).toHaveBeenCalledTimes(5);
        now += 1;
        await poll.read();
        expect(getActiveAddresses).toHaveBeenCalledTimes(6);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            'governance: getActiveAddresses failed', expect.any(Error),
        );
    });

    it('treats a locked vault as a quiet state with no backoff', async () => {
        const getActiveAddresses = vi.fn()
            .mockRejectedValueOnce(new Error('Vault is not open'))
            .mockResolvedValueOnce([{ chainId: 'bitcoin', address: 'bc1q' }]);
        const logger = { error: vi.fn() };
        const poll = new ActiveAddressPoll({
            getActiveAddresses, intervalMs: 100, logger, owner: 'deadline',
        });

        await expect(poll.read()).resolves.toBeNull();
        await expect(poll.read()).resolves.toEqual([{ chainId: 'bitcoin', address: 'bc1q' }]);
        expect(logger.error).not.toHaveBeenCalled();
    });
});
