// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useIsTokenIssuer } from '../../../../packages/core/src/shared/hooks/useIsTokenIssuer.js';

const observed = vi.hoisted(() => ({ setCalls: [] }));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useState(initialValue) {
            const [value, setValue] = actual.useState(initialValue);
            const setObserved = (next) => {
                observed.setCalls.push(next);
                return setValue(next);
            };
            return [value, setObserved];
        },
    };
});

const CHAIN = 'chain-1';

function entries(...addresses) {
    return { [CHAIN]: addresses.map((address) => ({ address })) };
}

function render(messaging, issuerAddress, walletId = 'w1') {
    return renderHook(
        (props) => useIsTokenIssuer(props),
        { initialProps: { messaging, walletId, chainId: CHAIN, issuerAddress } },
    );
}

describe('useIsTokenIssuer', () => {
    let messaging;

    beforeEach(() => {
        observed.setCalls.length = 0;
        messaging = { getAddressesByChain: vi.fn() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('when ownership cannot be determined', () => {
        it('returns null and never calls messaging without an issuer address', () => {
            const { result } = render(messaging, undefined);
            expect(result.current).toBeNull();
            expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        });

        it('returns null when messaging lacks getAddressesByChain', () => {
            const { result } = render({}, 'a1');
            expect(result.current).toBeNull();
        });

        it('returns null when the lookup rejects', async () => {
            messaging.getAddressesByChain.mockRejectedValue(new Error('boom'));
            const { result } = render(messaging, 'a1');
            await waitFor(() => expect(messaging.getAddressesByChain).toHaveBeenCalled());
            await Promise.resolve();
            expect(result.current).toBeNull();
        });
    });

    describe('when the lookup resolves', () => {
        it('returns true for an issuer in the list', async () => {
            messaging.getAddressesByChain.mockResolvedValue(entries('a1', 'a2'));
            const { result } = render(messaging, 'a2');
            await waitFor(() => expect(result.current).toBe(true));
        });

        it('returns false for an issuer not in the list', async () => {
            messaging.getAddressesByChain.mockResolvedValue(entries('a1', 'a2'));
            const { result } = render(messaging, 'zz');
            await waitFor(() => expect(result.current).toBe(false));
        });

        it('ignores null entries and non-string addresses', async () => {
            messaging.getAddressesByChain.mockResolvedValue({
                [CHAIN]: [null, { address: 42 }, { address: null }, { address: 'a1' }],
            });
            const { result } = render(messaging, 'a1');
            await waitFor(() => expect(result.current).toBe(true));
        });

        it('does not match a non-string address to the issuer', async () => {
            messaging.getAddressesByChain.mockResolvedValue({
                [CHAIN]: [null, { address: 42 }],
            });
            const { result } = render(messaging, 42);
            await waitFor(() => expect(result.current).toBe(false));
        });

        it('returns false when the chain has no key', async () => {
            messaging.getAddressesByChain.mockResolvedValue({ other: [{ address: 'a1' }] });
            const { result } = render(messaging, 'a1');
            await waitFor(() => expect(result.current).toBe(false));
        });

        it('passes the wallet id to getAddressesByChain', async () => {
            messaging.getAddressesByChain.mockResolvedValue(entries('a1'));
            const { result } = render(messaging, 'a1', 'wallet-xyz');
            await waitFor(() => expect(result.current).toBe(true));
            expect(messaging.getAddressesByChain).toHaveBeenCalledWith('wallet-xyz');
        });
    });

    describe('lifecycle', () => {
        it('returns to null when the issuer address is cleared', async () => {
            messaging.getAddressesByChain.mockResolvedValue(entries('a1'));
            const { result, rerender } = render(messaging, 'a1');
            await waitFor(() => expect(result.current).toBe(true));
            rerender({ messaging, walletId: 'w1', chainId: CHAIN, issuerAddress: null });
            await waitFor(() => expect(result.current).toBeNull());
        });

        it('logs no console.error when the lookup resolves after unmount', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            let resolveLookup;
            messaging.getAddressesByChain.mockReturnValue(
                new Promise((resolve) => { resolveLookup = resolve; }),
            );
            const { unmount } = render(messaging, 'a1');
            unmount();
            resolveLookup(entries('a1'));
            await Promise.resolve();
            await Promise.resolve();
            expect(errorSpy).not.toHaveBeenCalled();
            expect(observed.setCalls).toEqual([]);
        });
    });
});
