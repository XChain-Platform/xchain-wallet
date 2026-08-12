// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The DEX surface: every exchange screen the web shell can route to
// (; the surface list and the reasoning behind its edges live in
// `registry.js`).
//
// This module exists to be REPLACED. `vite.config.js` aliases it to
// `dex.hidden.jsx` in a build whose profile hides `dex`, and that twin imports
// nothing, so MarketsList, MarketView, SwapForm, CreateOrderForm, MyOrdersView,
// MySwapsView, CrossChainSwapForm and MarketActivity never enter the bundle at
// all. The alternative - a boolean the app checks - leaves the code in the
// artifact and relies on a bundler happening to shake it out, which is not
// something a signed manifest can claim (§2.3).
//
// Consequences of that choice, both deliberate:
//   - This is the ONLY module allowed to import a DEX route component. A
//     second importer would keep the code in the store bundle no matter what
//     the alias does, so a smoke asserts this file is the only one.
//   - Every export here must exist in the twin with the same shape. The twin
//     is what a store build actually runs, so a name added on one side only is
//     an undefined at runtime, on the shell with the least test coverage.

import { MarketsList } from '@xchain-wallet/core/shared/routes/MarketsList.jsx';
import { MarketView } from '@xchain-wallet/core/shared/routes/MarketView.jsx';
import { MarketActivity } from '@xchain-wallet/core/shared/routes/MarketActivity.jsx';
import { CreateOrderForm } from '@xchain-wallet/core/shared/routes/CreateOrderForm.jsx';
import { MyOrdersView } from '@xchain-wallet/core/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '@xchain-wallet/core/shared/routes/MySwapsView.jsx';
import { SwapForm } from '@xchain-wallet/core/shared/routes/SwapForm.jsx';
import { CrossChainSwapForm } from '@xchain-wallet/core/shared/routes/CrossChainSwapForm.jsx';
import { ReceivePicker } from '@xchain-wallet/core/shared/routes/ReceivePicker.jsx';

/**
 * Whether this build carries the DEX surface. `false` in the twin.
 *
 * The shell reads it to decide whether to WIRE a handler at all, which is what
 * makes the entry points disappear: MenuRoute, the actions menu and the
 * command palette all render an entry only when its handler exists.
 */
export const DEX_SURFACE_ENABLED = true;

/**
 * Render the DEX view named by `unlockedView`, or null when it is not one.
 *
 * Called once from the web shell's route chain, in place of the nine
 * `if (unlockedView === …)` blocks that used to sit there. Order inside the
 * chain does not matter: view names are unique, and an unmatched view falls
 * through to Home, which is also what a store build does with a `markets` view
 * restored from a previous session (`RESUMABLE_VIEWS` still lists it).
 *
 * @param {string} unlockedView
 * @param {{
 *   activeWalletId: string | null,
 *   activeAccountId?: string | null,
 *   marketsAsset: any,
 *   setMarketsAsset: (a: any) => void,
 *   activeMarket: any,
 *   setActiveMarket: (m: any) => void,
 *   setUnlockedView: (v: any) => void,
 *   setDispenserRef: (r: any) => void,
 *   formBack: () => void,
 * }} ctx
 * @returns {import('react').ReactElement | null}
 */
export function renderDexRoute(unlockedView, ctx) {
    const {
        activeWalletId,
        activeAccountId,
        marketsAsset,
        setMarketsAsset,
        activeMarket,
        setActiveMarket,
        setUnlockedView,
        setDispenserRef,
        formBack,
    } = ctx;

    if (unlockedView === 'markets' && activeWalletId) {
        return (
            <MarketsList
                walletId={activeWalletId}
                selectedAsset={marketsAsset}
                onChangeAsset={() => setUnlockedView('markets-picker')}
                onOpenMarket={(chainId, tick1, tick2) => {
                    setActiveMarket({ chainId, tick1, tick2 });
                    setUnlockedView('market');
                }}
                onBack={() => setUnlockedView('home')}
            />
        );
    }
    if (unlockedView === 'markets-picker' && activeWalletId) {
        return (
            <ReceivePicker
                walletId={activeWalletId}
                accountId={activeAccountId || undefined}
                title="Select coin or token"
                backLabel="Back to markets"
                hideOwnFilter
                onBack={() => setUnlockedView('markets')}
                onSelect={(sel) => {
                    setMarketsAsset({
                        chainId: sel.chainId,
                        tick: sel.tick,
                        displayName: sel.displayName,
                        kind: sel.kind,
                    });
                    setUnlockedView('markets');
                }}
            />
        );
    }
    if (unlockedView === 'market' && activeMarket && activeWalletId) {
        return (
            <MarketView
                walletId={activeWalletId}
                chainId={activeMarket.chainId}
                tick1={activeMarket.tick1}
                tick2={activeMarket.tick2}
                onBack={() => {
                    setActiveMarket(null);
                    setUnlockedView('markets');
                }}
                onSwap={() => setActiveMarket({
                    chainId: activeMarket.chainId,
                    tick1: activeMarket.tick2,
                    tick2: activeMarket.tick1,
                })}
            />
        );
    }
    if (unlockedView === 'swap' && activeWalletId) {
        return (
            <SwapForm
                walletId={activeWalletId}
                onBack={formBack}
            />
        );
    }
    if (unlockedView === 'create-order' && activeWalletId) {
        return (
            <CreateOrderForm
                walletId={activeWalletId}
                onBack={formBack}
                onManageOrders={() => setUnlockedView('my-orders')}
            />
        );
    }
    if (unlockedView === 'my-orders' && activeWalletId) {
        return (
            <MyOrdersView
                walletId={activeWalletId}
                accountId={activeAccountId}
                onBack={() => setUnlockedView('home')}
                onCreateOrder={() => setUnlockedView('create-order')}
            />
        );
    }
    if (unlockedView === 'my-swaps' && activeWalletId) {
        return (
            <MySwapsView
                walletId={activeWalletId}
                accountId={activeAccountId}
                onBack={() => setUnlockedView('home')}
                onCreateSwap={() => setUnlockedView('swap')}
            />
        );
    }
    if (unlockedView === 'cross-chain-swap' && activeWalletId) {
        return (
            <CrossChainSwapForm
                walletId={activeWalletId}
                onBack={formBack}
            />
        );
    }
    // Deliberately not wallet-gated: MarketActivity reads the public
    // marketplace feed and renders with walletId null, exactly as it did in
    // the route chain this moved out of.
    if (unlockedView === 'market-activity') {
        return (
            <MarketActivity
                walletId={activeWalletId}
                onBack={() => setUnlockedView('home')}
                onOpenDispenser={(chainId, actionIndex) => {
                    setDispenserRef({ chainId, actionIndex, origin: 'explorer' });
                    setUnlockedView('dispenser-detail');
                }}
            />
        );
    }
    return null;
}
