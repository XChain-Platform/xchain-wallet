// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

function mount(props = {}) {
    const messaging = {
        getSettings: () => new Promise(() => {}),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Vault' }}
                {...props}
            />
        </MessagingContext.Provider>,
    );
}

function searchFor(value) {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), {
        target: { value },
    });
}

afterEach(cleanup);

describe('Settings search', () => {
    it.each([
        ['password', 'Backup'],
        ['lock', 'Safety'],
        ['backup', 'Backup'],
        ['network', 'Network'],
        ['currency', 'Language & region'],
        ['language', 'Language & region'],
        ['theme', 'Appearance'],
        ['biometric unlock', 'Safety'],
        ['lock wallet', 'Keyboard'],
        ['saved chain filters', 'Display'],
        ['quiet hours', 'Notifications'],
        ['localhost auto sign', 'Developer mode'],
        ['Primary Vault', 'This wallet'],
    ])('finds "%s" in %s', (query, sectionTitle) => {
        mount();
        searchFor(query);

        expect(screen.getByText(sectionTitle)).toBeTruthy();
        expect(screen.queryByText('About')).toBeNull();
    });

    it('opens a matching drilldown section', () => {
        mount();
        searchFor('password');

        fireEvent.click(screen.getByRole('button', { name: /Backup/ }));

        expect(screen.getByRole('heading', { name: 'Backup' })).toBeTruthy();
        expect(screen.getByText('Export encrypted backup')).toBeTruthy();
    });

    it('shows a plain empty state for no match and clearing restores the list', () => {
        mount();
        searchFor('no setting has these words');

        expect(screen.getByRole('status')).toHaveTextContent('No settings match "no setting has these words".');
        expect(screen.queryByText('Backup')).toBeNull();

        searchFor('');

        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByText('Backup')).toBeTruthy();
        expect(screen.getByText('About')).toBeTruthy();
    });

    it('shows the empty state when the only text match belongs to an unavailable row', () => {
        mount({ activeWallet: null, onOpenAccountPicker: undefined });
        searchFor('signer pairing');

        expect(screen.getByRole('status')).toHaveTextContent('No settings match "signer pairing".');
    });
});
