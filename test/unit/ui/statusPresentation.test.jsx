// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import statusStyles from '../../../packages/core/src/ui/StatusMessage.module.css';
import toastStyles from '../../../packages/core/src/shared/components/ToastHost.module.css';
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

import { ToastHost, useToast } from '../../../packages/core/src/shared/components/ToastHost.jsx';
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
    it.each([
        ['info', 'ℹ', statusStyles.info],
        ['warning', '⚠', statusStyles.warning],
        ['error', '✕', statusStyles.error],
        ['success', '✓', statusStyles.success],
    ])('gives StatusMessage %s a matching tone and visible glyph', (variant, glyph, className) => {
        render(<StatusMessage variant={variant}>{`${variant} message`}</StatusMessage>);
        const message = screen.getByText(`${variant} message`).closest('[data-variant]');

        expect(message).toHaveAttribute('data-variant', variant);
        expect(message).toHaveClass(className);
        expect(message.querySelector('[aria-hidden="true"]')).toHaveTextContent(glyph);
    });

    it.each([
        ['info', 'ℹ', toastStyles.variant_info, 'tap'],
        ['warning', '⚠', toastStyles.variant_warning, 'warn'],
        ['error', '✕', toastStyles.variant_error, 'error'],
        ['success', '✓', toastStyles.variant_success, 'success'],
    ])('gives a %s toast a matching tone, glyph and haptic', (variant, glyph, className, hapticName) => {
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
        expect(toast.querySelector('[aria-hidden="true"]')).toHaveTextContent(glyph);
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
        const toastCss = readFileSync('packages/core/src/shared/components/ToastHost.module.css', 'utf8');
        const timelineCss = readFileSync('packages/core/src/shared/components/TxStatusTimeline.module.css', 'utf8');
        const inputCss = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');

        for (const [tone, token] of [
            ['info', 'info'],
            ['warning', 'warning'],
            ['success', 'success'],
        ]) {
            expect(statusCss).toMatch(new RegExp(`\\.row\\.${tone}[\\s\\S]*?var\\(--xc-${token}`));
            expect(toastCss).toMatch(new RegExp(`\\.variant_${tone}[\\s\\S]*?var\\(--xc-${token}`));
        }
        expect(toastCss).toMatch(/\.variant_error\s*\{[^}]*var\(--xc-danger\)/s);
        expect(timelineCss).toMatch(/\.rowError[^}]*var\(--xc-danger-fg\)/s);
        expect(inputCss).toMatch(/\.invalid:focus\s*\{[^}]*var\(--xc-danger-bg\)/s);
        expect(inputCss).not.toMatch(/\.invalid:focus\s*\{[^}]*rgba\(/s);
    });
});
