import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasAvailableChain } from '../../../../packages/core/src/shared/utils/chainAvailability.js';
import {
    formatLocalDateTime,
    formatRelativeDateTime,
} from '../../../../packages/core/src/shared/utils/dateTimeFormat.js';
import { nextPaint } from '../../../../packages/core/src/shared/utils/nextPaint.js';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('chain availability fallbacks', () => {
    it('fails closed when registry enumeration throws', () => {
        expect(hasAvailableChain({}, {
            supportedChains() { throw new Error('registry unavailable'); },
        })).toBe(false);
    });

    it('keeps partial settings usable until fees are explicitly present', () => {
        const registry = { supportedChains: () => [{ id: 'bitcoin-mainnet' }] };
        expect(hasAvailableChain({ loading: true, settings: {} }, registry)).toBe(true);
        expect(hasAvailableChain({ loading: false, settings: {} }, registry)).toBe(true);
    });

    it('uses descriptorFor when get is unavailable and matches only the active network', () => {
        const registry = {
            supportedChains: () => [{ id: 'bitcoin-mainnet' }],
            descriptorFor: (chainId) => ({
                id: chainId,
                networkKind: chainId.endsWith('testnet') ? 'testnet' : 'mainnet',
            }),
        };

        expect(hasAvailableChain({
            settings: { activeNetwork: 'testnet', fees: { 'bitcoin-mainnet': {} } },
        }, registry)).toBe(false);
        expect(hasAvailableChain({
            settings: { activeNetwork: 'testnet', fees: { 'bitcoin-testnet': {} } },
        }, registry)).toBe(true);
    });
});

describe('date-time formatter fallbacks', () => {
    it('uses Date fallback formatting when Intl date formatting throws', () => {
        vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
            throw new RangeError('locale unavailable');
        });
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('fallback date');

        expect(formatLocalDateTime(1_700_000_000, 'bad-locale')).toBe('fallback date');
    });

    it.each([
        [1_700_000_000 - 60, '1 minute ago'],
        [1_700_000_000 + 120, 'in 2 minutes'],
    ])('uses an English relative fallback for timestamp %s', (timestamp, expected) => {
        vi.spyOn(Intl, 'RelativeTimeFormat').mockImplementation(() => {
            throw new RangeError('locale unavailable');
        });

        expect(formatRelativeDateTime(timestamp, 1_700_000_000_000, 'bad-locale'))
            .toBe(expected);
    });

    it('covers invalid and just-now timestamp boundaries', () => {
        expect(formatRelativeDateTime(0)).toBe('');
        expect(formatRelativeDateTime(1_700_000_000, 1_700_000_004_000)).toBe('just now');
        expect(formatRelativeDateTime(1_700_000_000, 1_700_000_005_000)).toBe('5 seconds ago');
    });

    it('keeps 4.999 seconds in the just-now window', () => {
        expect(formatRelativeDateTime(1_700_000_000, 1_700_000_004_999)).toBe('just now');
    });
});

describe('next paint scheduling fallbacks', () => {
    it('waits for animation frame and then a task', async () => {
        vi.useFakeTimers();
        const frame = vi.fn((callback) => callback());
        vi.stubGlobal('requestAnimationFrame', frame);
        const resolved = vi.fn();

        const pending = nextPaint().then(resolved);
        expect(frame).toHaveBeenCalledTimes(1);
        expect(resolved).not.toHaveBeenCalled();
        await vi.runAllTimersAsync();
        await pending;
        expect(resolved).toHaveBeenCalledTimes(1);
    });

    it('falls back to a task when animation frames are unavailable', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', undefined);
        const resolved = vi.fn();

        const pending = nextPaint().then(resolved);
        expect(resolved).not.toHaveBeenCalled();
        await vi.runAllTimersAsync();
        await pending;
        expect(resolved).toHaveBeenCalledTimes(1);
    });
});
