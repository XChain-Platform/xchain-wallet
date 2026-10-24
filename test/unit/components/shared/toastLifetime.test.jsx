// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

vi.mock('../../../../packages/core/src/shared/hooks/useHaptic.js', () => {
    const haptic = { error: () => {}, warn: () => {}, success: () => {}, tap: () => {} };
    return { useHaptic: () => haptic, HapticProvider: ({ children }) => children };
});

import { useLastView } from '../../../../packages/core/src/shared/hooks/useLastView.js';
import { ToastHost, useToast } from '../../../../packages/core/src/shared/components/ToastHost.jsx';

let api;
function Capture() {
    api = useToast();
    return null;
}

const shown = () => Array.from(document.querySelectorAll('[data-variant]')).map((el) => el.textContent);

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('toast lifetime', () => {
    it('drops a short confirmation within 3 s and keeps an error for 8 s', () => {
        vi.useFakeTimers();
        render(<ToastHost><Capture /></ToastHost>);
        act(() => {
            api.showToast({ message: 'QR code copied to clipboard.' });
            api.showToast({ message: 'Could not copy.', variant: 'error' });
        });
        expect(shown()).toHaveLength(2);
        act(() => { vi.advanceTimersByTime(3000); });
        expect(shown().join('|')).not.toContain('QR code copied');
        expect(shown().join('|')).toContain('Could not copy');
        act(() => { vi.advanceTimersByTime(5100); });
        expect(shown()).toHaveLength(0);
    });

    it('dismisses stale plain toasts on a route change and keeps action and fresh ones', () => {
        vi.useFakeTimers();
        render(<ToastHost><Capture /></ToastHost>);
        act(() => {
            api.showToast({ message: 'Old copy', durationMs: 0 });
            api.showToast({ message: 'Undo me', durationMs: 0, actionLabel: 'Undo', onAction: () => {} });
        });
        act(() => { vi.advanceTimersByTime(1000); });
        act(() => { api.showToast({ message: 'Fresh note', durationMs: 0 }); });
        act(() => { api.dismissStaleToasts(); });
        const text = shown().join('|');
        expect(text).not.toContain('Old copy');
        expect(text).toContain('Undo me');
        expect(text).toContain('Fresh note');
    });

    it('useLastView dismisses stale toasts when the view changes', () => {
        vi.useFakeTimers();
        function Screen({ view }) {
            useLastView({ walletId: 'w1', currentView: view, onResume: () => {}, sessionActive: false });
            return null;
        }
        const ui = (view) => <ToastHost><Capture /><Screen view={view} /></ToastHost>;
        const { rerender } = render(ui('receive'));
        act(() => { api.showToast({ message: 'QR code copied to clipboard.', durationMs: 0 }); });
        act(() => { vi.advanceTimersByTime(1000); });
        rerender(ui('send'));
        expect(shown()).toHaveLength(0);
    });
});
