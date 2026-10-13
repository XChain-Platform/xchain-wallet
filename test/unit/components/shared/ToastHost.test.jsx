// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import toastStyles from '../../../../packages/core/src/shared/components/ToastHost.module.css';

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
    let id;
    act(() => {
        id = toastApi.showToast(input);
    });
    return id;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

    it('generates bounded unique ids without overflowing the visible stack', () => {
        let state = 0x5eed1234;
        vi.spyOn(Math, 'random').mockImplementation(() => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 0x1_0000_0000;
        });
        setup();

        const ids = Array.from({ length: 8 }, (_, index) => show({
            message: `Generated toast ${index}`,
            durationMs: 0,
        }));

        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(id).toMatch(/^toast-\d{13}-\d{1,6}$/);
            expect(id.length).toBeLessThanOrEqual(33);
        }
        expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(3);
        expect(screen.getByText('+5 more')).toBeInTheDocument();
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

    it('replaces a repeated toast id and gives the replacement a fresh timeout', () => {
        setup();
        show({ id: 'save-result', message: 'Saving failed', durationMs: 1000 });
        act(() => vi.advanceTimersByTime(500));

        show({ id: 'save-result', message: 'Saved', durationMs: 1000 });

        expect(screen.queryByText('Saving failed')).toBeNull();
        expect(screen.getByText('Saved')).toBeTruthy();
        act(() => vi.advanceTimersByTime(500));
        expect(screen.getByText('Saved')).toBeTruthy();
        act(() => vi.advanceTimersByTime(500));
        expect(screen.queryByText('Saved')).toBeNull();
    });

    it('contains synchronous action failures and still dismisses the toast', () => {
        setup();
        show({
            id: 'undo',
            message: 'Contact deleted',
            actionLabel: 'Undo',
            onAction: () => { throw new Error('restore failed'); },
            durationMs: 0,
        });

        expect(() => fireEvent.click(screen.getByRole('button', { name: 'Undo' }))).not.toThrow();
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

    it('uses the shared notice geometry and dismiss control size', () => {
        setup();
        show({
            id: 'undo',
            message: 'Contact deleted',
            actionLabel: 'Undo',
            onAction: vi.fn(),
            durationMs: 0,
        });

        expect(screen.getByText('Contact deleted').closest('div')).toHaveClass(toastStyles.toast);
        expect(screen.getByRole('button', { name: 'Dismiss notification' }))
            .toHaveClass(toastStyles.dismissBtn);

        const css = readFileSync(
            'packages/core/src/shared/components/ToastHost.module.css',
            'utf8',
        );
        expect(css).toMatch(/\.toast\s*\{[^}]*padding:\s*var\(--xc-card-pad\)/s);
        expect(css).toMatch(/\.toast\s*\{[^}]*border-radius:\s*var\(--xc-card-radius\)/s);
        expect(css).toMatch(/\.dismissBtn\s*\{[^}]*min-width:\s*var\(--xc-control-h-sm\)[^}]*min-height:\s*var\(--xc-control-h-sm\)/s);
    });

    it('lays every tone tint over the opaque raised surface', () => {
        // The tone tints are 10 to 14 percent alpha; on their own they let the
        // page text show through a floating toast (Receive at 360 wide).
        const css = readFileSync('packages/core/src/shared/components/ToastHost.module.css', 'utf8');
        for (const tone of ['info', 'warning', 'success', 'error']) {
            const block = css.match(new RegExp(`\\.variant_${tone}\\s*\\{([^}]*)\\}`));
            expect(block, tone).not.toBeNull();
            expect(block[1], tone).toMatch(/background:\s*linear-gradient\([^;]*\),\s*var\(--xc-surface-raised\);/);
        }
    });
});
