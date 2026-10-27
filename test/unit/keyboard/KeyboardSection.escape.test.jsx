// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings → Keyboard by keyboard alone: Escape cancels a rebind in progress
// instead of closing the sub-page behind it, and every Rebind button names
// the shortcut it changes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { KeyboardSection } from '../../../packages/core/src/shared/components/settings/KeyboardSection.jsx';
import { useBackHandler } from '../../../packages/core/src/ui/backStack.js';

afterEach(() => cleanup());

function Page({ onPageClose }) {
    // The sub-page's own Back action, registered before the section's.
    useBackHandler(onPageClose, false, 'screen');
    return <KeyboardSection />;
}

async function setup(onPageClose) {
    const messaging = {
        getSettings: vi.fn(() => Promise.resolve({ keyboard: { bindings: {} } })),
        updateSettings: vi.fn((patch) => Promise.resolve(patch)),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Page onPageClose={onPageClose} />
        </MessagingProvider>,
    );
    await waitFor(() => expect(screen.getByText('Lock wallet')).toBeTruthy());
}

describe('KeyboardSection keyboard use', () => {
    it('cancels a rebind on Escape before the sub-page closes', async () => {
        const onPageClose = vi.fn();
        await setup(onPageClose);
        const rebind = within(screen.getByText('Lock wallet').closest('div')).getByRole('button', { name: 'Rebind' });
        rebind.focus();
        fireEvent.click(rebind);
        expect(screen.getByText('Press keys…')).toBeTruthy();

        fireEvent.keyDown(rebind, { key: 'Escape' });
        expect(screen.queryByText('Press keys…')).toBeNull();
        expect(onPageClose).not.toHaveBeenCalled();
        expect(rebind, 'focus stays on the button').toHaveFocus();

        fireEvent.keyDown(rebind, { key: 'Escape' });
        expect(onPageClose, 'a second Escape closes the sub-page').toHaveBeenCalledTimes(1);
    });

    it('describes each Rebind button by the shortcut it changes', async () => {
        await setup(vi.fn());
        const lockRow = screen.getByText('Lock wallet').closest('div');
        const rebind = within(lockRow).getByRole('button', { name: 'Rebind' });
        expect(rebind).toHaveAccessibleDescription('Lock wallet');
    });
});
