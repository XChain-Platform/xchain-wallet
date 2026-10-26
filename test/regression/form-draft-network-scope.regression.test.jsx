// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a form draft belongs to the network it was composed on.
// A mainnet recipient, chain and amount never restore into a testnet form.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFormDraft } from '../../packages/core/src/shared/hooks/useFormDraft.js';

afterEach(() => localStorage.clear());

describe('form draft network scope', () => {
    it('hides a mainnet draft on testnet and shows it again on mainnet', () => {
        const mainnet = renderHook(() => useFormDraft({
            view: 'send', walletId: 'w1', network: 'mainnet',
        }));
        act(() => mainnet.result.current.save({ chainId: 'bitcoin-mainnet', amount: '1.5' }));

        const testnet = renderHook(() => useFormDraft({
            view: 'send', walletId: 'w1', network: 'testnet',
        }));
        expect(testnet.result.current.load()).toBeNull();
        expect(testnet.result.current.hasDraft()).toBe(false);

        const back = renderHook(() => useFormDraft({
            view: 'send', walletId: 'w1', network: 'mainnet',
        }));
        expect(back.result.current.load()).toEqual({ chainId: 'bitcoin-mainnet', amount: '1.5' });
        expect(back.result.current.hasDraft()).toBe(true);
    });

    it('reads a draft before the network is known and from older records', () => {
        localStorage.setItem('xc:formdraft:send:w1', JSON.stringify({
            savedAt: Date.now(), values: { amount: '2' },
        }));
        const unknown = renderHook(() => useFormDraft({ view: 'send', walletId: 'w1' }));
        expect(unknown.result.current.load()).toEqual({ amount: '2' });
        const known = renderHook(() => useFormDraft({
            view: 'send', walletId: 'w1', network: 'testnet',
        }));
        expect(known.result.current.load()).toEqual({ amount: '2' });
    });
});
