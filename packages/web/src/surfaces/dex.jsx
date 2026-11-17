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
// MySwapsView, CrossChainSwapForm, CrossChainOrderForm and MarketActivity never enter the bundle at
// all. The alternative - a boolean the app checks - leaves the code in the
// artifact and relies on a bundler happening to shake it out, which is not
// something a signed manifest can claim (§2.3).
//
// Consequences of that choice, both deliberate:
//   - This is the ONLY module allowed to import a DEX route component. A
//     second importer would keep the code in a bundle whose profile hides
//     `dex` no matter what the alias does, so a smoke asserts this file is
//     the only one.
//   - Every export here must exist in the twin with the same shape. The twin
//     is what a build that hides `dex` runs (no profile does today; see
//     `registry.js`), so a name added on one side only is an undefined at
//     runtime, on the shell with the least test coverage.

import { lazy } from 'react';
import { t } from '../../../core/src/i18n/index.js';

const lazyRoute = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));

const MarketsList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketsList.jsx'), 'MarketsList');
const MarketView = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketView.jsx'), 'MarketView');
// The Trade page; its pair and opening side ride on activeMarket.trade.
const MarketTrade = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketTrade.jsx'), 'MarketTrade');
const MarketActivity = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketActivity.jsx'), 'MarketActivity');
const CreateOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CreateOrderForm.jsx'), 'CreateOrderForm');
const MyOrdersView = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MyOrdersView.jsx'), 'MyOrdersView');
const OrderDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/OrderDetail.jsx'), 'OrderDetail');
const EditOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/EditOrderForm.jsx'), 'EditOrderForm');
const CancelOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CancelOrderForm.jsx'), 'CancelOrderForm');
const MySwapsView = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MySwapsView.jsx'), 'MySwapsView');
const SwapDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SwapDetail.jsx'), 'SwapDetail');
const EditSwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/EditSwapForm.jsx'), 'EditSwapForm');
const CancelSwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CancelSwapForm.jsx'), 'CancelSwapForm');
const SwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SwapForm.jsx'), 'SwapForm');
const CrossChainSwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CrossChainSwapForm.jsx'), 'CrossChainSwapForm');
const CrossChainOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CrossChainOrderForm.jsx'), 'CrossChainOrderForm');
const ReceivePicker = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ReceivePicker.jsx'), 'ReceivePicker');

/**
 * Whether this build carries the DEX surface. `false` in the twin.
 *
 * The shell reads it to decide whether to WIRE a handler at all, which is what
 * makes the entry points disappear: the wallet menu, the actions menu and the
 * command palette all render an entry only when its handler exists.
 */
export const DEX_SURFACE_ENABLED = true;

