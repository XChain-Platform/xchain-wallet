// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The other half: nothing OFFERS the DEX when the build has none.
//
// `storeSurfaces.test.js` proves the route components are out of the bundle.
// That is not the same as proving a user (or an app reviewer) sees no way in,
// and the two can come apart in a specific way worth testing for: the labels
// still exist in the store bundle, because they sit in arrays inside shared
// modules that every build carries. What must be true is that NOTHING RENDERS
// them, so these tests render the real components in the state a store build
// puts them in.
//
// Rendered rather than asserted on source, because the failure this guards is a
// visible control, and because the fix it pins is specifically about how an
// absent handler renders: these surfaces used to draw a DISABLED button. A
// greyed-out "Decentralized Exchange" asks App Review exactly the question a
// working one does, and answers it worse - it says the app has an exchange and
// is hiding it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MenuRoute } from '../../../packages/core/src/shared/routes/MenuRoute.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';

const messaging = { getSettings: async () => ({ schemaVersion: 1, activeNetwork: 'mainnet' }) };

function draw(node) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>,
    );
}

afterEach(cleanup);

describe('the main menu', () => {
    it('offers the DEX rows when the shell wires them', () => {
        draw(<MenuRoute onBack={() => {}} onMarkets={() => {}} onMarketActivity={() => {}} />);
        expect(screen.queryByText('Decentralized Exchange')).toBeTruthy();
        expect(screen.queryByText('Marketplace')).toBeTruthy();
    });

    it('renders neither row when it does not', () => {
        // The store build passes no handler, because the destination is not in
        // the bundle. MenuRoute has always filtered on handler presence; this
        // pins that, since it is now load-bearing rather than tidy.
        draw(<MenuRoute onBack={() => {}} onTokens={() => {}} />);
        expect(screen.queryByText('Decentralized Exchange')).toBeNull();
        expect(screen.queryByText('Marketplace')).toBeNull();
    });
});

describe('the sidebar', () => {
    it('shows a DEX tab by default', () => {
        draw(<LeftNav currentView="home" onSelect={() => {}} />);
        expect(screen.queryByText('DEX')).toBeTruthy();
    });

    it('shows no DEX tab, disabled or otherwise, when the surface is absent', () => {
        draw(<LeftNav currentView="home" onSelect={() => {}} hasDexSurface={false} />);
        expect(screen.queryByText('DEX')).toBeNull();
        // The rest of the nav is untouched: this hides one surface, not a shell.
        expect(screen.queryByText('Home')).toBeTruthy();
        expect(screen.queryByText('Dispensers')).toBeTruthy();
    });
});

describe('the command palette', () => {
    const ids = (ctx) => buildCommands({ navigate: () => {}, ...ctx }).map((c) => c.id);

    it('carries the DEX and trade commands by default', () => {
        const list = ids({});
        for (const id of ['nav-markets', 'nav-my-orders', 'nav-my-swaps', 'trade-swap', 'trade-order', 'trade-xchain-swap']) {
            expect(list).toContain(id);
        }
    });

    it('drops exactly those when the surface is absent', () => {
        const list = ids({ hasDexSurface: false });
        for (const id of ['nav-markets', 'nav-my-orders', 'nav-my-swaps', 'trade-swap', 'trade-order', 'trade-xchain-swap']) {
            expect(list).not.toContain(id);
        }
        // Settling a match that already happened is a payment the user owes, not
        // a trade, and one seed spans shells: it stays on every build.
        expect(list).toContain('trade-coinpay');
        expect(list).toContain('nav-obligations');
        expect(list).toContain('trade-xchain-templates');
    });

    it('keeps the DEX when a shell says nothing, rather than losing it silently', () => {
        // Every shell but a surface-stripped store build passes no flag at all.
        expect(ids({ hasDexSurface: undefined })).toContain('nav-markets');
    });
});

// The same failure one level down. Home's quick-action row hides
// Exchange on a store build, but kept its "More" button, whose only entry is
// the DEX-gated Swap. The button survived into a build with nothing behind it,
// so tapping it opened a menu whose single row read "No additional actions".
describe("Home's quick-action overflow menu", () => {
    const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
    const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };

    function homeMessaging() {
        return {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ schemaVersion: 1, activeNetwork: 'regtest' }),
        };
    }

    function drawHome(props) {
        return render(
            <MessagingProvider shell="web" messaging={homeMessaging()}>
                <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} {...props} />
            </MessagingProvider>,
        );
    }

    // Scoped to the quick-action row itself: Home carries other "Send" and
    // "More" affordances, and an unscoped query answers about the wrong one.
    const quickActions = () => screen.findByRole('group', { name: 'Quick actions' });

    it('offers More, and Swap inside it, when the shell wires Swap', async () => {
        const onSwap = vi.fn();
        drawHome({ onSend: () => {}, onReceive: () => {}, onSwap });

        const row = within(await quickActions());
        fireEvent.click(row.getByRole('button', { name: /More/ }));
        fireEvent.click(row.getByRole('menuitem', { name: /Swap/ }));
        expect(onSwap).toHaveBeenCalledTimes(1);
    });

    it('renders no More button at all when nothing is behind it', async () => {
        // The store build wires no Swap handler, because SwapForm is not in
        // the bundle. Absent beats disabled and both beat an empty menu: a
        // control that opens onto "No additional actions" is a dead affordance
        // sitting in the quick-action row on the wallet's primary screen.
        drawHome({ onSend: () => {}, onReceive: () => {} });

        const row = within(await quickActions());
        // Send and Receive prove the row itself rendered, so a missing More is
        // evidence rather than an unrendered quick-action row.
        expect(row.getByRole('button', { name: /Send/ })).toBeTruthy();
        expect(row.getByRole('button', { name: /Receive/ })).toBeTruthy();
        expect(row.queryByRole('button', { name: /More/ })).toBeNull();
        expect(screen.queryByText('No additional actions')).toBeNull();
    });
});
