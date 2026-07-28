// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  regression. A cold load, and later any re-mount after an idle
// auto-lock, greeted the user with "You're offline. Can't reach the network."
// while the explorer, the encoder and the hub were all answering 200 from the
// same host. Wallet E2E sessions 18 and 19 saw it three times; one press of
// Retry always cleared it.
//
// The banner was reading a verdict the wallet had invented. Settings live in
// the encrypted vault, so the chain set is empty until the vault is readable;
// the hook probed anyway and the host maps an empty chain set to 'offline'.
// It then STUCK, because that first answer could land after the real probe's
// verdict and overwrite it.
//
// These tests pin the three halves of the fix: no probe (and no verdict)
// without a chain set, a newer probe that a slower older one cannot overwrite,
// and one failed round-trip that is not by itself proof of being offline.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, render, screen, waitFor, act } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { useReachability } from '../../../packages/core/src/shared/hooks/useReachability.js';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';

const BTC = 'bitcoin-regtest';
const LTC = 'litecoin-regtest';

/** The settings record a regtest wallet has once the vault is readable. */
function unlockedSettings() {
    return {
        activeNetwork: 'regtest',
        fees: { [BTC]: { strategy: 'normal' }, [LTC]: { strategy: 'normal' } },
    };
}

function healthy(chainIds) {
    return {
        overall: 'normal',
        perChain: chainIds.map((chainId) => ({
            chainId,
            mode: 'normal',
            services: { encoder: 'reachable', hub: 'reachable', explorer: 'reachable' },
        })),
    };
}

function allDown(chainIds) {
    return {
        overall: 'offline',
        perChain: chainIds.map((chainId) => ({
            chainId,
            mode: 'offline',
            services: { encoder: 'unreachable', hub: 'unreachable', explorer: 'unreachable' },
        })),
    };
}

/** What the host actually answers when it is handed no chains at all. */
const EMPTY_CHAIN_SET_ANSWER = { overall: 'offline', perChain: [] };

/**
 * A messaging module whose settings read fails while the wallet is locked and
 * succeeds after `unlock()`, the real cold-load / auto-lock sequence.
 */
