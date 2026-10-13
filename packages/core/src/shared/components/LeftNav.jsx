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
 * `currentView` resolves through `LEFT_NAV_VIEW_GROUPS`, so drilldowns keep
 * their parent surface highlighted. A route that has no dedicated group
 * resolves to Home, matching the shell's Home fallback.
 */

export const LEFT_NAV_VIEW_GROUPS = {
    home: [
        'home', 'menu', 'alerts', 'actions', 'action-detail',
        'token-detail', 'my-tokens', 'manage-token', 'wizard', 'issue',
        'mint', 'destroy', 'sweep', 'lock', 'mint-settings',
        'callback-settings', 'bridge-settings', 'description', 'transfer',
        'bridge-move', 'execute-callback', 'pause-token', 'lock-address',
        'broadcast', 'oracle', 'controller-bind', 'dividend', 'airdrop',
        'advanced', 'pair-signer', 'sign-message', 'verify-signature',
        'link-form', 'attach-content', 'gated-publish', 'publish-file',
        'project-roster', 'parallel-compose', 'batch-compose', 'sell-name',
        'multisig-create', 'multisig-sign', 'governance-polls',
        'governance-create-poll', 'governance-poll-detail',
        'governance-delegate', 'cosigner-accounts', 'cosigner-provision',
        'cosigner-detail', 'addresses', 'view-private-key',
        'address-preferences', 'wallet-picker', 'account-picker',
        'wallet-details', 'wallet-rename', 'account-rename', 'add-account',
        'add-wallet', 'migrate-bip39',
    ],
    history: ['history'],
    send: ['send', 'send-picker'],
    receive: ['receive', 'receive-picker'],
    scan: ['scan', 'sign-psbt'],
    markets: [
        'markets', 'market', 'markets-picker', 'market-activity', 'swap',
        'create-order', 'my-orders', 'my-swaps', 'cross-chain-swap',
        'cross-chain-order', 'cross-chain-templates', 'bet-markets',
        'bet-market-detail', 'bet-oracle-record', 'bet-create', 'my-bets',
        'bet-oracle-console',
    ],
    'dispensers-list': ['dispensers-list', 'dispenser-detail', 'dispenser-explorer', 'dispenser'],
    'contracts-list': ['contracts-list', 'contract-detail', 'contract-deploy', 'contract-execute', 'contract-deposit', 'contract-withdraw', 'contract-stake', 'staking-dashboard', 'stake-detail', 'stake-new', 'stake-form', 'staking-unstake', 'staking-claim', 'staking-delegate', 'staking-revoke', 'operator-dashboard'],
    messaging: ['messaging', 'compose-message'],
    contacts: ['contacts'],
    lists: ['lists', 'list-detail', 'list-create', 'list-fork', 'list-share', 'list-transfer', 'list-rename', 'list-union', 'shared-lists', 'access-lists'],
    obligations: ['obligations', 'coinpay'],
    settings: ['settings', 'connected-sites'],
};

export function activeLeftNavItem(currentView) {
    return Object.entries(LEFT_NAV_VIEW_GROUPS)
        .find(([, views]) => views.includes(currentView))?.[0] || 'home';
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
 * @param {boolean} [props.hasVmAddress] gates the Contracts row (the registry carries DEPLOY in COMMON_ACTIONS, so LTC and DOGE qualify too)
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
    hasVmAddress = false,
    hasDexSurface = true,
    isSignerMode = false,
    badges = {},
}) {
    const activeItem = activeLeftNavItem(currentView);
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
        // Gate Contracts on a VM address, matching Home and the command
        // palette (DEPLOY sits in COMMON_ACTIONS, so LTC/DOGE carry it).
        ...(hasVmAddress
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

    const handleKeyDown = (event) => {
        const direction = {
            ArrowDown: 1,
            ArrowRight: 1,
            ArrowUp: -1,
            ArrowLeft: -1,
        }[event.key];
        if (!direction && event.key !== 'Home' && event.key !== 'End') return;

        const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
        const currentButton = event.target.closest?.('button');
        const currentIndex = buttons.indexOf(currentButton);
        if (currentIndex < 0 || buttons.length === 0) return;

        event.preventDefault();
        let nextIndex;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = buttons.length - 1;
        else nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
        buttons[nextIndex].focus();
        buttons[nextIndex].scrollIntoView?.({ block: 'nearest' });
    };

    return (
        <nav
            className={styles.nav}
            aria-label="Primary navigation"
            onKeyDown={handleKeyDown}
        >
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
                    const active = activeItem === item.id;
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                title={item.label}
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
                    const active = activeItem === item.id;
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                title={item.label}
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
                        className={`${styles.item} ${activeItem === 'settings' ? styles.itemActive : ''}`}
                        aria-current={activeItem === 'settings' ? 'page' : undefined}
                        title="Settings"
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
                        title="Lock"
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
