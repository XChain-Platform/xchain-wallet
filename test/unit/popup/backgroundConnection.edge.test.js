// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    connectToBackground,
    isBackgroundConnectionError,
} from '../../../packages/extension/src/popup/backgroundConnection.jsx';

describe('popup background connection edge cases', () => {
    it.each([
        'RUNTIME_DISCONNECTED',
        'RUNTIME_NO_RESPONSE',
        'RUNTIME_TIMEOUT',
        'RUNTIME_UNAVAILABLE',
    ])('classifies %s as a retryable transport failure', (code) => {
        expect(isBackgroundConnectionError({ code })).toBe(true);
    });

    it('does not classify missing or application error codes as transport failures', () => {
        expect(isBackgroundConnectionError()).toBe(false);
        expect(isBackgroundConnectionError(new Error('permission refused'))).toBe(false);
        expect(isBackgroundConnectionError({ code: 'NOT_ALLOWED' })).toBe(false);
    });

    it('does not retry authentication or permission failures', async () => {
        const refusal = Object.assign(new Error('permission refused'), { code: 'NOT_ALLOWED' });
        const load = vi.fn().mockRejectedValue(refusal);
        const onRetry = vi.fn();
        const delay = vi.fn();

        await expect(connectToBackground(load, { onRetry, delay })).rejects.toBe(refusal);
        expect(load).toHaveBeenCalledOnce();
        expect(onRetry).not.toHaveBeenCalled();
        expect(delay).not.toHaveBeenCalled();
    });

    it('uses every configured delay before returning the recovered result', async () => {
        const first = Object.assign(new Error('disconnected'), { code: 'RUNTIME_DISCONNECTED' });
        const second = Object.assign(new Error('no response'), { code: 'RUNTIME_NO_RESPONSE' });
        const load = vi.fn()
            .mockRejectedValueOnce(first)
            .mockRejectedValueOnce(second)
            .mockResolvedValue({ state: 'locked' });
        const onRetry = vi.fn();
        const delay = vi.fn().mockResolvedValue(undefined);

        await expect(connectToBackground(load, {
            onRetry,
            retryDelays: [3, 7],
            delay,
        })).resolves.toEqual({ state: 'locked' });
        expect(onRetry).toHaveBeenNthCalledWith(1, first);
        expect(onRetry).toHaveBeenNthCalledWith(2, second);
        expect(delay.mock.calls).toEqual([[3], [7]]);
    });

    it('stops after the configured retry budget is exhausted', async () => {
        const lost = Object.assign(new Error('still disconnected'), {
            code: 'RUNTIME_DISCONNECTED',
        });
        const load = vi.fn().mockRejectedValue(lost);
        const delay = vi.fn().mockResolvedValue(undefined);

        await expect(connectToBackground(load, { retryDelays: [1], delay }))
            .rejects.toBe(lost);
        expect(load).toHaveBeenCalledTimes(2);
        expect(delay).toHaveBeenCalledOnce();
    });
});
