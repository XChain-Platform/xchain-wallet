// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AppHeader: persistent top strip that stays mounted across every
// unlocked route. Matches the layout used at the top of Home: brand on
// the left, network-filter button + pancake-menu button on the right.
// Living in the FullLayoutWithNav header slot means TokenDetail / Send
// / Receive / Settings all keep the wallet's top-level affordances
// visible without re-rendering their own copy.
//
// `chainRegistry` + `coinFamilies` + `networkFilter` + `onNetworkFilterChange`
// drive the HeaderNetworkButton. `onMenuOpen` fires when the pancake
// is tapped. The parent layout owns the menu drawer mount so it can
// span the viewport.

import * as branding from '../../branding/branding.js';
import { Icon } from '../../ui/index.js';
import { HeaderNetworkButton } from './HeaderNetworkButton.jsx';
import styles from './AppHeader.module.css';

/**
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies                              ordered coin family list for the filter popover (e.g. ['bitcoin','litecoin','dogecoin'])
 * @param {string} props.networkFilter                               current filter value ('all' or a coin id)
 * @param {(coin: string) => void} props.onNetworkFilterChange
 * @param {string} [props.tokenQuery]                                free-text token filter forwarded to the popover; omitting `onTokenQueryChange` hides the text input
 * @param {(q: string) => void} [props.onTokenQueryChange]
 * @param {() => void} [props.onMenuOpen]                            pancake-tap handler
 * @param {boolean} [props.showNetworkFilter]                        when false, the network-filter button is hidden (used to scope the filter to the home view only)
 * @param {'all' | 'coins' | 'tokens'} [props.kindFilter]            optional asset-kind segmented control; only shown when `onKindFilterChange` is provided
 * @param {(kind: 'all' | 'coins' | 'tokens') => void} [props.onKindFilterChange]
 * @param {() => void} [props.onScan]                                when provided, renders a QR-scan icon button between the filter and the pancake menu
 * @param {() => void} [props.onLock]                                when provided, renders a one-tap lock button; same action as the "Lock wallet" row in the pancake menu
 * @param {boolean} [props.locking]                                  disables the lock button while a lock is in flight
 */
export function AppHeader({
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    tokenQuery,
    onTokenQueryChange,
    onMenuOpen,
    showNetworkFilter = true,
    kindFilter,
    onKindFilterChange,
    onScan,
    onLock,
    locking,
}) {
    return (
        <header className={styles.bar} role="banner">
            <div className={styles.left}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={styles.logo}
                />
            </div>
            <div className={styles.right}>
                {showNetworkFilter && chainRegistry && Array.isArray(coinFamilies) && coinFamilies.length > 0 ? (
                    <HeaderNetworkButton
                        chainRegistry={chainRegistry}
                        coinFamilies={coinFamilies}
                        networkFilter={networkFilter}
                        onNetworkFilterChange={onNetworkFilterChange}
                        tokenQuery={tokenQuery}
                        onTokenQueryChange={onTokenQueryChange}
                        kindFilter={kindFilter}
                        onKindFilterChange={onKindFilterChange}
                    />
                ) : null}
                {onScan ? (
                    <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={onScan}
                        aria-label="Scan a QR code"
                        title="Scan a QR code"
                    >
                        <Icon.ScanIcon />
                    </button>
                ) : null}
                {onLock ? (
                    <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={onLock}
                        disabled={locking}
                        aria-label="Lock wallet"
                        title="Lock wallet"
                    >
                        <Icon.LockIcon />
                    </button>
                ) : null}
                {onMenuOpen ? (
                    <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={onMenuOpen}
                        aria-label="Open menu"
                        aria-haspopup="dialog"
                    >
                        <Icon.MenuIcon />
                    </button>
                ) : null}
            </div>
        </header>
    );
}
