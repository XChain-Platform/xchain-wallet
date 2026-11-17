// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Panic mode confirm page (G104, G120): a freeze notice at the top and one
// "Confirm 24-Hour Freeze" button. No Cancel; Back is the way out and never
// freezes.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const activatePanicMode = vi.fn(() => ({ active: true }));

vi.mock('../../../packages/core/src/flows/panicMode.js', async (importOriginal) => ({
    ...(await importOriginal()),
    activatePanicMode: (...args) => activatePanicMode(...args),
    getPanicRemainingMs: () => 0,
}));
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: createDefaultSettings(), loading: false, error: null, update: vi.fn() }),
}));

const { PanicModePage } = await import('../../../packages/core/src/shared/components/settings/SecurityPages.jsx');
const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');

beforeEach(() => {
    activatePanicMode.mockClear();
    window.localStorage.clear();
});
afterEach(cleanup);

describe('Panic mode confirm page', () => {
    it('is a notice and one Confirm 24-Hour Freeze button, with no Cancel', () => {
        const { container } = render(<PanicModePage onDone={() => {}} />);
        const notice = screen.getByTestId('panic-freeze-notice');
        expect(notice.textContent).toContain('Everything freezes for 24 hours');
        expect(notice.querySelector('svg')).not.toBeNull();
        const buttons = container.querySelectorAll('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toBe('Confirm 24-Hour Freeze');
        expect(buttons[0].querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        // The notice comes before the button.
        expect(notice.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(activatePanicMode).not.toHaveBeenCalled();
    });

    it('freezes and returns when Confirm is pressed', () => {
        const onDone = vi.fn();
        render(<PanicModePage onDone={onDone} />);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-Hour Freeze' }));
        expect(activatePanicMode).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('Back leaves the page without freezing', () => {
        render(
            <MessagingContext.Provider value={{ shell: 'popup', messaging: new Proxy({}, { get: () => vi.fn(() => new Promise(() => {})) }) }}>
                <Settings
                    onBack={() => {}}
                    activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                    activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                    onOpenWalletPicker={() => {}}
                    onOpenAccountPicker={() => {}}
                    initialSubpageId="security-panic"
                    reload={() => {}}
                />
            </MessagingContext.Provider>,
        );
        expect(screen.getByRole('button', { name: 'Confirm 24-Hour Freeze' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(screen.queryByRole('button', { name: 'Confirm 24-Hour Freeze' })).toBeNull();
        expect(activatePanicMode).not.toHaveBeenCalled();
    });
});
