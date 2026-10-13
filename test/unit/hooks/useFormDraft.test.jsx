// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useFormDraft } from '../../../packages/core/src/shared/hooks/useFormDraft.js';

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
});

describe('useFormDraft', () => {
    it('saves, loads, and clears a wallet-scoped draft', () => {
        const { result } = renderHook(() => useFormDraft({
            view: 'send', walletId: 'wallet-1', ttlMs: 60_000,
        }));

        act(() => result.current.save({ address: 'bc1qrecipient', amount: '2' }));
        expect(result.current.storageKey).toBe('xc:formdraft:send:wallet-1');
        expect(result.current.hasDraft()).toBe(true);
        expect(result.current.load()).toEqual({ address: 'bc1qrecipient', amount: '2' });

        act(() => result.current.clear());
        expect(result.current.hasDraft()).toBe(false);
    });

    it('evicts an expired draft', () => {
        const { result } = renderHook(() => useFormDraft({
            view: 'send', walletId: 'wallet-1', ttlMs: 1000,
        }));
        act(() => result.current.save({ amount: '3' }));

        vi.setSystemTime(new Date('2026-01-01T00:00:01.001Z'));

        expect(result.current.load()).toBe(null);
        expect(result.current.hasDraft()).toBe(false);
    });

    it('removes old data and refuses persistence when the TTL is disabled', () => {
        localStorage.setItem('xc:formdraft:send:wallet-1', JSON.stringify({
            savedAt: Date.now(), values: { amount: '4' },
        }));
        const { result } = renderHook(() => useFormDraft({
            view: 'send', walletId: 'wallet-1', ttlMs: 0,
        }));

        expect(result.current.load()).toBe(null);
        act(() => result.current.save({ amount: '5' }));
        expect(result.current.hasDraft()).toBe(false);
    });

    it('disables draft persistence when accessing localStorage throws', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get: () => { throw new Error('storage disabled'); },
        });

        try {
            const { result } = renderHook(() => useFormDraft({
                view: 'send', walletId: 'wallet-1', ttlMs: 60_000,
            }));
            expect(result.current.load()).toBeNull();
            expect(() => result.current.save({ amount: '5' })).not.toThrow();
            expect(() => result.current.clear()).not.toThrow();
            expect(result.current.hasDraft()).toBe(false);
        } finally {
            Object.defineProperty(globalThis, 'localStorage', descriptor);
        }
    });
});
