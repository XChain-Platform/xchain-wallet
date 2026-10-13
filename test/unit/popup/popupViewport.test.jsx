// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

const root = process.cwd();
const cssFiles = {
    popup: 'packages/extension/src/popup/popup.css',
    screen: 'packages/core/src/ui/Screen.module.css',
    button: 'packages/core/src/ui/Button.module.css',
    formPage: 'packages/core/src/ui/FormPage.module.css',
    onboarding: 'packages/core/src/shared/routes/Onboarding.module.css',
    locked: 'packages/core/src/shared/routes/Locked.module.css',
    home: 'packages/core/src/shared/routes/Home.module.css',
    homeTabs: 'packages/core/src/shared/components/HomeTabs.module.css',
    hero: 'packages/core/src/shared/components/TotalBalanceHero.module.css',
};
const css = Object.fromEntries(Object.entries(cssFiles).map(([name, file]) => [
    name,
    readFileSync(join(root, file), 'utf8'),
]));
const originalViewport = { width: window.innerWidth, height: window.innerHeight };

const settings = createDefaultSettings();
settings.fees = { 'bitcoin-mainnet': {} };
const messaging = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    unlockWallet: vi.fn().mockResolvedValue({ unlocked: true }),
    listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Popup wallet' }]),
    listAccounts: vi.fn().mockResolvedValue([]),
    getWalletBalances: vi.fn().mockResolvedValue({}),
    getActiveAddresses: vi.fn().mockResolvedValue({}),
    listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]),
    listConfirmSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    getNativePricesRequest: vi.fn().mockResolvedValue({ prices: {} }),
};

function renderPopup(node) {
    window.innerWidth = 360;
    window.innerHeight = 600;
    return render(
        <MessagingContext.Provider value={{ shell: 'popup', messaging }}>
            {node}
        </MessagingContext.Provider>,
    );
}

function expectCompleteButtonLabel(name) {
    const button = screen.getByRole('button', { name, exact: true });
    const label = button.querySelector('span:last-child');
    expect(button).toBeVisible();
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent(name);
    expect(button).not.toHaveAttribute('title');
}

beforeEach(() => {
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
    localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    window.innerWidth = originalViewport.width;
    window.innerHeight = originalViewport.height;
});

describe('extension popup main screens at 360x600', () => {
    it('renders onboarding with every action label intact', () => {
        renderPopup(
            <Onboarding
                onCreate={() => {}}
                onImport={() => {}}
                onImportFromFreeWallet={() => {}}
                onPairPartner={() => {}}
                onDemoEntered={() => {}}
            />,
        );

        for (const label of [
            'Create new wallet',
            'Import wallet',
            'From FreeWallet',
            'Pair a watcher or signer',
            'Try in demo mode',
        ]) {
            expectCompleteButtonLabel(label);
        }
    });

    it('renders the locked screen with the primary action label intact', () => {
        renderPopup(<Locked onUnlocked={() => {}} />);

        expectCompleteButtonLabel('Unlock Wallet');
        expect(screen.getByLabelText('Password')).toBeVisible();
    });

    it('renders Home with popup quick actions and labels intact', async () => {
        renderPopup(
            <Home
                activeWalletId="wallet-1"
                onSend={() => {}}
                onReceive={() => {}}
                onSwap={() => {}}
                onExchange={() => {}}
                onOpenSettings={() => {}}
                onLockWallet={() => {}}
            />,
        );

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeVisible());
        for (const label of ['Send', 'Receive', 'Exchange', 'Swap']) {
            expectCompleteButtonLabel(label);
        }
    });

    it('keeps popup routes shrinkable with no fixed width beyond 360px', () => {
        const fixedWidthFaults = [];
        for (const [file, source] of Object.entries(css)) {
            for (const match of source.matchAll(/(^|[;{])\s*(width|min-width):\s*(\d+)px\s*;/gm)) {
                if (Number(match[3]) > 360) fixedWidthFaults.push(`${file}: ${match[2]} ${match[3]}px`);
            }
        }

        expect(fixedWidthFaults).toEqual([]);
        expect(css.popup).toMatch(/width:\s*min\(360px,\s*100vw\)/);
        expect(css.popup).toMatch(/#xchain-popup-root\s*\{[\s\S]*?min-width:\s*0/);
        expect(css.screen).toMatch(/\.body\s*\{[\s\S]*?overflow-x:\s*hidden/);
        expect(css.onboarding).toMatch(/\.actionsPopup\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?width:\s*100%/);
        expect(css.home).toMatch(/\.quickAction\s*\{[\s\S]*?min-width:\s*0/);
    });

    it('allows 360px action labels to wrap instead of clipping', () => {
        expect(css.button).toMatch(
            /@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.btn\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?\.label\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?overflow-wrap:\s*anywhere;/,
        );
    });
});
