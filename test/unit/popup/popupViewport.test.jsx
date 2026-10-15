// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
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
    onboardingCarousel: 'packages/core/src/shared/routes/OnboardingCarousel.module.css',
    bottomBar: 'packages/core/src/shared/components/BottomTabBar.module.css',
    locked: 'packages/core/src/shared/routes/Locked.module.css',
    home: 'packages/core/src/shared/routes/Home.module.css',
    homeTabs: 'packages/core/src/shared/components/HomeTabs.module.css',
    hero: 'packages/core/src/shared/components/TotalBalanceHero.module.css',
};
const css = Object.fromEntries(Object.entries(cssFiles).map(([name, file]) => [
    name,
    readFileSync(join(root, file), 'utf8'),
]));
const popupApp = readFileSync(join(root, 'packages/extension/src/popup/App.jsx'), 'utf8');
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
    // The kit Button nests the icon in its own span, so read the label span
    // that is the button's own last child.
    const label = button.querySelector(':scope > span:last-child');
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
    it('keeps the license action visible below its scroll lane', () => {
        localStorage.clear();
        renderPopup(<Onboarding onCreate={() => {}} onImport={() => {}} />);

        expect(screen.getByRole('button', { name: 'Accept and continue' })).toBeVisible();
        expect(css.formPage).toMatch(
            /\.fill\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/s,
        );
        expect(css.formPage).toMatch(
            /\.fill > \.body\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
        );
        expect(css.formPage).toMatch(
            /\.fill > \.pageHeader,[\s\S]*?\.fill > \.actions\s*\{[^}]*flex:\s*0 0 auto;/,
        );
    });

    it('keeps Get started visible below the explainer scroll lane', () => {
        localStorage.removeItem('xc:onboardingExplainerSeenAt');
        renderPopup(<Onboarding onCreate={() => {}} onImport={() => {}} />);

        for (let step = 0; step < 3; step += 1) {
            fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        }
        expect(screen.getByRole('button', { name: 'Get started' })).toBeVisible();
        expect(css.onboardingCarousel).toMatch(
            /\.rootPopup\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/s,
        );
        expect(css.onboardingCarousel).toMatch(
            /\.frameViewport\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
        );
        expect(css.onboardingCarousel).toMatch(
            /\.nav\s*\{[^}]*flex:\s*0 0 auto;/s,
        );
    });

    it('keeps all five bottom navigation labels in the popup bar', () => {
        renderPopup(<BottomTabBar currentView="home" onSelect={() => {}} />);

        for (const label of ['Home', 'History', 'Send', 'Scan', 'More']) {
            expect(screen.getByRole('button', { name: label })).toBeVisible();
        }
        expect(css.bottomBar).toMatch(
            /\.bar\s*\{[^}]*min-height:\s*3\.5rem;/s,
        );
        expect(css.bottomBar).toMatch(
            /\.tabLabel\s*\{[^}]*display:\s*block;[^}]*flex:\s*0 0 auto;/s,
        );
    });

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
        expect(css.popup).toMatch(/html\.xchain-toolbar-popup\s*\{[^}]*width:\s*360px;[^}]*height:\s*600px;/);
        expect(css.popup).toMatch(/#xchain-popup-root\s*\{[\s\S]*?min-width:\s*0/);
        expect(css.screen).toMatch(/\.body\s*\{[\s\S]*?overflow-x:\s*hidden/);
        // Onboarding actions live in FormPage now, which owns their shrinkable column.
        expect(css.onboarding).not.toMatch(/\.actionsPopup/);
        expect(css.home).toMatch(/\.quickAction\s*\{[\s\S]*?min-width:\s*0/);
    });

    it('keeps banners inside the 600px shell and document scrolling disabled', () => {
        const appWrapper = popupApp.slice(
            popupApp.indexOf('export function App()'),
            popupApp.indexOf('function AppInner('),
        );

        expect(appWrapper).not.toContain('<ReachabilityBanner');
        expect(popupApp).toMatch(
            // The network and demo banners are gone by ruling; the reachability
            // notice is the only one left in the layout's notice slot, and a
            // demo wallet shows none.
            /notices=\{isDemoWallet\(activeWalletId\) \? null : <ReachabilityBanner\s*\/>\}/,
        );
        expect(css.popup).toMatch(
            /html\.xchain-toolbar-popup\s*\{[^}]*height:\s*600px;[^}]*overflow:\s*hidden;/,
        );
        expect(css.popup).toMatch(
            /body,\s*#xchain-popup-root\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/,
        );
    });

    it('keeps 360px action labels whole while a full row shrinks', () => {
        // A full row shrinks its buttons, never below a button's longest word;
        // a label wider than the whole column wraps inside the button instead
        // of spilling out.
        expect(css.button).toMatch(
            /\.btn\s*\{[^}]*flex-shrink:\s*1[^}]*min-width:\s*auto[^}]*white-space:\s*normal/s,
        );
        expect(css.button).not.toMatch(/\.label\s*\{[^}]*white-space:\s*nowrap/s);
    });
});
