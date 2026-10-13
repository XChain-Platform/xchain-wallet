// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    haptic: {
        error: vi.fn(),
        success: vi.fn(),
        tap: vi.fn(),
    },
}));

vi.mock('../../../../packages/core/src/shared/hooks/useHaptic.js', () => ({
    useHaptic: () => mocks.haptic,
    HapticProvider: ({ children }) => children,
}));

import { ToastHost, useToast } from '../../../../packages/core/src/shared/components/ToastHost.jsx';

let toastApi;

function CaptureToastApi() {
    toastApi = useToast();
    return null;
}

function setup() {
    return render(
        <ToastHost>
            <CaptureToastApi />
        </ToastHost>,
    );
}

function show(input) {
    act(() => {
        toastApi.showToast(input);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('ToastHost', () => {
    it('announces all nonblocking toasts through one polite region', () => {
        setup();
        show({ id: 'ok', message: 'Saved', durationMs: 0 });
        show({ id: 'bad', message: 'Save failed', variant: 'error', durationMs: 0 });

        const region = screen.getByRole('status', { name: 'Notifications' });
        expect(region).toHaveAttribute('aria-live', 'polite');
        expect(region).toHaveAttribute('aria-atomic', 'false');
        expect(region).toHaveTextContent('Saved');
        expect(region).toHaveTextContent('Save failed');
        expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('publishes copied and saved results through the same region', () => {
        setup();
        act(() => toastApi.announce('Copied'));
        const region = screen.getByRole('status', { name: 'Notifications' });
        expect(region).toHaveTextContent('Copied');

        act(() => toastApi.announce('Saved'));
        expect(region).toHaveTextContent('Saved');
        expect(region).not.toHaveTextContent('Copied');
    });

    it('gives queued toasts their full timeout after they become visible', () => {
        setup();
        for (let index = 1; index <= 4; index += 1) {
            show({ id: `toast-${index}`, message: `Toast ${index}`, durationMs: 1000 });
        }

        expect(screen.getByText('Toast 1')).toBeTruthy();
        expect(screen.getByText('Toast 2')).toBeTruthy();
        expect(screen.getByText('Toast 3')).toBeTruthy();
        expect(screen.queryByText('Toast 4')).toBeNull();
        expect(screen.getByText('+1 more')).toBeTruthy();

        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByText('Toast 4')).toBeTruthy();
        act(() => vi.advanceTimersByTime(999));
        expect(screen.getByText('Toast 4')).toBeTruthy();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.queryByText('Toast 4')).toBeNull();
    });

    it('keeps an action available for at least twelve seconds', () => {
        setup();
        show({
            id: 'undo',
            message: 'Contact deleted',
            actionLabel: 'Undo',
            onAction: vi.fn(),
            durationMs: 1000,
        });

        act(() => vi.advanceTimersByTime(11999));
        expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.queryByText('Contact deleted')).toBeNull();
    });

    it('dismisses a focused toast with Escape', () => {
        setup();
        show({ id: 'persistent', message: 'Copied', durationMs: 0 });
        const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
        dismiss.focus();
        fireEvent.keyDown(dismiss, { key: 'Escape' });
        expect(screen.queryByText('Copied')).toBeNull();
    });
});
