// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Privacy row summary counts every switch the Privacy panel shows,
// including the ones that default on when the stored value is absent.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import {
    setShellCapabilities,
    resetShellCapabilities,
} from '../../../packages/core/src/shared/shellCapabilities.js';

let privacy = {};
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { privacy, autolockMinutes: 5, notifications: {} },
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
};

// The Privacy group page lists one row per switch with its own On or Off
// subtitle; this opens it and returns the rows as "TitleSubtitle" strings.
function summaryText() {
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Settings onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Privacy/ }));
    return Array.from(container.querySelectorAll('li')).map((li) => li.textContent).join('|');
}

afterEach(() => {
    cleanup();
    resetShellCapabilities();
});

describe('Privacy row summary', () => {
    it('counts the default-on switches when nothing is stored for them', () => {
        privacy = {
            torRouting: false,
            changeAddressRotation: false,
            hideSmallBalances: false,
            blurOnBlur: false,
            labelsSurviveRestore: false,
        };
        const rows = summaryText();
        expect(rows).toContain('Coin price dataOn');
        expect(rows).toContain('Token metadataOn');
        expect(rows).toContain('Haptic feedbackOn');
        expect(rows).toContain('Change-address rotationOff');
        expect(rows).toContain('Labels survive restoreOff');
        expect(rows).toContain('Blur when the window loses focusOff');
        expect(rows).toContain('Hardware cross-checkOff');
    });

    it('drops a default-on switch once it is stored false', () => {
        privacy = { hapticsEnabled: false, priceDataEnabled: false, metadataFetchEnabled: false };
        const rows = summaryText();
        expect(rows).toContain('Coin price dataOff');
        expect(rows).toContain('Token metadataOff');
        expect(rows).toContain('Haptic feedbackOff');
    });

    it('reads the stored on state of the switches that default off', () => {
        privacy = { alwaysRequireHwExplicitConfirm: true, changeAddressRotation: true };
        const rows = summaryText();
        expect(rows).toContain('Hardware cross-checkAlways required');
        expect(rows).toContain('Change-address rotationOn');
    });

    it('reports Tor routing only where the shell can proxy', () => {
        privacy = { torRouting: true };
        expect(summaryText()).toContain('Tor routingNot available here');
        cleanup();
        setShellCapabilities({ socksProxy: true });
        expect(summaryText()).toContain('Tor routingOn');
    });
});
