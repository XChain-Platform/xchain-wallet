// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The system Back gesture closes the topmost overlay (a dialog, a popover,
// the More sheet) before it navigates or leaves the app. With only screens
// registered, Back on Home with the header settings popover open closed the
// whole app on an LG K51.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });
const armed = () => Boolean(window.history.state && window.history.state.xcBack);
async function pressBack() {
    window.history.back();
    await settle();
}

beforeEach(() => {
    resetBackStackForTests();
    window.history.replaceState(null, '');
});

afterEach(async () => {
    cleanup();
    await settle();
    resetBackStackForTests();
    vi.restoreAllMocks();
});

describe('Back closes overlays first', () => {
    it('cancels an open confirm dialog instead of leaving the screen', async () => {
        const onBack = vi.fn();
        const onCancel = vi.fn();
        render(
            <>
                <PageHeader title="Send" onBack={onBack} />
                <ConfirmModal title="Discard?" message="Leave this form?" onConfirm={() => {}} onCancel={onCancel} />
            </>,
        );
        await settle();
        expect(armed()).toBe(true);
        await pressBack();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('closes a notice on a screen with no back action, so Back does not leave the app', async () => {
        const onClose = vi.fn();
        render(<NoticeModal title="Heads up" message="Something happened." onClose={onClose} />);
        await settle();
        expect(armed()).toBe(true);
        await pressBack();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes the More sheet, then lets the next Back reach the screen', async () => {
        const onBack = vi.fn();
        render(
            <>
                <PageHeader title="Receive" onBack={onBack} />
                <BottomTabBar currentView="receive" onSelect={() => {}} onLock={() => {}} />
            </>,
        );
        await settle();
        const more = screen.getByRole('button', { name: /More/ });
        fireEvent.click(more);
        await settle();
        expect(more.getAttribute('aria-expanded')).toBe('true');
        await pressBack();
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(more).toHaveFocus();
        expect(onBack).not.toHaveBeenCalled();
        await pressBack();
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
