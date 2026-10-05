// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useConfirmModal } from '../../../../packages/core/src/shared/hooks/useConfirmModal.js';

afterEach(() => {
    cleanup();
});

const PENDING = Symbol('pending');

async function peek(promise) {
    const sentinel = Promise.resolve(PENDING);
    return Promise.race([promise, sentinel]);
}

describe('useConfirmModal request state', () => {
    it('starts with a null request', () => {
        const { result } = renderHook(() => useConfirmModal());
        expect(result.current.request).toBeNull();
    });

    it('sets request to the options object and returns a pending promise', async () => {
        const { result } = renderHook(() => useConfirmModal());
        const opts = { title: 'T' };
        let promise;
        act(() => {
            promise = result.current.confirm(opts);
        });
        expect(result.current.request).toBe(opts);
        expect(promise).toBeInstanceOf(Promise);
        expect(await peek(promise)).toBe(PENDING);
    });

    it('sets request to an empty object when called with no argument', () => {
        const { result } = renderHook(() => useConfirmModal());
        act(() => {
            result.current.confirm();
        });
        expect(result.current.request).toEqual({});
    });
});

describe('useConfirmModal settling', () => {
    it('onConfirm resolves true and clears request', async () => {
        const { result } = renderHook(() => useConfirmModal());
        let promise;
        act(() => {
            promise = result.current.confirm({ title: 'T' });
        });
        act(() => {
            result.current.onConfirm();
        });
        await expect(promise).resolves.toBe(true);
        expect(result.current.request).toBeNull();
    });

    it('onCancel resolves false and clears request', async () => {
        const { result } = renderHook(() => useConfirmModal());
        let promise;
        act(() => {
            promise = result.current.confirm({ title: 'T' });
        });
        act(() => {
            result.current.onCancel();
        });
        await expect(promise).resolves.toBe(false);
        expect(result.current.request).toBeNull();
    });

    it('does not throw and keeps request null when nothing is pending', () => {
        const { result } = renderHook(() => useConfirmModal());
        expect(() => act(() => result.current.onConfirm())).not.toThrow();
        expect(() => act(() => result.current.onCancel())).not.toThrow();
        expect(result.current.request).toBeNull();
    });
});

describe('useConfirmModal overlapping requests', () => {
    it('replaces request and settles only the second promise', async () => {
        const { result } = renderHook(() => useConfirmModal());
        const second = { title: 'second' };
        let first;
        let next;
        act(() => {
            first = result.current.confirm({ title: 'first' });
        });
        act(() => {
            next = result.current.confirm(second);
        });
        expect(result.current.request).toBe(second);
        act(() => {
            result.current.onConfirm();
        });
        await expect(next).resolves.toBe(true);
        expect(await peek(first)).toBe(PENDING);
    });
});

describe('useConfirmModal identity', () => {
    it('keeps confirm, onConfirm and onCancel stable across rerenders', () => {
        const { result, rerender } = renderHook(() => useConfirmModal());
        const before = result.current;
        rerender();
        act(() => {
            result.current.confirm({ title: 'T' });
        });
        expect(result.current.confirm).toBe(before.confirm);
        expect(result.current.onConfirm).toBe(before.onConfirm);
        expect(result.current.onCancel).toBe(before.onCancel);
    });
});
