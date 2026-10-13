// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings must render while the async settings read is still pending
// (settings === null). Regression: the Network section dereferenced
// settings.developerMode unguarded, crashing every mount that rendered
// before getSettings resolved; the palette's Settings deep-link
// was the first flow to drive it.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

describe('Settings while settings are loading', () => {
    it('renders the section list with a never-resolving getSettings', () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.getByText('Backup')).toBeTruthy();
        expect(screen.getByText('Keyboard')).toBeTruthy();
        expect(screen.getByText('Network')).toBeTruthy();
        expect(document.body.textContent).not.toContain('raw PSBT inspector');
    });

    it('shows the active account and opens its account picker', () => {
        const onOpenAccountPicker = vi.fn();
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings
                    onBack={() => {}}
                    activeWallet={{ id: 'wallet-1', name: 'Main wallet' }}
                    activeAccount={{ id: 'account-2', index: 1, name: 'Savings' }}
                    onOpenAccountPicker={onOpenAccountPicker}
                />
            </MessagingProvider>,
        );

        expect(screen.getByText('Savings')).toBeTruthy();
        fireEvent.click(screen.getByText('Accounts & Addresses').closest('button'));
        expect(onOpenAccountPicker).toHaveBeenCalledOnce();
    });
});
