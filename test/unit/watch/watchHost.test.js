// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import confirmRequest from '../../fixtures/watch/request-confirm.json' with { type: 'json' };
import paydueRequest from '../../fixtures/watch/request-paydue.json' with { type: 'json' };
import {
    clearPendingRequest,
    publishHomeState,
    setPendingRequest,
    startWatchHost,
    stopWatchHost,
} from '../../../packages/core/src/watch/watchHost.js';

const homeState = (overrides = {}) => ({
    rows: [],
    activeByChain: {},
    inbox: [],
    settings: {
        activeNetwork: 'mainnet',
        watch: { enabled: true, showTotal: false, startIn: 'fiat' },
    },
    ...overrides,
});

const nativeTarget = () => ({
    Capacitor: { isNativePlatform: () => true },
});

const bridge = (available = true) => ({
    isAvailable: vi.fn(async () => available),
    sendSnapshot: vi.fn(async () => true),
    sendImage: vi.fn(),
    sendDetail: vi.fn(),
    removeWatchData: vi.fn(),
});

describe('watchHost', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
    });

    afterEach(() => {
        stopWatchHost();
        vi.useRealTimers();
    });

    it('starts only on a native shell whose watch plugin answers its probe', async () => {
        const webBridge = bridge();
        expect(await startWatchHost({ target: {}, bridge: webBridge })).toBe(false);
        expect(webBridge.isAvailable).not.toHaveBeenCalled();

        const unavailableBridge = bridge(false);
        expect(await startWatchHost({
            target: nativeTarget(),
            bridge: unavailableBridge,
        })).toBe(false);
        publishHomeState(homeState());

        expect(unavailableBridge.isAvailable).toHaveBeenCalledOnce();
        expect(unavailableBridge.sendSnapshot).not.toHaveBeenCalled();
    });

    it('builds and syncs snapshots from published Home state', async () => {
        const watchBridge = bridge();
        await startWatchHost({ target: nativeTarget(), bridge: watchBridge });

        publishHomeState(homeState({ balancesFetchedAt: 123, pricesAt: 456 }));

        expect(watchBridge.sendSnapshot).toHaveBeenCalledOnce();
        expect(watchBridge.sendSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            v: 1,
            builtAt: 1_700_000_000_000,
            balancesAt: 123,
            pricesAt: 456,
            rows: [],
            session: 'unlocked',
        }));
    });

    it('sets and selectively clears the pending confirm request', async () => {
        const watchBridge = bridge();
        await startWatchHost({ target: nativeTarget(), bridge: watchBridge });
        publishHomeState(homeState());

        setPendingRequest(confirmRequest);
        clearPendingRequest('another-request');
        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ request: confirmRequest }),
        );

        clearPendingRequest(confirmRequest.id);
        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ request: expect.anything() }),
        );
    });

    it.each([
        ['lock', { session: 'locked' }],
        ['auto-lock', { session: 'unlocked', lockReason: 'auto-lock' }],
    ])('clears the pending request on %s', async (_label, lockedState) => {
        const watchBridge = bridge();
        await startWatchHost({ target: nativeTarget(), bridge: watchBridge });
        publishHomeState(homeState());
        setPendingRequest(confirmRequest);

        publishHomeState(homeState(lockedState));

        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ request: expect.anything() }),
        );
    });

    it('clears a pay-due request exactly at expiresAt', async () => {
        const watchBridge = bridge();
        await startWatchHost({ target: nativeTarget(), bridge: watchBridge });
        publishHomeState(homeState());
        setPendingRequest({ ...paydueRequest, expiresAt: Date.now() + 500 });

        vi.advanceTimersByTime(499);
        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ request: expect.objectContaining({ kind: 'paydue' }) }),
        );

        vi.advanceTimersByTime(1);
        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ request: expect.anything() }),
        );
    });
});
