// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { DisplaySection } from '../../../packages/core/src/shared/components/settings/DisplaySection.jsx';
import { PrivacySection } from '../../../packages/core/src/shared/components/settings/PrivacySection.jsx';
import { NetworkSection } from '../../../packages/core/src/shared/components/settings/NetworkSection.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { resetShellCapabilities } from '../../../packages/core/src/shared/shellCapabilities.js';
import { userEvent } from '../../helpers/userEvent.js';

const FOCUSABLE = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[tabindex]',
].join(',');

function keyboardSettings() {
    return {
        activeNetwork: 'mainnet',
        developerMode: false,
        numberFormat: 'full',
        pinnedTokens: [],
        hiddenTokens: [],
        showPinAffordance: false,
        showHideAffordance: false,
        smallBalanceThreshold: 'dust',
        privacy: {
            hideSmallBalances: false,
            torRouting: false,
            changeAddressRotation: false,
            blurOnBlur: false,
            labelsSurviveRestore: false,
            hapticsEnabled: true,
            priceDataEnabled: true,
            metadataFetchEnabled: true,
            alwaysRequireHwExplicitConfirm: false,
            clipboardAutoClearSeconds: 30,
            formDraftTtlMs: 86_400_000,
        },
    };
}

function settingsHarness(initial = keyboardSettings(), overrides = {}) {
    let settings = structuredClone(initial);
    const messaging = {
        getSettings: vi.fn(async () => settings),
        updateSettings: vi.fn(async (patch) => {
            settings = {
                ...settings,
                ...patch,
                privacy: patch.privacy
                    ? { ...settings.privacy, ...patch.privacy }
                    : settings.privacy,
            };
            return settings;
        }),
        ...overrides,
    };
    return messaging;
}

function mount(ui, messaging) {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            {ui}
        </MessagingContext.Provider>,
    );
}

function tabbableElements() {
    return Array.from(document.querySelectorAll(FOCUSABLE)).filter((element) => (
        !element.disabled
        && !element.hidden
        && !element.closest('[inert]')
        && element.getAttribute('aria-hidden') !== 'true'
        && getComputedStyle(element).display !== 'none'
        && getComputedStyle(element).visibility !== 'hidden'
        && Number(element.getAttribute('tabindex') ?? 0) >= 0
    ));
}

async function expectTabOrder(expected) {
    const user = userEvent.setup();
    document.activeElement?.blur();
    expect(tabbableElements()).toEqual(expected);
    for (const control of expected) {
        await user.tab();
        expect(document.activeElement).toBe(control);
    }
}

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    resetShellCapabilities();
});

