// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the Safety page says plainly when a panic-mode write was refused, and
// never claims a saved freeze. A duress-armed freeze stays silent.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
    activatePanicMode,
    clearPanicModeState,
    configurePanicModePersistence,
    isSigningFrozen,
    __resetPanicModePersistenceForTests,
    DEFAULT_DURATION_MS,
} from '../../../packages/core/src/flows/panicMode.js';
import { PanicModeRow } from '../../../packages/core/src/shared/components/settings/PanicModeRow.jsx';
import { PanicSaveNotice } from '../../../packages/core/src/shared/components/settings/PanicSaveNotice.jsx';

function store({ saved = null, refuseSave = false, refuseClear = false } = {}) {
    let value = saved;
    return {
        load: async () => value,
        save: async (s) => { if (refuseSave) throw new Error('QUOTA_BYTES quota exceeded'); value = s; },
        clear: async () => { if (refuseClear) throw new Error('write failed'); value = null; },
    };
}

function Page() {
    return (
        <div>
            <PanicSaveNotice />
            <PanicModeRow />
        </div>
    );
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

afterEach(() => {
    cleanup();
    clearPanicModeState();
    __resetPanicModePersistenceForTests();
});

describe('PanicSaveNotice', () => {
    it('says the freeze is on but not saved when the store refuses it', async () => {
        await configurePanicModePersistence(store({ refuseSave: true }));
        render(<Page />);

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-hour freeze' }));
        await settle();

        const notice = screen.getByTestId('panic-save-notice');
        expect(notice.textContent).toContain("Panic mode is on, but it couldn't be saved.");
        expect(notice.textContent).toContain('The freeze ends if the browser or app restarts');
        expect(screen.getByText('Panic mode is active')).toBeTruthy();
    });

    it('brings the notice into view, since the row that set it sits further down', async () => {
        const scrolled = vi.fn();
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = scrolled;
        try {
            await configurePanicModePersistence(store({ refuseSave: true }));
            render(<Page />);
            fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
            fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-hour freeze' }));
            await settle();
            expect(scrolled).toHaveBeenCalledTimes(1);
            expect(scrolled.mock.contexts[0].contains(screen.getByTestId('panic-save-notice'))).toBe(true);
        } finally {
            Element.prototype.scrollIntoView = original;
        }
    });

    it('shows nothing when the store takes the freeze', async () => {
        await configurePanicModePersistence(store());
        render(<Page />);
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-hour freeze' }));
        await settle();
        expect(screen.queryByTestId('panic-save-notice')).toBeNull();
    });

    it('keeps the freeze and says so when turning it off is refused', async () => {
        const now = Date.now();
        await configurePanicModePersistence(store({
            saved: { activatedAt: now, expiresAt: now + DEFAULT_DURATION_MS, durationMs: DEFAULT_DURATION_MS, armedBy: 'self' },
            refuseClear: true,
        }));
        render(<Page />);

        fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
        await settle();

        expect(isSigningFrozen()).toBe(true);
        expect(screen.getByTestId('panic-save-notice').textContent)
            .toContain("Panic mode couldn't be turned off.");
        expect(screen.getByText('Panic mode is active')).toBeTruthy();
    });

    it('stays silent about an unsaved duress-armed freeze', async () => {
        await configurePanicModePersistence(store({ refuseSave: true }));
        render(<PanicSaveNotice />);
        activatePanicMode({ armedBy: 'duress' });
        await settle();
        expect(isSigningFrozen()).toBe(true);
        expect(screen.queryByTestId('panic-save-notice')).toBeNull();
    });
});
