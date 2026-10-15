// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings and its sections open at the top. The shell keeps each route's
// scroll offset, and reopening Settings used to land part way down the list.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { Screen, ScrollRestoration } from '../../../packages/core/src/ui/Screen.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { resetShellCapabilities } from '../../../packages/core/src/shared/shellCapabilities.js';

const messaging = {
    getSettings: () => new Promise(() => {}),
    listConnectedSites: vi.fn().mockResolvedValue([]),
    listContacts: vi.fn().mockResolvedValue([]),
};

function Shell({ route }) {
    return (
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <ScrollRestoration routeKey={route}>
                {route === 'settings'
                    ? <Settings onBack={() => {}} activeWallet={{ id: 'wallet-1', name: 'Primary Vault' }} />
                    : <Screen><div>{route}</div></Screen>}
            </ScrollRestoration>
        </MessagingContext.Provider>
    );
}

const main = () => document.getElementById('xc-main');

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    resetShellCapabilities();
});

describe('Settings scroll position', () => {
    it('opens the list at the top after it was scrolled and left', async () => {
        const view = render(<Shell route="settings" />);
        await screen.findByRole('button', { name: /^Privacy/ });
        expect(main().scrollTop).toBe(0);
        main().scrollTop = 822;
        fireEvent.scroll(main());

        view.rerender(<Shell route="home" />);
        main().scrollTop = 140;
        fireEvent.scroll(main());
        view.rerender(<Shell route="settings" />);
        await screen.findByRole('button', { name: /^Privacy/ });

        expect(main().scrollTop).toBe(0);
    });

    it('opens a section at the top and returns to the list offset and row on close', async () => {
        render(<Shell route="settings" />);
        const opener = await screen.findByRole('button', { name: /^Privacy/ });
        main().scrollTop = 600;
        fireEvent.scroll(main());

        fireEvent.click(opener);
        expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
        expect(main().scrollTop).toBe(0);

        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        await waitFor(() => expect(document.activeElement).toBe(
            screen.getByRole('button', { name: /^Privacy/ }),
        ));
        expect(main().scrollTop).toBe(600);
    });
});
