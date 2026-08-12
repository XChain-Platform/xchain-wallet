// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Icon } from '@xchain-wallet/core/ui';
import { showsBottomBar, showsSidebar } from '../styles/breakpoints.js';
import { useLayoutTier } from '../styles/useLayoutTier.js';
import styles from './LeftNav.module.css';

/**
 * §24.2 / G053: full-layout left navigation. Renders a fixed-width
 * sidebar listing primary surfaces (Home, History, Send, Receive,
 * Scan, DEX, Dispensers, Contracts, Messaging) plus a contacts row,
 * a wallet switcher, Settings, and Lock. Active row gets
 * `aria-current="page"`.
 *
 * Two of those rows are conditional on the wallet, not the build:
 * `isSignerMode` (§20) removes Send and Receive, because the Wallet Mode
 * screen promises exactly that when the user picks the air-gapped signer
 * role.
 *
 * Visibility is the parent's responsibility: this component renders
 * itself unconditionally. `<FullLayoutWithNav>` decides whether the
 * sidebar shows at all (compact tier hands the slot to the bottom tab
 * bar instead), and the `rail` tier styling below 900px collapses these
 * rows to icons with their labels clipped but still in the accessibility
 * tree. See shared/styles/breakpoints.js for the tier definitions.
 *
 * `currentView` is matched against each item's `id`, with two soft
 * mappings so the active highlight survives drilldowns:
 *   - 'token-detail' / 'addresses' / 'wallet-picker' / 'account-picker'
 *     / 'wallet-details' / 'wallet-rename' / 'add-account' / 'add-wallet'
 *     all highlight Home (they're entered from there).
 *   - 'compose-message' highlights Messaging.
 *   - 'dispenser-explorer' / 'dispenser-detail' / 'dispenser' highlight
 *     Dispensers.
 *   - 'contract-*' / 'staking-*' / 'operator-dashboard' / 'stake-form'
 *     highlight Contracts.
 *   - 'market' highlights DEX.
 *   - 'list-detail' / 'list-create' / 'list-fork' highlight Lists.
 */

const VIEW_GROUPS = {
    home: ['home', 'token-detail', 'addresses', 'wallet-picker', 'account-picker', 'wallet-details', 'wallet-rename', 'account-rename', 'add-account', 'add-wallet'],
    history: ['history'],
    send: ['send'],
    receive: ['receive'],
    scan: ['scan'],
    markets: ['markets', 'market'],
    'dispensers-list': ['dispensers-list', 'dispenser-detail', 'dispenser-explorer', 'dispenser'],
    'contracts-list': ['contracts-list', 'contract-detail', 'contract-deploy', 'contract-execute', 'contract-deposit', 'contract-withdraw', 'staking-dashboard', 'stake-detail', 'stake-new', 'stake-form', 'staking-unstake', 'staking-claim', 'staking-delegate', 'staking-revoke', 'operator-dashboard'],
    messaging: ['messaging', 'compose-message'],
    contacts: ['contacts'],
    lists: ['lists', 'list-detail', 'list-create', 'list-fork'],
    obligations: ['obligations'],
    settings: ['settings', 'connected-sites'],
};

function isActive(itemId, currentView) {
    const group = VIEW_GROUPS[itemId];
    return group ? group.includes(currentView) : itemId === currentView;
}

// Compact nav badge label: a count capped at "99+" so a large unread total
// never blows out the pill width.
export function formatBadgeCount(n) {
    return n > 99 ? '99+' : String(n);
}

/**
 * @param {object} props
 * @param {string} props.currentView
 * @param {(view: string) => void} props.onSelect
 * @param {() => void} [props.onLock]
 * @param {() => void} [props.onOpenSettings]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {() => void} [props.onCommandPalette]   when provided, renders a search row at the top that opens the §33 command palette (Cmd/Ctrl+K); shells with their own header search (web) leave it unset
 * @param {string} [props.walletName]
 * @param {boolean} [props.hasBtcAddress]
 * @param {boolean} [props.hasDexSurface] false only in a build that compiled the DEX surface out; the tab is then absent, not disabled
 * @param {boolean} [props.isSignerMode] §20 air-gapped signer mode; drops Send + Receive from the nav
 * @param {Record<string, number>} [props.badges]   per-view unread/attention counts; a count > 0 renders a pill on that item (e.g. { messaging: 3 })
 */
