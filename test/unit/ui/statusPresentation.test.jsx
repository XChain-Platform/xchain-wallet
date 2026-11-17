// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import statusStyles from '../../../packages/core/src/ui/StatusMessage.module.css';
import toastStyles from '../../../packages/core/src/shared/components/ToastStack.module.css';
import timelineStyles from '../../../packages/core/src/shared/components/TxStatusTimeline.module.css';

const haptic = vi.hoisted(() => ({
    error: vi.fn(),
    success: vi.fn(),
    tap: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useHaptic.js', () => ({
    useHaptic: () => haptic,
    HapticProvider: ({ children }) => children,
}));

import { ToastHost, preloadToastStack, useToast } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';

let toastApi;

function CaptureToastApi() {
    toastApi = useToast();
    return null;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('semantic status presentation', () => {
    // The app loads the toast cards on idle after first paint; load them up front here.
    beforeAll(() => preloadToastStack());

    // Notice Standard (2026-11-15): the tone's icon is an SVG (circle i,
    // circle !, circle check), never the old glyphs, and the danger icon is
    // not an X, which now means dismiss. Warning keeps its variant name but
    // takes the danger tone.
    it.each([
        ['info', 'info', statusStyles.info],
        ['warning', 'danger', statusStyles.warning],
        ['error', 'danger', statusStyles.error],
        ['success', 'success', statusStyles.success],
    ])('gives StatusMessage %s a matching tone and icon', (variant, tone, className) => {
        render(<StatusMessage variant={variant}>{`${variant} message`}</StatusMessage>);
        const message = screen.getByText(`${variant} message`).closest('[data-variant]');

        expect(message).toHaveAttribute('data-variant', variant);
        expect(message).toHaveAttribute('data-tone', tone);
        expect(message).toHaveClass(className);
        const icon = message.querySelector('[aria-hidden="true"]');
        expect(icon.querySelector('svg')).not.toBeNull();
        expect(icon).not.toHaveTextContent(/[ℹ⚠✕✓]/);
    });

    it.each([
        ['info', 'info', toastStyles.variant_info, 'tap'],
        ['warning', 'danger', toastStyles.variant_warning, 'warn'],
        ['error', 'danger', toastStyles.variant_error, 'error'],
        ['success', 'success', toastStyles.variant_success, 'success'],
    ])('gives a %s toast the %s Notice tone, an SVG icon and a haptic', (variant, noticeTone, className, hapticName) => {
        render(
            <ToastHost>
                <CaptureToastApi />
            </ToastHost>,
        );
        act(() => toastApi.showToast({
            id: variant,
            message: `${variant} toast`,
            variant,
            durationMs: 0,
        }));
        const toast = screen.getByText(`${variant} toast`).closest('[data-variant]');

        expect(toast).toHaveAttribute('data-variant', variant);
        expect(toast).toHaveClass(className);
        expect(toast).toHaveAttribute('data-tone', noticeTone);
        const icon = toast.querySelector('[aria-hidden="true"]');
        expect(icon.querySelector('svg')).not.toBeNull();
        expect(icon).not.toHaveTextContent(/[ℹ⚠✕✓]/);
        expect(toast.querySelector('button svg')).not.toBeNull();
        expect(haptic[hapticName]).toHaveBeenCalledOnce();
    });

    it('presents a failed transaction as error rather than warning', () => {
        render(<TxStatusTimeline entry={{
            txHash: '',
            blockIndex: 0,
            timestamp: 0,
            pending: { failed: true },
        }} />);
        const failed = screen.getByText('Current stage: Failed').closest('li');

        expect(failed).toHaveClass(timelineStyles.rowError);
        expect(failed).not.toHaveClass(timelineStyles.rowWarn);
        expect(failed.querySelector('.' + timelineStyles.dot)).toHaveTextContent('✕');
    });

    it('uses theme-aware semantic tokens for status surfaces and inline error focus', () => {
        const statusCss = readFileSync('packages/core/src/ui/StatusMessage.module.css', 'utf8');
        const toastCss = readFileSync('packages/core/src/shared/components/ToastStack.module.css', 'utf8');
        const timelineCss = readFileSync('packages/core/src/shared/components/TxStatusTimeline.module.css', 'utf8');
        const inputCss = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');

        // The notice and the toast: a warning takes the danger tone (Notice
        // Standard, 2026-11-15).
        for (const [tone, token] of [
            ['info', 'info'],
            ['warning', 'danger'],
            ['error', 'danger'],
            ['success', 'success'],
        ]) {
            expect(statusCss).toMatch(new RegExp(`\\.row\\.${tone}[\\s\\S]*?var\\(--xc-${token}`));
        }
        for (const [tone, token] of [
            ['info', 'info'],
            ['warning', 'danger'],
            ['success', 'success'],
            ['error', 'danger'],
        ]) {
            expect(toastCss).toMatch(new RegExp(`\\.variant_${tone}\\s*\\{[^}]*var\\(--xc-${token}\\)`, 's'));
        }
        expect(toastCss).not.toMatch(/--xc-warning/);
        expect(timelineCss).toMatch(/\.rowError[^}]*var\(--xc-danger-fg\)/s);
        expect(inputCss).toMatch(/\.invalid:focus[^{]*\{[^}]*var\(--xc-danger-bg\)/s);
        expect(inputCss).not.toMatch(/\.invalid:focus[^{]*\{[^}]*rgba\(/s);
    });
});
