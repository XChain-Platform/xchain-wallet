import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    isLocalhostOrigin,
    shouldAutoApproveConnect,
} from '../../../../packages/core/src/shared/utils/originAutoApprove.js';
import {
    TOKEN_INFO_TTL_MS,
    clearTokenInfoCache,
    invalidateTokenInfo,
    readTokenInfoCache,
    subscribeTokenInfoInvalidation,
    tokenInfoCacheKey,
    tokenInfoTargetMatches,
    writeTokenInfoCache,
} from '../../../../packages/core/src/shared/utils/tokenInfoCache.js';

beforeEach(() => clearTokenInfoCache());

afterEach(() => {
    clearTokenInfoCache();
    vi.restoreAllMocks();
});

describe('localhost connect approval edges', () => {
    it.each([
        'http://localhost',
        'https://localhost:5173',
        'http://127.0.0.1:8080',
        'http://[::1]:3000',
    ])('accepts loopback web origin %s', (origin) => {
        expect(isLocalhostOrigin(origin)).toBe(true);
    });

    it.each([
        null,
        '',
        'not a url',
        'file:///tmp/index.html',
        'ftp://localhost',
        'https://localhost.example.com',
        'https://127.0.0.2',
    ])('rejects non-loopback or non-web origin %s', (origin) => {
        expect(isLocalhostOrigin(origin)).toBe(false);
    });

    it('requires every connect auto-approval switch', () => {
        const origin = 'http://localhost:5173';
        expect(shouldAutoApproveConnect({ origin, settings: null })).toBe(false);
        expect(shouldAutoApproveConnect({
            origin, settings: { developerMode: false, autoApproveLocalhost: true },
        })).toBe(false);
        expect(shouldAutoApproveConnect({
            origin, settings: { developerMode: true, autoApproveLocalhost: false },
        })).toBe(false);
        expect(shouldAutoApproveConnect({
            origin: 'https://example.com',
            settings: { developerMode: true, autoApproveLocalhost: true },
        })).toBe(false);
        expect(shouldAutoApproveConnect({
            origin, settings: { developerMode: true, autoApproveLocalhost: true },
        })).toBe(true);
    });
});

describe('token information cache edges', () => {
    it('rejects incomplete keys and expires exactly at the TTL boundary', () => {
        expect(tokenInfoCacheKey('', 'TICK')).toBeNull();
        expect(tokenInfoCacheKey('bitcoin-mainnet', '')).toBeNull();
        expect(readTokenInfoCache(null)).toEqual({ hit: false, value: null });

        const key = tokenInfoCacheKey('bitcoin-mainnet', 'TICK');
        writeTokenInfoCache(key, { supply: '1' }, 100);
        expect(readTokenInfoCache(key, 100 + TOKEN_INFO_TTL_MS - 1)).toEqual({
            hit: true,
            value: { supply: '1' },
        });
        expect(readTokenInfoCache(key, 100 + TOKEN_INFO_TTL_MS)).toEqual({
            hit: false,
            value: null,
        });
    });

    it('continues notifying after one subscriber throws and supports unsubscribe', () => {
        const first = vi.fn(() => { throw new Error('subscriber failed'); });
        const second = vi.fn();
        const unsubscribeFirst = subscribeTokenInfoInvalidation(first);
        const unsubscribeSecond = subscribeTokenInfoInvalidation(second);

        expect(() => invalidateTokenInfo('bitcoin-mainnet', 'Tick')).not.toThrow();
        expect(first).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', tick: 'Tick' });
        expect(second).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', tick: 'Tick' });

        unsubscribeFirst();
        unsubscribeSecond();
        invalidateTokenInfo('bitcoin-mainnet', 'Tick');
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('returns an inert unsubscribe for invalid listeners', () => {
        const unsubscribe = subscribeTokenInfoInvalidation(null);
        expect(unsubscribe).toEqual(expect.any(Function));
        expect(() => unsubscribe()).not.toThrow();
    });

    it('matches canonical chains and case-insensitive tick names', () => {
        const target = { chainId: 'bitcoin-mainnet', tick: 'MyTick' };
        expect(tokenInfoTargetMatches(target, 'bitcoin-mainnet', 'mytick')).toBe(true);
        expect(tokenInfoTargetMatches(target, 'litecoin-mainnet', 'mytick')).toBe(false);
        expect(tokenInfoTargetMatches(target, 'bitcoin-mainnet', '')).toBe(false);
        expect(tokenInfoTargetMatches(null, 'bitcoin-mainnet', 'mytick')).toBe(false);
    });
});
