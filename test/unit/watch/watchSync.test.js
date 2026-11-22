// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWatchSync } from '../../../packages/core/src/watch/watchSync.js';

function snapshot(overrides = {}) {
    return { v: 1, builtAt: Date.now(), balancesAt: 10, settings: {}, ...overrides };
}

function setup() {
    const bridge = {
        sendSnapshot: vi.fn(),
        sendImage: vi.fn(),
        sendDetail: vi.fn(),
        removeWatchData: vi.fn(),
    };
    return { bridge, sync: createWatchSync({ bridge }) };
}

describe('createWatchSync', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends the first snapshot and only the latest changed snapshot in each window', () => {
        const { bridge, sync } = setup();
        sync.sendSnapshot(snapshot({ balancesAt: 1 }));
        sync.sendSnapshot(snapshot({ balancesAt: 2 }));
        sync.sendSnapshot(snapshot({ balancesAt: 3 }));

        expect(bridge.sendSnapshot).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(30_000);
        expect(bridge.sendSnapshot).toHaveBeenCalledTimes(2);
        expect(bridge.sendSnapshot.mock.calls[1][0].balancesAt).toBe(3);
    });

    it('sends settings and request changes immediately', () => {
        const { bridge, sync } = setup();
        sync.sendSnapshot(snapshot());
        sync.sendSnapshot(snapshot({ settings: { enabled: false } }));
        sync.sendSnapshot(snapshot({
            settings: { enabled: false },
            request: { id: 'request-1' },
        }));

        expect(bridge.sendSnapshot).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores builtAt-only changes but includes balancesAt in the content hash', () => {
        const { bridge, sync } = setup();
        sync.sendSnapshot(snapshot({ builtAt: 1, balancesAt: 1 }));
        expect(sync.sendSnapshot(snapshot({ builtAt: 2, balancesAt: 1 }))).toBe(false);

        vi.advanceTimersByTime(30_000);
        expect(bridge.sendSnapshot).toHaveBeenCalledOnce();

        sync.sendSnapshot(snapshot({ builtAt: 3, balancesAt: 2 }));
        expect(bridge.sendSnapshot).toHaveBeenCalledTimes(2);
    });

    it('drops a queued change when the latest state returns to the sent content', () => {
        const { bridge, sync } = setup();
        const original = snapshot({ balancesAt: 1 });
        sync.sendSnapshot(original);
        sync.sendSnapshot(snapshot({ balancesAt: 2 }));
        sync.sendSnapshot({ ...original, builtAt: 2 });

        vi.advanceTimersByTime(30_000);
        expect(bridge.sendSnapshot).toHaveBeenCalledOnce();
    });

    it('resends the latest snapshot after refresh and reachability returns', () => {
        const { bridge, sync } = setup();
        sync.sendSnapshot(snapshot());
        sync.refresh();
        expect(bridge.sendSnapshot).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(30_000);
        expect(bridge.sendSnapshot).toHaveBeenCalledTimes(2);

        sync.setReachable(false);
        sync.setReachable(true);
        vi.advanceTimersByTime(30_000);
        expect(bridge.sendSnapshot).toHaveBeenCalledTimes(3);
    });

    it('sends images and details once per hash until refresh', () => {
        const { bridge, sync } = setup();
        const image = { hash: 'image-hash', base64: 'bytes' };
        const detail = { v: 1, tokenId: 'token-1', facts: [] };

        expect(sync.sendImage(image)).toBe(true);
        expect(sync.sendImage({ ...image, base64: 'other bytes' })).toBe(false);
        expect(sync.sendDetail(detail)).toBe(true);
        expect(sync.sendDetail({ facts: [], tokenId: 'token-1', v: 1 })).toBe(false);
        expect(bridge.sendImage).toHaveBeenCalledOnce();
        expect(bridge.sendDetail).toHaveBeenCalledOnce();

        sync.refresh();
        sync.sendImage(image);
        sync.sendDetail(detail);
        expect(bridge.sendImage).toHaveBeenCalledTimes(2);
        expect(bridge.sendDetail).toHaveBeenCalledTimes(2);
    });

    it('clears sent content only when the watch app version changes', () => {
        const { bridge, sync } = setup();
        const detail = { v: 1, tokenId: 'token-1' };
        sync.sendDetail(detail);

        expect(sync.watchState({ appVersion: '1.0.0' })).toBe(true);
        sync.sendDetail(detail);
        expect(sync.watchState({ appVersion: '1.0.0' })).toBe(false);
        expect(sync.sendDetail(detail)).toBe(false);
        expect(sync.watchState({ appVersion: '1.0.1' })).toBe(true);
        sync.sendDetail(detail);

        expect(bridge.sendDetail).toHaveBeenCalledTimes(3);
    });

    it('records attempted sends before failures and never retries them', async () => {
        const { bridge, sync } = setup();
        bridge.sendSnapshot.mockRejectedValue(new Error('offline'));
        bridge.sendImage.mockImplementation(() => { throw new Error('offline'); });
        bridge.sendDetail.mockRejectedValue(new Error('offline'));
        const failedSnapshot = snapshot();

        expect(() => sync.sendSnapshot(failedSnapshot)).not.toThrow();
        expect(() => sync.sendImage({ hash: 'failed-image' })).not.toThrow();
        expect(() => sync.sendDetail({ tokenId: 'failed-detail' })).not.toThrow();
        await Promise.resolve();

        expect(sync.sendSnapshot({ ...failedSnapshot, builtAt: 2 })).toBe(false);
        expect(sync.sendImage({ hash: 'failed-image' })).toBe(false);
        expect(sync.sendDetail({ tokenId: 'failed-detail' })).toBe(false);
        vi.advanceTimersByTime(30_000);
        expect(bridge.sendSnapshot).toHaveBeenCalledOnce();
        expect(bridge.sendImage).toHaveBeenCalledOnce();
        expect(bridge.sendDetail).toHaveBeenCalledOnce();
    });

    it('removeWatchData clears queued and sent content without retrying a failure', async () => {
        const { bridge, sync } = setup();
        const image = { hash: 'image-hash' };
        sync.sendSnapshot(snapshot({ balancesAt: 1 }));
        sync.sendSnapshot(snapshot({ balancesAt: 2 }));
        sync.sendImage(image);
        bridge.removeWatchData.mockRejectedValue(new Error('offline'));

        await expect(sync.removeWatchData()).resolves.toBe(false);
        vi.advanceTimersByTime(30_000);
        expect(bridge.sendSnapshot).toHaveBeenCalledOnce();
        expect(sync.sendImage(image)).toBe(true);
        expect(sync.sendSnapshot(snapshot({ balancesAt: 1 }))).toBe(true);
        expect(bridge.sendSnapshot).toHaveBeenCalledTimes(2);
        expect(bridge.removeWatchData).toHaveBeenCalledOnce();
    });
});
