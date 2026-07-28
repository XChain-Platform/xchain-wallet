// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  regression. `useTokenInfo`'s module cache had no TTL and no
// invalidation, so a tick record fetched once was authoritative for the whole
// session. Wallet E2E session 18 walked into the consequence: the wallet
// broadcast an ownership TRANSFER of S18PROBE, opened Manage Token as the NEW
// owner, and the page named the PREVIOUS owner, rendered the not-the-owner
// banner and cut the issuer action grid down to three buttons. A page reload
// was the only recovery and nothing on screen suggested one.
//
// These tests pin both halves of the fix: a precise invalidation that reaches
// an already-mounted hook, and a TTL that heals a change made elsewhere.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import {
    useTokenInfo, fetchTokenInfo, __clearTokenInfoCache,
} from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import {
    invalidateTokenInfo,
    invalidateTokenInfoForAction,
    ticksFromActionParams,
    TOKEN_INFO_TTL_MS,
} from '../../../packages/core/src/shared/utils/tokenInfoCache.js';

const CHAIN = 'bitcoin-regtest';
const TICK = 'S18PROBE';
const OLD_OWNER = 'n2XDwuR1qYxWptiebLzZSZZaoYsZR2CXK6';
const NEW_OWNER = 'bcrt1q3n72cq0uz67kf8xjew6nqggsmctpcm6dk9rate';

/** The indexer's answer, before and after the transfer confirms. */
function ownerSequence(...owners) {
    let call = 0;
    return vi.fn(async () => {
        const owner = owners[Math.min(call, owners.length - 1)];
        call += 1;
        return { creator: owner, totalSupply: '1000' };
    });
}

function wrapperFor(messaging) {
    return function Wrapper({ children }) {
        return (
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                {children}
            </MessagingContext.Provider>
        );
    };
}

function mountHook(messaging, args = {}) {
    return renderHook(
        () => useTokenInfo({ chainId: CHAIN, tick: TICK, ...args }),
        { wrapper: wrapperFor(messaging) },
    );
}

let nowSpy;
let clock;

beforeEach(() => {
    __clearTokenInfoCache();
    clock = 1_700_000_000_000;
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
    nowSpy.mockRestore();
    __clearTokenInfoCache();
});

describe('useTokenInfo cache', () => {
    it('still spares the refetch on Detail -> back -> Detail inside the TTL', async () => {
        const getTokenInfo = ownerSequence(OLD_OWNER);
        const first = mountHook({ getTokenInfo });
        await waitFor(() => expect(first.result.current?.creator).toBe(OLD_OWNER));
        first.unmount();

        clock += 5_000;
        const second = mountHook({ getTokenInfo });
        await waitFor(() => expect(second.result.current?.creator).toBe(OLD_OWNER));
        expect(getTokenInfo).toHaveBeenCalledTimes(1);
    });

    it('refetches a MOUNTED page after the tick is invalidated (the D-83 case)', async () => {
        const getTokenInfo = ownerSequence(OLD_OWNER, NEW_OWNER);
        const { result } = mountHook({ getTokenInfo });
        await waitFor(() => expect(result.current?.creator).toBe(OLD_OWNER));

        // What a successful broadcast against this tick now does.
        act(() => { invalidateTokenInfo(CHAIN, TICK); });

        await waitFor(() => expect(result.current?.creator).toBe(NEW_OWNER));
        expect(getTokenInfo).toHaveBeenCalledTimes(2);
    });

    it('invalidates regardless of the tick casing the action used', async () => {
        const getTokenInfo = ownerSequence(OLD_OWNER, NEW_OWNER);
        const { result } = mountHook({ getTokenInfo });
        await waitFor(() => expect(result.current?.creator).toBe(OLD_OWNER));

        act(() => { invalidateTokenInfo(CHAIN, TICK.toLowerCase()); });

        await waitFor(() => expect(result.current?.creator).toBe(NEW_OWNER));
    });

    it('leaves other ticks and other chains alone', async () => {
        const getTokenInfo = ownerSequence(OLD_OWNER);
        const { result } = mountHook({ getTokenInfo });
        await waitFor(() => expect(result.current?.creator).toBe(OLD_OWNER));

        act(() => {
            invalidateTokenInfo(CHAIN, 'SOMEOTHERTICK');
            invalidateTokenInfo('litecoin-regtest', TICK);
        });

        // No refetch was triggered, so the single call still stands.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(getTokenInfo).toHaveBeenCalledTimes(1);
        expect(result.current?.creator).toBe(OLD_OWNER);
    });

    it('re-reads on remount once the TTL lapses, for changes made elsewhere', async () => {
        const getTokenInfo = ownerSequence(OLD_OWNER, NEW_OWNER);
        const first = mountHook({ getTokenInfo });
        await waitFor(() => expect(first.result.current?.creator).toBe(OLD_OWNER));
        first.unmount();

        clock += TOKEN_INFO_TTL_MS + 1;

        const second = mountHook({ getTokenInfo });
        await waitFor(() => expect(second.result.current?.creator).toBe(NEW_OWNER));
        expect(getTokenInfo).toHaveBeenCalledTimes(2);
    });

    it('honours the TTL and invalidation on the promise-shaped sibling too', async () => {
        const messaging = { getTokenInfo: ownerSequence(OLD_OWNER, NEW_OWNER, NEW_OWNER) };

        expect((await fetchTokenInfo(messaging, CHAIN, TICK)).creator).toBe(OLD_OWNER);
        expect((await fetchTokenInfo(messaging, CHAIN, TICK)).creator).toBe(OLD_OWNER);
        expect(messaging.getTokenInfo).toHaveBeenCalledTimes(1);

        invalidateTokenInfo(CHAIN, TICK);
        expect((await fetchTokenInfo(messaging, CHAIN, TICK)).creator).toBe(NEW_OWNER);
        expect(messaging.getTokenInfo).toHaveBeenCalledTimes(2);
    });
});

