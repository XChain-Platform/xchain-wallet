// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AUTO_LOCK_REQUEST_CEILING_MS,
    holdAutoLock,
    isAutoLockHeld,
    withAutoLockHold,
} from '../../../packages/core/src/shared/hooks/autoLockGuard.js';
import { useAutoLock } from '../../../packages/core/src/shared/hooks/useAutoLock.js';
import { AUTO_LOCK_REQUEST_CEILING_MS as WORKER_CEILING_MS } from '../../../packages/extension/src/background/walletLock.js';

const MINUTE = 60 * 1000;

async function advance(ms, step = MINUTE) {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
        await act(async () => { await vi.advanceTimersByTimeAsync(step); });
    }
}

describe('auto-lock hold ceiling', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { cleanup(); vi.useRealTimers(); });

    it('shares one ceiling with the extension worker', () => {
        expect(AUTO_LOCK_REQUEST_CEILING_MS).toBe(10 * MINUTE);
        expect(WORKER_CEILING_MS).toBe(AUTO_LOCK_REQUEST_CEILING_MS);
    });

    it('keeps the wallet open when a hold spans the idle deadline', async () => {
        const onLock = vi.fn();
        function Harness() {
            useAutoLock(onLock, { idleMs: MINUTE });
            return null;
        }
        render(<Harness />);
        const release = holdAutoLock();

        await advance(3 * MINUTE);
        expect(onLock).not.toHaveBeenCalled();
        expect(isAutoLockHeld()).toBe(true);

        await act(async () => { release(); });
        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it('stops counting a hold past the ceiling, so the due lock fires', async () => {
        const onLock = vi.fn();
        function Harness() {
            useAutoLock(onLock, { idleMs: MINUTE, tickMs: MINUTE });
            return null;
        }
        render(<Harness />);
        // A request that never settles: its release is never called.
        const hung = withAutoLockHold(() => new Promise(() => {}));
        void hung;

        await advance(AUTO_LOCK_REQUEST_CEILING_MS - MINUTE);
        expect(onLock).not.toHaveBeenCalled();
        expect(isAutoLockHeld()).toBe(true);

        await advance(MINUTE);
        expect(isAutoLockHeld()).toBe(false);
        expect(onLock).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('leaves other holds intact when an expired hold releases late', async () => {
        const lateRelease = holdAutoLock();
        vi.advanceTimersByTime(AUTO_LOCK_REQUEST_CEILING_MS + 1000);
        expect(isAutoLockHeld()).toBe(false);

        const live = holdAutoLock();
        const other = holdAutoLock();
        lateRelease();
        lateRelease();
        expect(isAutoLockHeld()).toBe(true);

        live();
        expect(isAutoLockHeld()).toBe(true);
        other();
        expect(isAutoLockHeld()).toBe(false);
    });

    it('does not drive the count negative when an expired hold releases late', () => {
        const lateRelease = holdAutoLock();
        vi.advanceTimersByTime(AUTO_LOCK_REQUEST_CEILING_MS + 1000);
        lateRelease();

        const next = holdAutoLock();
        expect(isAutoLockHeld()).toBe(true);
        next();
        expect(isAutoLockHeld()).toBe(false);
    });
});