export function LeftNav({
    currentView,
    onSelect,
    onLock,
    onOpenSettings,
    onOpenWalletPicker,
    onCommandPalette,
    walletName,
    hasBtcAddress = false,
    hasDexSurface = true,
    isSignerMode = false,
    badges = {},
}) {
    const primary = [
        { id: 'home', label: 'Home', Icon: Icon.HomeIcon },
        { id: 'history', label: 'History', Icon: Icon.HistoryIcon },
        // Signer mode's own hint promises "Send / receive screens
        // are hidden; this wallet does not broadcast". Absent, not disabled,
        // for the reason the DEX row below is absent: a greyed Send row still
        // reads as a capability the device has, and the whole value of the
        // mode is that an air-gapped user can believe the removal.
        ...(isSignerMode ? [] : [
            { id: 'send', label: 'Send', Icon: Icon.SendIcon },
            { id: 'receive', label: 'Receive', Icon: Icon.ReceiveIcon },
        ]),
        { id: 'scan', label: 'Scan', Icon: Icon.ScanIcon },
        // Absent, not greyed, when the build has no DEX surface: the store
        // build compiles those routes out, so the destination does
        // not exist, and a visibly disabled exchange tab asks an app reviewer
        // the same question a working one does.
        ...(hasDexSurface
            ? [{ id: 'markets', label: 'DEX', Icon: Icon.MarketIcon }]
            : []),
        { id: 'dispensers-list', label: 'Dispensers', Icon: Icon.DollarIcon },
        ...(hasBtcAddress
            ? [{ id: 'contracts-list', label: 'Contracts', Icon: Icon.ContractIcon }]
            : []),
        { id: 'messaging', label: 'Messaging', Icon: Icon.MessageIcon },
    ];

    const secondary = [
        { id: 'contacts', label: 'Contacts', Icon: Icon.UsersIcon },
        { id: 'lists', label: 'Lists', Icon: Icon.TokenListIcon },
        // PC-15: COINPAY obligations queue; badge = payable pending count.
        { id: 'obligations', label: 'Payments due', Icon: Icon.ClockIcon },
    ];

    return (
        <nav className={styles.nav} aria-label="Primary navigation">
            <div className={styles.brand}>XChain Wallet</div>
            {onCommandPalette ? (
                <button
                    type="button"
                    className={`${styles.item} ${styles.search}`}
                    onClick={onCommandPalette}
                    aria-label="Open command palette"
                    aria-keyshortcuts="Meta+K Control+K"
                    title="Search (Cmd/Ctrl+K)"
                >
                    <span className={styles.icon} aria-hidden="true">
                        <Icon.SearchIcon />
                    </span>
                    <span className={styles.label}>Search</span>
                </button>
            ) : null}
            <ul className={styles.list} role="list">
                {primary.map((item) => {
                    const active = isActive(item.id, currentView);
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                onClick={() => onSelect(item.id)}
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <item.Icon />
                                </span>
                                <span className={styles.label}>{item.label}</span>
                                {badges[item.id] > 0 ? (
                                    <span className={styles.badge} aria-label={`${badges[item.id]} unread`}>
                                        {formatBadgeCount(badges[item.id])}
                                    </span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <hr className={styles.divider} />
            <ul className={styles.list} role="list">
                {secondary.map((item) => {
                    const active = isActive(item.id, currentView);
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                onClick={() => onSelect(item.id)}
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <item.Icon />
                                </span>
                                <span className={styles.label}>{item.label}</span>
                                {badges[item.id] > 0 ? (
                                    <span className={styles.badge} aria-label={`${badges[item.id]} pending`}>
                                        {formatBadgeCount(badges[item.id])}
                                    </span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className={styles.spacer} />
            <div className={styles.footer}>
                {walletName && onOpenWalletPicker ? (
                    <button
                        type="button"
                        className={styles.walletSwitcher}
                        onClick={onOpenWalletPicker}
                        title={walletName}
                    >
                        <span className={styles.walletName}>{walletName}</span>
                        <span aria-hidden="true">▾</span>
                    </button>
                ) : null}
                {onOpenSettings ? (
                    <button
                        type="button"
                        className={`${styles.item} ${isActive('settings', currentView) ? styles.itemActive : ''}`}
                        aria-current={isActive('settings', currentView) ? 'page' : undefined}
                        onClick={onOpenSettings}
                    >
                        <span className={styles.icon} aria-hidden="true">
                            <Icon.GearIcon />
                        </span>
                        <span className={styles.label}>Settings</span>
                    </button>
                ) : null}
                {onLock ? (
                    <button
                        type="button"
                        className={styles.item}
                        onClick={onLock}
                    >
                        <span className={styles.icon} aria-hidden="true">
                            <Icon.LockIcon />
                        </span>
                        <span className={styles.label}>Lock</span>
                    </button>
                ) : null}
            </div>
        </nav>
    );
}

/**
 * Wraps the unlocked-route render tree in a flex layout that places
 * `<LeftNav>` alongside the active route.
 *
 * The layout picks the navigation surface itself, from its own
 * measured width (`useLayoutTier`), and publishes the result as
 * `data-xc-tier` for the CSS to key off:
 *
 *   compact (< 640px)     bottom tab bar; the sidebar slot is withheld
 *   rail    (640-899px)   sidebar as an icon rail; no bottom bar
 *   full    (>= 900px)    labelled sidebar; no bottom bar
 *
 * Shells hand in BOTH slots and let the layout choose, which is what
 * makes one interface work across every width. It replaces the old split
 * where each shell gated the slots itself against a viewport threshold
 * while the CSS used a different one, leaving 640-899px with neither nav.
 * Measuring the container (not the viewport) is also what lets a 360px
 * popup or dev-preview frame inside a 1400px window read as compact.
 *
 * The wrapper sets `--xc-screen-h: 100%` on the main pane so the route's
 * `<Screen>` (which defaults to `100dvh`) fills its flex parent instead
 * of overflowing the document.
 *
 * The `header` slot (§49 / Cluster G FOLLOWUP 4) renders persistent
 * banners (queued broadcasts, …) above the route content so they
 * survive route changes, so Home no longer has to mount them itself.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.nav
 * @param {import('react').ReactNode} [props.bottomBar]
 * @param {import('react').ReactNode} [props.header]
 * @param {import('react').ReactNode} props.children
 */
export function FullLayoutWithNav({ nav, bottomBar, header, children }) {
    const [layoutRef, tier] = useLayoutTier();
    const sidebar = showsSidebar(tier) ? nav : null;
    const bar = showsBottomBar(tier) ? bottomBar : null;
    return (
        <div
            ref={layoutRef}
            data-xc-tier={tier}
            className={`${styles.layout} ${bar ? styles.layoutWithBottomBar : ''}`}
        >
            {sidebar ? <aside className={styles.sidebar}>{sidebar}</aside> : null}
            <div className={styles.main}>
                {header ? <div className={styles.header}>{header}</div> : null}
                <div className={styles.mainBody}>{children}</div>
            </div>
            {bar ? <div className={styles.bottomBarSlot}>{bar}</div> : null}
        </div>
    );
}
