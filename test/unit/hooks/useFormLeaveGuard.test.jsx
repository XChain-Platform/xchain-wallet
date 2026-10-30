// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFormLeaveGuard } from '../../../packages/core/src/shared/hooks/useFormLeaveGuard.js';

afterEach(() => {
    cleanup();
});

function mountGuard(overrides = {}) {
    const onLeave = vi.fn();
    const initialProps = {
        dirty: false,
        submitting: false,
        signedUnbroadcast: false,
        onLeave,
        ...overrides,
    };
    const view = renderHook((props) => useFormLeaveGuard(props), { initialProps });
    return { onLeave, ...view };
}

describe('useFormLeaveGuard in-app navigation', () => {
    it('leaves immediately when the form has no real input', async () => {
        const { result, onLeave } = mountGuard();

        await act(() => result.current.guardedOnBack());

        expect(onLeave).toHaveBeenCalledOnce();
        expect(result.current.confirmation).toBeNull();
    });

    it('asks before discarding a dirty form and respects cancel', async () => {
        const { result, onLeave } = mountGuard({ dirty: true });
        let pending;

        act(() => { pending = result.current.guardedOnBack(); });
        expect(result.current.confirmation.props.title).toBe('Discard changes?');
        expect(result.current.confirmation.props.message).toBe('Your unsaved changes will be lost.');
        expect(result.current.confirmation.props.message).not.toMatch(/discard/i);
        expect(result.current.confirmation.props.confirmLabel).toBe('Discard and leave');
        act(() => result.current.confirmation.props.onCancel());
        await pending;

        expect(onLeave).not.toHaveBeenCalled();
    });

    it('names the rows a part-way run has not sent', async () => {
        const { result, onLeave } = mountGuard({ unsentRows: 2 });
        let pending;

        act(() => { pending = result.current.guardedOnBack(); });
        expect(result.current.confirmation.props.message).toBe('2 rows have not been sent. Leave anyway?');
        expect(result.current.confirmation.props.confirmLabel).toBe('Leave anyway');
        act(() => result.current.confirmation.props.onConfirm());
        await pending;
        expect(onLeave).toHaveBeenCalledOnce();

        const single = mountGuard({ unsentRows: 1 });
        act(() => { single.result.current.guardedOnBack(); });
        expect(single.result.current.confirmation.props.message).toBe('1 row has not been sent. Leave anyway?');
    });

    it('uses transaction safety copy for an unsaved signed result', async () => {
        const { result, onLeave } = mountGuard({ signedUnbroadcast: true });
        let pending;

        act(() => { pending = result.current.guardedOnBack(); });
        expect(result.current.confirmation.props.title).toBe('Leave signed transaction?');
        expect(result.current.confirmation.props.message).toContain('held only in this window');
        act(() => result.current.confirmation.props.onConfirm());
        await pending;

        expect(onLeave).toHaveBeenCalledOnce();
    });
});

describe('useFormLeaveGuard discard callback', () => {
    it('runs onDiscard before onLeave when the user confirms Discard and leave', async () => {
        const calls = [];
        const onDiscard = vi.fn(() => calls.push('discard'));
        const onLeave = vi.fn(() => calls.push('leave'));
        const { result } = mountGuard({ dirty: true, onDiscard, onLeave });
        let pending;

        act(() => { pending = result.current.guardedOnBack(); });
        act(() => result.current.confirmation.props.onConfirm());
        await pending;

        expect(calls).toEqual(['discard', 'leave']);
    });

    it('keeps the draft when the user cancels the discard', async () => {
        const onDiscard = vi.fn();
        const { result, onLeave } = mountGuard({ dirty: true, onDiscard });
        let pending;

        act(() => { pending = result.current.guardedOnBack(); });
        act(() => result.current.confirmation.props.onCancel());
        await pending;

        expect(onDiscard).not.toHaveBeenCalled();
        expect(onLeave).not.toHaveBeenCalled();
    });

    it('does not discard on a clean exit', async () => {
        const onDiscard = vi.fn();
        const { result, onLeave } = mountGuard({ onDiscard });

        await act(() => result.current.guardedOnBack());

        expect(onLeave).toHaveBeenCalledOnce();
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it.each([
        ['an in-flight transaction', { submitting: true }],
        ['an unsaved signed transaction', { signedUnbroadcast: true }],
    ])('does not discard when leaving %s', async (_label, flags) => {
        const onDiscard = vi.fn();
        const { result, onLeave } = mountGuard({ dirty: true, ...flags, onDiscard });
        let pending;

        act(() => { pending = result.current.guardedOnBack(); });
        act(() => result.current.confirmation.props.onConfirm());
        await pending;

        expect(onLeave).toHaveBeenCalledOnce();
        expect(onDiscard).not.toHaveBeenCalled();
    });
});

describe('useFormLeaveGuard browser close', () => {
    it('does not intercept beforeunload for a clean form', () => {
        mountGuard();
        const event = new Event('beforeunload', { cancelable: true });

        window.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it.each([
        ['real input', { dirty: true }],
        ['an in-flight transaction', { submitting: true }],
        ['an unsaved signed transaction', { signedUnbroadcast: true }],
    ])('intercepts beforeunload for %s', (_label, flags) => {
        mountGuard(flags);
        const event = new Event('beforeunload', { cancelable: true });

        window.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
    });
});
