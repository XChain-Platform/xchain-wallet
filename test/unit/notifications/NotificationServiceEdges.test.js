// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';

const address = {
    address: 'mine',
    chainId: 'bitcoin-mainnet',
    label: 'Bitcoin',
    network: 'mainnet',
};

function makeLogger() {
    return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSdk(overrides = {}) {
    return {
        connectWs: vi.fn(async () => {}),
        disconnectWs: vi.fn(),
        onAddress: vi.fn(() => vi.fn()),
        ...overrides,
    };
}

function makeService(overrides = {}) {
    const sdk = overrides.sdk || makeSdk();
    const logger = overrides.logger || makeLogger();
    const notify = overrides.notify || vi.fn(async () => true);
    const service = new NotificationService({
        getActiveAddresses: overrides.getActiveAddresses || vi.fn(async () => [address]),
        getSdkForChain: overrides.getSdkForChain || vi.fn(() => sdk),
        getSettings: overrides.getSettings || vi.fn(async () => ({
            notifications: { txConfirmations: true, incomingReceipts: true },
        })),
        notify,
        getPendingTxids: overrides.getPendingTxids,
        onTxConfirmed: overrides.onTxConfirmed,
        now: overrides.now,
        logger,
    });
    return { service, sdk, logger, notify };
}

describe('NotificationService synchronization edges', () => {
    it('does not read addresses when refresh runs before start', async () => {
        const getActiveAddresses = vi.fn(async () => [address]);
        const { service } = makeService({ getActiveAddresses });

        await expect(service.refresh()).resolves.toBe(service);
        expect(getActiveAddresses).not.toHaveBeenCalled();
    });

    it('contains an address-read failure and redacts its detail', async () => {
        const secret = new Error('private address database path');
        const { service, logger, sdk } = makeService({
            getActiveAddresses: vi.fn(async () => { throw secret; }),
        });

        await expect(service.start()).resolves.toBe(service);
        expect(sdk.connectWs).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
            '[notify] NotificationService: getActiveAddresses failed',
            '<Error>',
        );
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret.message);
    });

    it('ignores invalid address rows and isolates one chain connection failure', async () => {
        const good = makeSdk();
        const bad = makeSdk({ connectWs: vi.fn(async () => { throw new Error('offline'); }) });
        const rows = [
            null,
            { address: '', chainId: 'bad' },
            { address: 'missing-chain' },
            { ...address, address: 'bad-address', chainId: 'bad' },
            address,
        ];
        const logger = makeLogger();
        const { service } = makeService({
            logger,
            getActiveAddresses: vi.fn(async () => rows),
            getSdkForChain: vi.fn((chainId) => chainId === 'bad' ? bad : good),
        });

        await service.start();
        expect(bad.connectWs).toHaveBeenCalledTimes(1);
        expect(good.connectWs).toHaveBeenCalledTimes(1);
        expect(good.onAddress).toHaveBeenCalledWith('mine', expect.any(Function));
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('warns at the twenty-first subscription boundary', async () => {
        const rows = Array.from({ length: 21 }, (_, index) => ({
            ...address,
            address: `mine-${index}`,
        }));
        const logger = makeLogger();
        const { service } = makeService({
            logger,
            getActiveAddresses: vi.fn(async () => rows),
        });

        await service.start();
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toContain('21 subscriptions');
    });

    it('removes a stale subscription even when unsubscribe and disconnect throw', async () => {
        const rows = [address];
        const sdk = makeSdk({
            disconnectWs: vi.fn(() => { throw new Error('disconnect failed'); }),
            onAddress: vi.fn(() => () => { throw new Error('unsubscribe failed'); }),
        });
        const logger = makeLogger();
        const { service } = makeService({
            sdk,
            logger,
            getActiveAddresses: vi.fn(async () => rows),
        });
        await service.start();
        rows.length = 0;

        await expect(service.refresh()).resolves.toBe(service);
        expect(service._subs.size).toBe(0);
        expect(service._conns.size).toBe(0);
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });
});

describe('NotificationService event and cache edges', () => {
    it('ignores empty frames before reading settings', async () => {
        const getSettings = vi.fn(async () => ({ notifications: {} }));
        const { service, notify } = makeService({ getSettings });

        await service._handle(address, null);
        await service._handle(address, {});
        expect(getSettings).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('treats a rejected pending roster as empty and does not confirm or notify', async () => {
        const logger = makeLogger();
        const onTxConfirmed = vi.fn();
        const { service, notify } = makeService({
            logger,
            getPendingTxids: vi.fn(async () => { throw new Error('vault unavailable'); }),
            onTxConfirmed,
        });

        await service._handle(address, {
            type: 'NEW_ACTION',
            data: { source: 'mine', tx_hash: 'tx1', action_index: 7 },
        });
        expect(onTxConfirmed).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            '[notify] NotificationService: getPendingTxids failed',
            '<Error>',
        );
    });

    it('sweeps expired recent-event entries after the cap is exceeded', () => {
        const { service } = makeService({ now: () => 1_000 });
        for (let index = 0; index < 201; index += 1) {
            service._recent.set(`old-${index}`, 999);
        }

        expect(service._isDuplicate('fresh')).toBe(false);
        expect(service._recent).toEqual(new Map([['fresh', 31_000]]));
    });

    it('evicts the oldest announced transaction when all 500 entries are live', () => {
        const { service } = makeService({ now: () => 1_000 });
        for (let index = 0; index < 500; index += 1) {
            service._announced.set(`tx-${index}`, 10_000);
        }

        service._markAnnounced('tx-new');
        expect(service._announced.size).toBe(500);
        expect(service._announced.has('tx-0')).toBe(false);
        expect(service._announced.get('tx-new')).toBe(3_601_000);
    });
});
