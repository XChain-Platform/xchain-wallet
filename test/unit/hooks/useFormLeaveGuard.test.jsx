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
        expect(result.current.confirmation.props.confirmLabel).toBe('Discard and leave');
        act(() => result.current.confirmation.props.onCancel());
        await pending;

        expect(onLeave).not.toHaveBeenCalled();
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