describe('Settings keyboard interaction', () => {
    it('tabs through every list control and restores each drilldown opener after Enter and Escape', async () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: vi.fn().mockResolvedValue([]),
            listContacts: vi.fn().mockResolvedValue([]),
        };
        mount(
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Vault' }}
            />,
            messaging,
        );

        await screen.findByText('0 contacts stored');
        const expected = [
            screen.getByRole('button', { name: 'Back to previous screen' }),
            screen.getByRole('searchbox', { name: 'Search settings' }),
            screen.getByRole('button', { name: /^This wallet/ }),
            screen.getByRole('button', { name: /^Display/ }),
            screen.getByRole('button', { name: /^Keyboard/ }),
            screen.getByRole('button', { name: /^Privacy/ }),
            screen.getByRole('button', { name: /^Safety/ }),
            screen.getByRole('button', { name: /^Wallet mode/ }),
            screen.getByRole('button', { name: /^Backup/ }),
            screen.getByRole('button', { name: /^Fees/ }),
            screen.getByRole('button', { name: /^Network & endpoints/ }),
            screen.getByRole('button', { name: /^Connected sites/ }),
            screen.getByRole('button', { name: 'Import…' }),
            screen.getByRole('button', { name: /^Automatic donation system/ }),
            screen.getByRole('button', { name: /^Developer mode/ }),
            screen.getByRole('button', { name: /^About/ }),
        ];
        await expectTabOrder(expected);

        const user = userEvent.setup();
        for (const name of ['Display', 'Privacy', 'Backup']) {
            const opener = screen.getByRole('button', { name: new RegExp(`^${name}`) });
            opener.focus();
            await user.keyboard('{Enter}');
            expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();

            await user.keyboard('{Escape}');
            await waitFor(() => expect(document.activeElement).toBe(
                screen.getByRole('button', { name: new RegExp(`^${name}`) }),
            ));
        }
    });

    it('tabs through every Display control and toggles each switch with Space', async () => {
        const messaging = settingsHarness();
        mount(<DisplaySection />, messaging);

        const switches = [
            await screen.findByRole('switch', { name: 'Hide small balances' }),
            screen.getByRole('switch', { name: 'Show pin button on rows' }),
            screen.getByRole('switch', { name: 'Show hide button on rows' }),
        ];
        await expectTabOrder([
            switches[0],
            screen.getByRole('combobox', { name: 'Small-balance threshold' }),
            screen.getByRole('combobox', { name: 'Balance number format' }),
            switches[1],
            switches[2],
            screen.getByRole('button', { name: 'Reset list preferences' }),
            screen.getByRole('button', { name: 'Reset to defaults' }),
        ]);

        const user = userEvent.setup();
        for (const toggle of switches) {
            toggle.focus();
            await user.keyboard('{Space}');
            await waitFor(() => expect(toggle).toBeChecked());
        }
        expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { hideSmallBalances: true } });
        expect(messaging.updateSettings).toHaveBeenCalledWith({ showPinAffordance: true });
        expect(messaging.updateSettings).toHaveBeenCalledWith({ showHideAffordance: true });
    });

    it('tabs through every Privacy control and toggles each available switch with Space', async () => {
        const messaging = settingsHarness();
        mount(<PrivacySection />, messaging);

        const tor = await screen.findByRole('switch', { name: 'Tor routing' });
        const switches = [
            screen.getByRole('switch', { name: 'Change-address rotation' }),
            screen.getByRole('switch', { name: 'Blur sensitive data on blur' }),
            screen.getByRole('switch', { name: 'Labels survive restore' }),
            screen.getByRole('switch', { name: 'Haptic feedback' }),
            screen.getByRole('switch', { name: 'Native coin price data' }),
            screen.getByRole('switch', { name: 'Fetch token metadata' }),
            screen.getByRole('switch', { name: 'Always require hardware cross-check confirm' }),
        ];
        expect(tor).toBeDisabled();
        await expectTabOrder([
            ...switches,
            screen.getByRole('spinbutton', { name: 'Clipboard auto-clear seconds' }),
            screen.getByRole('combobox', { name: 'Form draft retention' }),
        ]);

        const user = userEvent.setup();
        for (const toggle of switches) {
            const before = toggle.checked;
            toggle.focus();
            await user.keyboard('{Space}');
            await waitFor(() => expect(toggle.checked).toBe(!before));
        }
        expect(messaging.updateSettings).toHaveBeenCalledTimes(switches.length);
    });

    it('reaches the Network picker by Tab', async () => {
        const messaging = settingsHarness();
        mount(<NetworkSection activeWallet={{ id: 'wallet-1' }} />, messaging);

        await expectTabOrder([
            await screen.findByRole('combobox', { name: 'Active network' }),
        ]);
    });

    it('tabs through every Backup action', async () => {
        const messaging = { signerReady: vi.fn().mockResolvedValue({ ready: false }) };
        mount(
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Primary Vault' }} />,
            messaging,
        );

        await expectTabOrder([
            screen.getByRole('button', { name: 'Export…' }),
            screen.getByRole('button', { name: 'Show…' }),
            screen.getByRole('button', { name: 'Test…' }),
            screen.getByRole('button', { name: 'Publish now…' }),
            screen.getByRole('button', { name: 'Check…' }),
        ]);
    });
});
