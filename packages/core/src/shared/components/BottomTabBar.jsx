// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { formatBadgeCount } from './LeftNav.jsx';
import styles from './BottomTabBar.module.css';

/**
 * §24.3 / G054: mobile bottom-sheet navigation.
 *
 * Five thumb-reachable tabs at the bottom of the viewport:
 *   [Home] [History] [Send] [Scan] [More]
 *
 * "More" toggles a bottom-sheet drawer that lists the rest of the
 * navigation (Receive, DEX, Dispensers, Contracts, Messaging,
 * Contacts) plus the wallet switcher, Settings, and Lock (same
 * surface set as `<LeftNav>`) so the user sees a single coherent map
 * of the wallet.
 *
 * Visibility: this component renders itself unconditionally; the
 * parent (`<FullLayoutWithNav>`) hides it via CSS above 600px so
 * tablets and desktops keep the left-nav layout. Below 600px the
 * sheet floats above main content and the route gets enough
 * bottom-padding to clear the bar.
 *
 * §24.3 / Cluster Y FOLLOWUP 1: the Scan slot now occupies the
 * primary tab row per spec. `<ScanRoute>` (the dedicated scan-and-
 * classify surface) ships at v0.285.0. Receive moves into the More
 * sheet (still daily-use, but the wallet's primary intent is "act on
 * something I scanned" more often than "show my address").
 *
 * @param {object} props
 * @param {string} props.currentView
 * @param {(view: string) => void} props.onSelect
 * @param {() => void} [props.onLock]
 * @param {() => void} [props.onOpenSettings]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {boolean} [props.hasBtcAddress]
 * @param {Record<string, number>} [props.badges]   per-view counts; a count > 0 badges that sheet row and surfaces a dot on the "More" tab (e.g. { messaging: 3 })
 */

const PRIMARY_TABS = [
    { id: 'home', label: 'Home', Icon: Icon.HomeIcon, group: ['home', 'token-detail', 'addresses', 'wallet-picker', 'account-picker', 'wallet-details', 'wallet-rename', 'account-rename', 'add-account', 'add-wallet'] },
    { id: 'history', label: 'History', Icon: Icon.HistoryIcon, group: ['history'] },
    { id: 'send', label: 'Send', Icon: Icon.SendIcon, group: ['send'] },
    { id: 'scan', label: 'Scan', Icon: Icon.ScanIcon, group: ['scan'] },
];

const SHEET_PRIMARY = [
    { id: 'receive', label: 'Receive', Icon: Icon.ReceiveIcon, group: ['receive'] },
    { id: 'markets', label: 'DEX', Icon: Icon.MarketIcon, group: ['markets', 'market'] },
    { id: 'dispensers-list', label: 'Dispensers', Icon: Icon.DollarIcon, group: ['dispensers-list', 'dispenser-detail', 'dispenser-explorer', 'dispenser'] },
    { id: 'contracts-list', label: 'Contracts', Icon: Icon.ContractIcon, group: ['contracts-list', 'contract-detail', 'contract-deploy', 'contract-execute', 'contract-deposit', 'contract-withdraw', 'staking-dashboard', 'stake-form', 'staking-unstake', 'staking-claim', 'staking-delegate', 'staking-revoke', 'operator-dashboard'], requiresBtc: true },
    { id: 'messaging', label: 'Messaging', Icon: Icon.MessageIcon, group: ['messaging', 'compose-message'] },
    { id: 'contacts', label: 'Contacts', Icon: Icon.UsersIcon, group: ['contacts'] },
];

function isActive(view, group) {
    return group.includes(view);
}

