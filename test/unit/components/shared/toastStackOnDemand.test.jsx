// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../../packages/core/src/shared/hooks/useHaptic.js', () => {
    const haptic = { error: () => {}, warn: () => {}, success: () => {}, tap: () => {} };
    return { useHaptic: () => haptic, HapticProvider: ({ children }) => children };
});

// No preload here: this file covers a toast raised before the cards' module
// (and its stylesheet) has loaded, which the app's idle preload makes rare.
import { ToastHost, useToast } from '../../../../packages/core/src/shared/components/ToastHost.jsx';

afterEach(() => {
    cleanup();
});

describe('ToastHost before its cards load', () => {
    it('keeps the live region from the first frame and shows an early toast once the cards load', async () => {
        let api;
        function Capture() {
            api = useToast();
            return null;
        }
        render(<ToastHost><Capture /></ToastHost>);
        const region = screen.getByRole('status', { name: 'Notifications' });
        expect(region).toHaveAttribute('aria-live', 'polite');

        act(() => { api.showToast({ id: 'early', message: 'Address copied', durationMs: 0 }); });

        const card = await screen.findByText('Address copied');
        expect(region).toContainElement(card);
        expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeTruthy();
    });
});