/**
 * Render the DEX view named by `unlockedView`, or null when it is not one.
 *
 * Called once from the web shell's route chain, in place of the nine
 * `if (unlockedView === …)` blocks that used to sit there. Order inside the
 * chain does not matter: view names are unique, and an unmatched view falls
 * through to Home, which is also what a build that hides `dex` would do with a
 * `markets` view restored from a previous session (`RESUMABLE_VIEWS` lists it).
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
 *   goBack: () => void,
 *   landView: (v: string) => void,
 *   setDispenserRef: (r: any) => void,
 *   orderRef?: { chainId: string, actionIndex: string } | null,
 *   setOrderRef?: (r: { chainId: string, actionIndex: string } | null) => void,
 *   swapRef?: { chainId: string, actionIndex: string } | null,
 *   setSwapRef?: (r: { chainId: string, actionIndex: string } | null) => void,
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
        goBack,
        landView,
        setDispenserRef,
        orderRef,
        setOrderRef,
        swapRef,
        setSwapRef,
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
                onBack={goBack}
                // Wide content: the list and the picked market side by side. The
                // pick lives in activeMarket, so Back from the Trade page keeps it.
                selectedMarket={activeMarket}
                onSelectMarket={(chainId, tick1, tick2) => setActiveMarket({ chainId, tick1, tick2 })}
                renderMarket={(market, panel) => (
                    <MarketView
                        embedded
                        walletId={activeWalletId}
                        chainId={market.chainId}
                        tick1={market.tick1}
                        tick2={market.tick2}
                        onWatchlistChange={panel.onWatchlistChange}
                        onSwap={() => setActiveMarket({
                            chainId: market.chainId,
                            tick1: market.tick2,
                            tick2: market.tick1,
                        })}
                        onTrade={(trade) => {
                            setActiveMarket({ ...market, trade });
                            setUnlockedView('market-trade');
                        }}
                    />
                )}
            />
        );
    }
    if (unlockedView === 'markets-picker' && activeWalletId) {
        return (
            <ReceivePicker
                walletId={activeWalletId}
                accountId={activeAccountId || undefined}
                title={t('shell.markets.selectAsset')}
                backLabel={t('shell.markets.back')}
                selectedKey={marketsAsset ? `${marketsAsset.chainId}:${marketsAsset.tick}` : null}
                hideOwnFilter
                onBack={goBack}
                // A pick returns to Markets with the asset, never a second Markets.
                onSelect={(sel) => {
                    setMarketsAsset({
                        chainId: sel.chainId,
                        tick: sel.tick,
                        displayName: sel.displayName,
                        kind: sel.kind,
                    });
                    landView('markets');
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
                    goBack();
                }}
                onSwap={() => setActiveMarket({
                    chainId: activeMarket.chainId,
                    tick1: activeMarket.tick2,
                    tick2: activeMarket.tick1,
                })}
                // Buy, Sell and a book price open the Trade page route.
                onTrade={(trade) => {
                    setActiveMarket({
                        chainId: activeMarket.chainId,
                        tick1: activeMarket.tick1,
                        tick2: activeMarket.tick2,
                        trade,
                    });
                    setUnlockedView('market-trade');
                }}
            />
        );
    }
    // The Trade page. Back drops the trade and returns to the market.
    if (unlockedView === 'market-trade' && activeMarket && activeWalletId) {
        return (
            <MarketTrade
                walletId={activeWalletId}
                chainId={activeMarket.chainId}
                tick1={activeMarket.tick1}
                tick2={activeMarket.tick2}
                side={activeMarket.trade?.side}
                mode={activeMarket.trade?.mode}
                price={activeMarket.trade?.price ?? null}
                pick={activeMarket.trade?.pick}
                onBack={() => {
                    setActiveMarket({
                        chainId: activeMarket.chainId,
                        tick1: activeMarket.tick1,
                        tick2: activeMarket.tick2,
                    });
                    goBack();
                }}
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
                onBack={goBack}
                onCreateOrder={() => setUnlockedView('create-order')}
                onOpenOrder={setOrderRef ? (ref) => {
                    setOrderRef(ref);
                    setUnlockedView('order-detail');
                } : undefined}
            />
        );
    }
    if (unlockedView === 'order-detail' && activeWalletId && orderRef) {
        return (
            <OrderDetail
                walletId={activeWalletId}
                accountId={activeAccountId}
                chainId={orderRef.chainId}
                actionIndex={orderRef.actionIndex}
                onBack={goBack}
                // The order's "Open the market" action row.
                onOpenMarket={(chainId, tick1, tick2) => {
                    setActiveMarket({ chainId, tick1, tick2 });
                    setUnlockedView('market');
                }}
                // Edit and Cancel open their own standard form routes.
                onEditOrder={(ref) => {
                    setOrderRef(ref);
                    setUnlockedView('edit-order');
                }}
                onCancelOrder={(ref) => {
                    setOrderRef(ref);
                    setUnlockedView('cancel-order');
                }}
            />
        );
    }
    if (unlockedView === 'edit-order' && activeWalletId && orderRef) {
        return (
            <EditOrderForm
                walletId={activeWalletId}
                accountId={activeAccountId}
                chainId={orderRef.chainId}
                actionIndex={orderRef.actionIndex}
                onBack={goBack}
            />
        );
    }
    if (unlockedView === 'cancel-order' && activeWalletId && orderRef) {
        return (
            <CancelOrderForm
                walletId={activeWalletId}
                accountId={activeAccountId}
                chainId={orderRef.chainId}
                actionIndex={orderRef.actionIndex}
                onBack={goBack}
            />
        );
    }
    if (unlockedView === 'my-swaps' && activeWalletId) {
        return (
            <MySwapsView
                walletId={activeWalletId}
                accountId={activeAccountId}
                onBack={goBack}
                onCreateSwap={() => setUnlockedView('swap')}
                onOpenSwap={setSwapRef ? (chainId, actionIndex) => {
                    setSwapRef({ chainId, actionIndex });
                    setUnlockedView('swap-detail');
                } : undefined}
            />
        );
    }
    if (unlockedView === 'swap-detail' && activeWalletId && swapRef) {
        return (
            <SwapDetail
                walletId={activeWalletId}
                accountId={activeAccountId}
                chainId={swapRef.chainId}
                actionIndex={swapRef.actionIndex}
                onBack={goBack}
                // Edit and Cancel open their own standard form routes.
                onEditSwap={(ref) => {
                    setSwapRef(ref);
                    setUnlockedView('edit-swap');
                }}
                onCancelSwap={(ref) => {
                    setSwapRef(ref);
                    setUnlockedView('cancel-swap');
                }}
            />
        );
    }
    if (unlockedView === 'edit-swap' && activeWalletId && swapRef) {
        return (
            <EditSwapForm
                walletId={activeWalletId}
                accountId={activeAccountId}
                chainId={swapRef.chainId}
                actionIndex={swapRef.actionIndex}
                onBack={goBack}
            />
        );
    }
    if (unlockedView === 'cancel-swap' && activeWalletId && swapRef) {
        return (
            <CancelSwapForm
                walletId={activeWalletId}
                accountId={activeAccountId}
                chainId={swapRef.chainId}
                actionIndex={swapRef.actionIndex}
                onBack={goBack}
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
    if (unlockedView === 'cross-chain-order' && activeWalletId) {
        return (
            <CrossChainOrderForm
                walletId={activeWalletId}
                onBack={formBack}
                onManageOrders={() => setUnlockedView('my-orders')}
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
                onBack={goBack}
                onOpenDispenser={(chainId, actionIndex) => {
                    setDispenserRef({ chainId, actionIndex });
                    setUnlockedView('dispenser-detail');
                }}
            />
        );
    }
    return null;
}