function lockedThenUnlockedMessaging(checkReachabilityRequest) {
    let locked = true;
    return {
        shell: 'web',
        locked: () => locked,
        unlock() {
            locked = false;
            act(() => { window.dispatchEvent(new CustomEvent('xc:session-changed')); });
        },
        getSettings: vi.fn(async () => {
            if (locked) throw new Error('vault is locked');
            return unlockedSettings();
        }),
        checkReachabilityRequest,
    };
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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('useReachability ', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('does not probe, and claims nothing, while the chain set is unseeded', async () => {
        const check = vi.fn(async () => EMPTY_CHAIN_SET_ANSWER);
        const messaging = lockedThenUnlockedMessaging(check);
        const { result } = renderHook(() => useReachability({ intervalMs: 0 }), {
            wrapper: wrapperFor(messaging),
        });

        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        // The whole defect in one assertion: no chains means no round-trip,
        // and no round-trip means no verdict about the user's connection.
        expect(check).not.toHaveBeenCalled();
        expect(result.current.overall).toBe('unknown');
        expect(result.current.perChain).toEqual([]);
    });

    it('probes for real, once, as soon as the vault hands over the chain set', async () => {
        const check = vi.fn(async ({ chainIds }) => healthy(chainIds));
        const messaging = lockedThenUnlockedMessaging(check);
        const { result } = renderHook(() => useReachability({ intervalMs: 0 }), {
            wrapper: wrapperFor(messaging),
        });

        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        messaging.unlock();

        await waitFor(() => expect(result.current.overall).toBe('normal'));
        expect(check).toHaveBeenCalledTimes(1);
        expect(check.mock.calls[0][0].chainIds).toEqual([BTC, LTC]);
    });

    it('reports a genuine outage, with the per-chain evidence behind it', async () => {
        const check = vi.fn(async ({ chainIds }) => allDown(chainIds));
        const messaging = lockedThenUnlockedMessaging(check);
        const { result } = renderHook(() => useReachability({ intervalMs: 0 }), {
            wrapper: wrapperFor(messaging),
        });
        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        messaging.unlock();

        await waitFor(() => expect(result.current.overall).toBe('offline'));
        expect(result.current.perChain).toHaveLength(2);
    });

    it('never lets a slower older probe overwrite the current verdict', async () => {
        // This is why one Retry always fixed it: the stale answer had already
        // landed on top of the fresh one, and nothing else was going to poll.
        const slow = deferred();
        const check = vi.fn(({ chainIds }) => (chainIds[0] === BTC
            ? slow.promise
            : Promise.resolve(healthy(chainIds))));
        const messaging = { shell: 'web', getSettings: vi.fn(async () => unlockedSettings()), checkReachabilityRequest: check };

        const { result, rerender } = renderHook(
            ({ chainIds }) => useReachability({ chainIds, intervalMs: 0 }),
            { wrapper: wrapperFor(messaging), initialProps: { chainIds: [BTC] } },
        );
        await waitFor(() => expect(check).toHaveBeenCalledTimes(1));

        rerender({ chainIds: [LTC] });
        await waitFor(() => expect(result.current.overall).toBe('normal'));

        // The first probe finally answers, about a chain set nobody is showing.
        await act(async () => {
            slow.resolve(allDown([BTC]));
            await slow.promise;
        });
        expect(result.current.overall).toBe('normal');
        expect(result.current.perChain.map((c) => c.chainId)).toEqual([LTC]);
    });

    it('treats one failed round-trip as inconclusive and re-probes before accusing the connection', async () => {
        // A cold load can beat the shell's own host to the first probe. That is
        // the wallet still coming up, not the user's internet.
        const check = vi.fn()
            .mockRejectedValueOnce(new Error('host not ready'))
            .mockImplementation(async ({ chainIds }) => healthy(chainIds));
        const messaging = { shell: 'web', getSettings: vi.fn(async () => unlockedSettings()), checkReachabilityRequest: check };

        const seen = [];
        const { result } = renderHook(
            () => {
                const state = useReachability({ intervalMs: 0, failureRetryMs: 5 });
                seen.push(state.overall);
                return state;
            },
            { wrapper: wrapperFor(messaging) },
        );

        await waitFor(() => expect(result.current.overall).toBe('normal'));
        // Not even for one paint: the banner is the first screen a returning
        // user sees, so a transient false "offline" is the whole bug.
        expect(seen).not.toContain('offline');
        // The failure never became a verdict, and the recovery took a retry
        // the hook issued itself, not one the user had to discover.
        expect(check).toHaveBeenCalledTimes(2);
        expect(result.current.overall).not.toBe('offline');
    });

    it('does call it offline once two round-trips in a row fail', async () => {
        const check = vi.fn(async () => { throw new Error('network down'); });
        const messaging = { shell: 'web', getSettings: vi.fn(async () => unlockedSettings()), checkReachabilityRequest: check };

        const { result } = renderHook(
            () => useReachability({ intervalMs: 0, failureRetryMs: 5 }),
            { wrapper: wrapperFor(messaging) },
        );

        await waitFor(() => expect(result.current.overall).toBe('offline'));
        expect(check).toHaveBeenCalledTimes(2);
    });
});

describe('ReachabilityBanner ', () => {
    it('stays silent on a cold load instead of blaming the user\'s connection', async () => {
        const check = vi.fn(async () => EMPTY_CHAIN_SET_ANSWER);
        const messaging = lockedThenUnlockedMessaging(check);
        render(
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                <ReachabilityBanner intervalMs={0} />
            </MessagingContext.Provider>,
        );

        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/You're offline/)).toBeNull();
        expect(check).not.toHaveBeenCalled();
    });

    it('still shows the banner when the chains really are unreachable', async () => {
        const check = vi.fn(async ({ chainIds }) => allDown(chainIds));
        const messaging = { shell: 'web', getSettings: vi.fn(async () => unlockedSettings()), checkReachabilityRequest: check };
        render(
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                <ReachabilityBanner intervalMs={0} />
            </MessagingContext.Provider>,
        );

        await waitFor(() => expect(screen.getByText(/You're offline/)).toBeTruthy());
    });
});
