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
import { render, cleanup } from '@testing-library/react';
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

function summaryText() {
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Settings onBack={() => {}} />
        </MessagingProvider>,
    );
    return container.textContent;
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
        expect(summaryText()).toContain('3 of 7 on');
    });

    it('drops a default-on switch once it is stored false', () => {
        privacy = { hapticsEnabled: false, priceDataEnabled: false, metadataFetchEnabled: false };
        expect(summaryText()).toContain('0 of 7 on');
    });

    it('counts the switches beyond the first five', () => {
        privacy = { alwaysRequireHwExplicitConfirm: true, changeAddressRotation: true };
        expect(summaryText()).toContain('5 of 7 on');
    });

    it('adds Tor routing to the total only where the shell can proxy', () => {
        setShellCapabilities({ socksProxy: true });
        privacy = { torRouting: true };
        expect(summaryText()).toContain('4 of 8 on');
    });
});
