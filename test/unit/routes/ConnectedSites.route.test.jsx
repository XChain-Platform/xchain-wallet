// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Connected Sites as a top-level route.
//
// The route is a header plus the shared ConnectedSitesSection. What
// matters is that it mounts the SECTION (so the standalone screen and
// the Settings drilldown can't drift), carries its own title, and hands
// back to whatever the shell passed - it does not assume Settings is
// underneath it.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ConnectedSites } from '../../../packages/core/src/shared/routes/ConnectedSites.jsx';

function mount(overrides = {}, onBack = () => {}) {
    const messaging = {
        getSettings: () => Promise.resolve({}),
        listConnectedSites: () => Promise.resolve([]),
        ...overrides,
    };
    return render(
        <MessagingProvider shell="extension" messaging={messaging}>
            <ConnectedSites onBack={onBack} />
        </MessagingProvider>,
    );
}

describe('ConnectedSites standalone route', () => {
    it('renders its own header rather than a Settings sub-page', async () => {
        mount();
        expect(screen.getByText('Connected Sites')).toBeTruthy();
        // The Settings drilldown labels its back control "Back to settings".
        // A top-level route must not, or the popup promises a Settings screen
        // that back never lands on.
        await waitFor(() => {
            expect(screen.queryByLabelText('Back to settings')).toBeNull();
        });
    });

    it('mounts the shared section body, listing connected sites', async () => {
        mount({
            listConnectedSites: () => Promise.resolve([
                { id: 's1', origin: 'https://dapp.example', appName: 'Example dApp' },
            ]),
        });
        await waitFor(() => {
            expect(screen.getByText('Example dApp')).toBeTruthy();
        });
        expect(screen.getByText('https://dapp.example')).toBeTruthy();
    });

    it('calls the shell back handler, which need not return to Settings', async () => {
        const onBack = vi.fn();
        mount({}, onBack);
        const back = screen.getAllByRole('button').find(
            (b) => /back/i.test(b.getAttribute('aria-label') || ''),
        );
        expect(back).toBeTruthy();
        fireEvent.click(back);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('survives a messaging layer with no listConnectedSites route', async () => {
        // Shells wire routes incrementally; an absent route must render an
        // empty screen, not throw inside the popup.
        mount({ listConnectedSites: undefined });
        expect(screen.getByText('Connected Sites')).toBeTruthy();
    });
});
