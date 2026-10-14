// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextPaint } from '../../../packages/core/src/shared/utils/nextPaint.js';

describe('nextPaint', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves on a timer after the next animation frame', async () => {
        let frameCallback;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            frameCallback = callback;
            return 1;
        }));
        let settled = false;
        const painted = nextPaint().then(() => { settled = true; });

        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
        frameCallback(16);
        await Promise.resolve();
        expect(settled).toBe(false);

        await vi.runAllTimersAsync();
        await painted;
        expect(settled).toBe(true);
    });

    it('falls back to a timer outside animation-frame environments', async () => {
        vi.stubGlobal('requestAnimationFrame', undefined);
        let settled = false;
        const painted = nextPaint().then(() => { settled = true; });

        expect(settled).toBe(false);
        await vi.runAllTimersAsync();
        await painted;
        expect(settled).toBe(true);
    });
});
