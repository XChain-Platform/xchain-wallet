// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A lock takes the toasts off in the same commit that shows the lock screen.
// A passive effect runs after the browser paints, so a clear done there lets
// the lock screen show a payment toast's amount for a frame. This file turns
// passive effects off, which leaves only what runs before paint: a lock must
// still clear every toast.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useEffect: () => {} };
});

vi.mock('../../../../packages/core/src/shared/hooks/useHaptic.js', () => ({
    useHaptic: () => ({ error() {}, success() {}, tap() {}, warn() {} }),
    HapticProvider: ({ children }) => children,
}));

import {
    ToastHost, preloadToastStack, useClearToastsOnLock, useToast,
} from '../../../../packages/core/src/shared/components/ToastHost.jsx';

let toastApi;

function Screen({ state }) {
    toastApi = useToast();
    useClearToastsOnLock(state);
    return null;
}

const app = (state) => (<ToastHost><Screen state={state} /></ToastHost>);

beforeAll(() => preloadToastStack());
afterEach(cleanup);

describe('useClearToastsOnLock frame', () => {
    it('clears the toasts before paint, with no passive effect to lean on', () => {
        const view = render(app('unlocked'));
        act(() => { toastApi.showToast({ id: 'n', message: '1.25 LOCKAMT received', durationMs: 0 }); });
        expect(screen.getByText('1.25 LOCKAMT received')).toBeInTheDocument();

        view.rerender(app('locked'));
        expect(screen.queryByText('1.25 LOCKAMT received')).toBeNull();
    });
});