describe('ticksFromActionParams', () => {
    it('names the tick of every issuer action that can invalidate a record', () => {
        // An ownership transfer is an ISSUE carrying TRANSFER; a lock, a
        // description edit and a mint-settings edit are ISSUE too.
        expect(ticksFromActionParams({ TICK: TICK, TRANSFER: NEW_OWNER })).toEqual([TICK]);
        expect(ticksFromActionParams({ TICK: TICK, LOCK_SUPPLY: '1' })).toEqual([TICK]);
        expect(ticksFromActionParams({ TICK: TICK, AMOUNT: '10' })).toEqual([TICK]);
    });

    it('covers the multi-leg and cross-tick fields', () => {
        expect(ticksFromActionParams({ TICK: ['AAA', 'BBB', 'AAA'] })).toEqual(['AAA', 'BBB']);
        expect(ticksFromActionParams({ GIVE_TICK: 'AAA', GET_TICK: 'BBB' })).toEqual(['AAA', 'BBB']);
        expect(ticksFromActionParams({ TICK: 'AAA', DIVIDEND_TICK: 'BBB' })).toEqual(['AAA', 'BBB']);
        expect(ticksFromActionParams({ TICK: 'AAA', CALLBACK_TICK: 'BBB' })).toEqual(['AAA', 'BBB']);
    });

    it('is inert on the shapes that name no tick', () => {
        expect(ticksFromActionParams(null)).toEqual([]);
        expect(ticksFromActionParams({})).toEqual([]);
        expect(ticksFromActionParams({ TICK: '   ' })).toEqual([]);
    });
});

describe('invalidateTokenInfoForAction', () => {
    it('drops the record for an ownership transfer without touching the rest', async () => {
        const getTokenInfo = ownerSequence(OLD_OWNER, NEW_OWNER);
        const { result } = mountHook({ getTokenInfo });
        await waitFor(() => expect(result.current?.creator).toBe(OLD_OWNER));

        act(() => {
            invalidateTokenInfoForAction(CHAIN, {
                action: 'ISSUE',
                params: { TICK, TRANSFER: NEW_OWNER },
            });
        });

        await waitFor(() => expect(result.current?.creator).toBe(NEW_OWNER));
    });

    it('is a no-op without a chainId or an action', () => {
        expect(() => invalidateTokenInfoForAction(null, { params: { TICK } })).not.toThrow();
        expect(() => invalidateTokenInfoForAction(CHAIN, null)).not.toThrow();
    });
});
