import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SCREEN_REQUEST_TIMEOUT_MS,
    withRequestTimeout,
} from '../../../../packages/core/src/shared/utils/requestTimeout.js';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('request timeout boundaries', () => {
    it('publishes the screen request default', () => {
        expect(SCREEN_REQUEST_TIMEOUT_MS).toBe(15_000);
    });

    it('passes through a resolved value and clears the pending timer', async () => {
        await expect(withRequestTimeout(Promise.resolve('ready'), 100)).resolves.toBe('ready');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('passes through a request rejection and clears the pending timer', async () => {
        const failure = new Error('transport failed');
        await expect(withRequestTimeout(Promise.reject(failure), 100)).rejects.toBe(failure);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects exactly at the configured boundary', async () => {
        const result = withRequestTimeout(new Promise(() => {}), 25);
        const assertion = expect(result).rejects.toThrow('Request timed out');

        await vi.advanceTimersByTimeAsync(24);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('observes a source rejection that arrives after the timeout wins', async () => {
        let rejectSource;
        const source = new Promise((_, reject) => { rejectSource = reject; });
        const result = withRequestTimeout(source, 1);
        const assertion = expect(result).rejects.toThrow('Request timed out');

        await vi.advanceTimersByTimeAsync(1);
        await assertion;
        rejectSource(new Error('late transport failure'));
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(0);
    });
});
