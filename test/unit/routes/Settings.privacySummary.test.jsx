// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The privacy switches sit on their group rows (2026-11-13) and read the
// stored state, including the switches that default on when nothing is
// stored for them. Haptic feedback lives on Appearance, Labels survive
// restore on Backup and Recovery and Hardware cross-check on Security; each
// still writes its settings.privacy key.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import {
    setShellCapabilities,
    resetShellCapabilities,
} from '../../../packages/core/src/shared/shellCapabilities.js';

let privacy = {};
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { privacy, autolockMinutes: 5, notifications: {}, grace: { testSendThresholdSats: '0' } },
        loading: false,
        error: null,
        update: async () => {},
    }),
}));

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');
const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');

const messaging = {
    getSettings: () => new Promise(() => {}),
    listConnectedSites: () => Promise.resolve([]),
    listContacts: () => Promise.resolve([]),
};

// Opens one group page from the menu.
function openGroup(name) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Settings onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

const on = (name) => screen.getByRole('switch', { name }).checked;

afterEach(() => {
    cleanup();
    resetShellCapabilities();
});

describe('privacy switches on their group rows', () => {
    it('shows the default-on switches on when nothing is stored for them', () => {
        privacy = {
            torRouting: false,
            changeAddressRotation: false,
            hideSmallBalances: false,
            blurOnBlur: false,
            labelsSurviveRestore: false,
        };
        openGroup('Privacy and Sites');
        expect(on('Coin price data')).toBe(true);
        expect(on('Token metadata')).toBe(true);
        expect(on('Change-address rotation')).toBe(false);
        expect(on('Blur when the window loses focus')).toBe(false);
        cleanup();
        openGroup('Appearance');
        expect(on('Haptic feedback')).toBe(true);
        cleanup();
        openGroup('Backup and Recovery');
        expect(on('Labels survive restore')).toBe(false);
        cleanup();
        openGroup('Security');
        expect(on('Hardware cross-check')).toBe(false);
    });

    it('turns a default-on switch off once it is stored false', () => {
        privacy = { hapticsEnabled: false, priceDataEnabled: false, metadataFetchEnabled: false };
        openGroup('Privacy and Sites');
        expect(on('Coin price data')).toBe(false);
        expect(on('Token metadata')).toBe(false);
        cleanup();
        openGroup('Appearance');
        expect(on('Haptic feedback')).toBe(false);
    });

    it('reads the stored on state of the switches that default off', () => {
        privacy = { alwaysRequireHwExplicitConfirm: true, changeAddressRotation: true, labelsSurviveRestore: true };
        openGroup('Privacy and Sites');
        expect(on('Change-address rotation')).toBe(true);
        cleanup();
        openGroup('Security');
        expect(on('Hardware cross-check')).toBe(true);
        cleanup();
        openGroup('Backup and Recovery');
        expect(on('Labels survive restore')).toBe(true);
    });

    it('offers Tor routing only where the shell can proxy', () => {
        privacy = { torRouting: true };
        openGroup('Privacy and Sites');
        const unavailable = screen.getByRole('switch', { name: 'Tor routing' });
        expect(unavailable.checked).toBe(false);
        expect(unavailable.disabled).toBe(true);
        expect(screen.getByText('Desktop app only, not available here')).toBeTruthy();
        cleanup();
        setShellCapabilities({ socksProxy: true });
        openGroup('Privacy and Sites');
        const live = screen.getByRole('switch', { name: 'Tor routing' });
        expect(live.checked).toBe(true);
        expect(live.disabled).toBe(false);
    });
});
