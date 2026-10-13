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
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DisplaySection } from '../../../packages/core/src/shared/components/settings/DisplaySection.jsx';
import { PrivacySection } from '../../../packages/core/src/shared/components/settings/PrivacySection.jsx';
import { BalanceList } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { useSettings } from '../../../packages/core/src/shared/hooks/useSettings.js';
import {
    resetShellCapabilities,
    setShellCapabilities,
} from '../../../packages/core/src/shared/shellCapabilities.js';

const LIST_ROWS = [
    {
        chainId: 'bitcoin-mainnet',
        tick: 'BTC',
        kind: 'native',
        displayName: 'Bitcoin',
        quantity: '250000',
        divisibility: 8,
        fiatRate: null,
    },
    {
        chainId: 'litecoin-mainnet',
        tick: 'LTC',
        kind: 'native',
        displayName: 'Litecoin',
        quantity: '0',
        divisibility: 8,
        fiatRate: null,
    },
];

function initialSettings() {
    return {
        language: 'en',
        theme: 'system',
        reducedMotion: 'auto',
        learnMode: false,
        privacy: {
            torRouting: false,
            changeAddressRotation: false,
            hideSmallBalances: false,
            blurOnBlur: false,
            labelsSurviveRestore: false,
            hapticsEnabled: true,
            priceDataEnabled: true,
            metadataFetchEnabled: true,
            alwaysRequireHwExplicitConfirm: false,
            formDraftTtlMs: 86_400_000,
        },
    };
}

function messagingHarness() {
    let settings = initialSettings();
    return {
        getSettings: vi.fn(async () => settings),
        updateSettings: vi.fn(async (patch) => {
            settings = {
                ...settings,
                ...patch,
                privacy: {
                    ...settings.privacy,
                    ...(patch.privacy || {}),
                },
            };
            return settings;
        }),
    };
}

function LivePrivacyView() {
    const { settings, loading } = useSettings();
    if (loading || !settings) return null;
    return (
        <>
            <PrivacySection />
            {/* Hide small balances moved to the Display panel; it still persists privacy.hideSmallBalances. */}
            <DisplaySection />
            <BalanceList
                rows={LIST_ROWS}
                hideSmallBalances={settings.privacy.hideSmallBalances === true}
            />
        </>
    );
}

function renderPrivacy(messaging = messagingHarness()) {
    return {
        messaging,
        ...render(
            <MessagingProvider shell="web" messaging={messaging}>
                <LivePrivacyView />
            </MessagingProvider>,
        ),
    };
}

afterEach(() => {
    cleanup();
    resetShellCapabilities();
    document.documentElement.removeAttribute('data-xc-privacy-blur');
    vi.restoreAllMocks();
});

describe('Privacy settings live behavior', () => {
    it('collapses small balances as soon as the setting is toggled', async () => {
        const { messaging } = renderPrivacy();
        const toggle = await screen.findByRole('switch', { name: 'Hide small balances' });
        expect(screen.getByText('Litecoin')).toBeTruthy();

        fireEvent.click(toggle);

        await waitFor(() => {
            expect(toggle.checked).toBe(true);
            expect(screen.queryByText('Litecoin')).toBeNull();
            expect(screen.getByText('Show 1 small balance')).toBeTruthy();
        });
        expect(messaging.updateSettings).toHaveBeenCalledWith({
            privacy: { hideSmallBalances: true },
        });
    });

    it('enables and disables the visible blur without a reload', async () => {
        const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        renderPrivacy();
        const toggle = await screen.findByRole('switch', { name: 'Blur sensitive data on blur' });

        act(() => { window.dispatchEvent(new Event('blur')); });
        expect(document.documentElement.hasAttribute('data-xc-privacy-blur')).toBe(false);

        fireEvent.click(toggle);
        await waitFor(() => expect(toggle.checked).toBe(true));

        hasFocus.mockReturnValue(false);
        act(() => { window.dispatchEvent(new Event('blur')); });
        await waitFor(() => {
            expect(document.documentElement.getAttribute('data-xc-privacy-blur')).toBe('true');
        });

        fireEvent.click(toggle);
        await waitFor(() => {
            expect(toggle.checked).toBe(false);
            expect(document.documentElement.hasAttribute('data-xc-privacy-blur')).toBe(false);
        });
    });
});

describe('Privacy setting hints', () => {
    it('states each consumer boundary in the rendered copy', async () => {
        renderPrivacy();
        await screen.findByRole('switch', { name: 'Hide small balances' });

        expect(screen.getByText(/Imported-key and watch-only sends keep the spending address/)).toBeTruthy();
        expect(screen.getByText(/Collapse balances below the selected threshold into an expandable section/)).toBeTruthy();
        expect(screen.getByText(/Blur the entire wallet display/)).toBeTruthy();
        expect(screen.getByText(/batch label and contact edits/)).toBeTruthy();
        expect(screen.getByText(/OS or in-app reduced-motion settings suppress haptics/)).toBeTruthy();
        expect(screen.getByText(/explorer-backed on-chain oracle rates can still appear/)).toBeTruthy();
        expect(screen.getByText(/without TIS or remote-media requests/)).toBeTruthy();
        expect(screen.getByText(/large amounts, first-time recipients, and multisig signs/)).toBeTruthy();
        expect(screen.getByText(/Not available on this platform or shell/)).toBeTruthy();
    });

    it('identifies Tor as desktop-only when wallet-only proxying is available', async () => {
        setShellCapabilities({ socksProxy: true });
        renderPrivacy();

        const toggle = await screen.findByRole('switch', { name: 'Tor routing' });
        expect(toggle.disabled).toBe(false);
        expect(screen.getByText(/Desktop only/)).toBeTruthy();
        expect(screen.getByText(/requests fail rather than quietly going direct/)).toBeTruthy();
    });
});
