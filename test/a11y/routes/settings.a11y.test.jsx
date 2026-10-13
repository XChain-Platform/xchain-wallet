// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const SETTINGS = createDefaultSettings();
const DRILLDOWN_SECTIONS = [
    ['this-wallet', 'This wallet'],
    ['display', 'Display'],
    ['keyboard', 'Keyboard'],
    ['privacy', 'Privacy'],
    ['safety', 'Safety'],
    ['wallet-mode', 'Wallet mode'],
    ['backup', 'Backup'],
    ['fees', 'Fees'],
    ['network-endpoints', 'Network & endpoints'],
    ['connected-sites', 'Connected sites'],
    ['ads', 'Automatic donation system'],
    ['developer', 'Developer mode'],
    ['about', 'About'],
];

function pending() {
    return new Promise(() => {});
}

function settingsMessaging() {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function renderSettings(props = {}) {
    return render(
        <MessagingContext.Provider value={{ shell: 'web', messaging: settingsMessaging() }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
                {...props}
            />
        </MessagingContext.Provider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Settings route accessibility', () => {
    it('scans the section registry', async () => {
        const { container } = renderSettings();
        await screen.findByRole('heading', { name: 'Settings' });
        await screen.findByText('Primary Wallet');
        await expectNoSeriousAxeViolations(container);
    });

    it.each(DRILLDOWN_SECTIONS)('scans the %s section', async (sectionId, title) => {
        const { container } = renderSettings({ initialSubpageId: sectionId });
        await screen.findByRole('heading', { name: title });
        await expectNoSeriousAxeViolations(container);
    });
});