export function BottomTabBar({
    currentView,
    onSelect,
    onLock,
    onOpenSettings,
    onOpenWalletPicker,
    hasBtcAddress = false,
    badges = {},
}) {
    const [sheetOpen, setSheetOpen] = useState(false);

    // Close the sheet whenever the user navigates. The parent flips
    // currentView, which is enough of a signal that the user picked a
    // destination and the sheet should get out of the way.
    useEffect(() => {
        if (sheetOpen) setSheetOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentView]);

    // Esc closes the sheet (sheet acts as a transient overlay).
    useEffect(() => {
        if (!sheetOpen) return undefined;
        function onKey(e) {
            if (e.key === 'Escape') setSheetOpen(false);
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [sheetOpen]);

    const sheetRows = SHEET_PRIMARY.filter(
        (row) => !row.requiresBtc || hasBtcAddress,
    );
    // Messaging lives behind "More", so any unread inside the sheet also needs a
    // dot on the More tab itself or the user would never see it while collapsed.
    const sheetHasUnread = sheetRows.some((row) => badges[row.id] > 0);

    return (
        <>
            <nav className={styles.bar} aria-label="Bottom navigation">
                {PRIMARY_TABS.map((tab) => {
                    const active = isActive(currentView, tab.group);
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            className={`${styles.tab} ${active ? styles.tabActive : ''}`}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => onSelect(tab.id)}
                        >
                            <span className={styles.tabIcon} aria-hidden="true">
                                <tab.Icon />
                            </span>
                            <span className={styles.tabLabel}>{tab.label}</span>
                        </button>
                    );
                })}
                <button
                    type="button"
                    className={`${styles.tab} ${sheetOpen ? styles.tabActive : ''}`}
                    aria-expanded={sheetOpen ? 'true' : 'false'}
                    aria-controls="xc-bottom-sheet"
                    onClick={() => setSheetOpen((v) => !v)}
                >
                    <span className={styles.tabIcon} aria-hidden="true">
                        <Icon.MenuIcon />
                        {sheetHasUnread ? (
                            <span className={styles.tabDot} aria-hidden="true" />
                        ) : null}
                    </span>
                    <span className={styles.tabLabel}>More</span>
                </button>
            </nav>

            {sheetOpen ? (
                <>
                    <div
                        className={styles.scrim}
                        onClick={() => setSheetOpen(false)}
                        aria-hidden="true"
                        role="presentation"
                        tabIndex={-1}
                    />
                    <div
                        id="xc-bottom-sheet"
                        role="dialog"
                        aria-label="More navigation"
                        className={styles.sheet}
                    >
                        <div className={styles.handle} aria-hidden="true" />
                        <ul className={styles.sheetList} role="list">
                            {sheetRows.map((row) => {
                                const active = isActive(currentView, row.group);
                                return (
                                    <li key={row.id}>
                                        <button
                                            type="button"
                                            className={`${styles.sheetItem} ${active ? styles.sheetItemActive : ''}`}
                                            aria-current={active ? 'page' : undefined}
                                            onClick={() => onSelect(row.id)}
                                        >
                                            <span className={styles.sheetIcon} aria-hidden="true">
                                                <row.Icon />
                                            </span>
                                            <span className={styles.sheetLabel}>{row.label}</span>
                                            {badges[row.id] > 0 ? (
                                                <span className={styles.sheetBadge} aria-label={`${badges[row.id]} unread`}>
                                                    {formatBadgeCount(badges[row.id])}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        <div className={styles.sheetDivider} />
                        <ul className={styles.sheetList} role="list">
                            {onOpenWalletPicker ? (
                                <li>
                                    <button
                                        type="button"
                                        className={styles.sheetItem}
                                        onClick={onOpenWalletPicker}
                                    >
                                        <span className={styles.sheetIcon} aria-hidden="true">
                                            <Icon.MoreIcon />
                                        </span>
                                        <span>Switch wallet</span>
                                    </button>
                                </li>
                            ) : null}
                            {onOpenSettings ? (
                                <li>
                                    <button
                                        type="button"
                                        className={styles.sheetItem}
                                        onClick={onOpenSettings}
                                    >
                                        <span className={styles.sheetIcon} aria-hidden="true">
                                            <Icon.GearIcon />
                                        </span>
                                        <span>Settings</span>
                                    </button>
                                </li>
                            ) : null}
                            {onLock ? (
                                <li>
                                    <button
                                        type="button"
                                        className={styles.sheetItem}
                                        onClick={onLock}
                                    >
                                        <span className={styles.sheetIcon} aria-hidden="true">
                                            <Icon.LockIcon />
                                        </span>
                                        <span>Lock</span>
                                    </button>
                                </li>
                            ) : null}
                        </ul>
                    </div>
                </>
            ) : null}
        </>
    );
}
