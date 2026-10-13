// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { formatBadgeCount, isNavItemActive } from './LeftNav.jsx';
import styles from './BottomTabBar.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap } from '../utils/focusTrap.js';

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
 * @param {boolean} [props.hasVmAddress] gates the Contracts sheet row (the registry carries DEPLOY in COMMON_ACTIONS, so LTC and DOGE qualify too)
 * @param {boolean} [props.hasDexSurface] false only in a build that compiled the DEX surface out; the row is then absent, not disabled
 * @param {boolean} [props.isSignerMode] §20 air-gapped signer mode; drops the Send tab and the Receive sheet row
 * @param {Record<string, number>} [props.badges]   per-view counts; a count > 0 badges that sheet row and surfaces a dot on the "More" tab (e.g. { messaging: 3 })
 */

const PRIMARY_TABS = [
    { id: 'home', label: 'Home', Icon: Icon.HomeIcon },
    { id: 'history', label: 'History', Icon: Icon.HistoryIcon },
    // `spendable` marks the two rows signer mode promises are gone.
    { id: 'send', label: 'Send', Icon: Icon.SendIcon, spendable: true },
    { id: 'scan', label: 'Scan', Icon: Icon.ScanIcon },
];

const SHEET_PRIMARY = [
    { id: 'receive', label: 'Receive', Icon: Icon.ReceiveIcon, spendable: true },
    { id: 'markets', label: 'DEX', Icon: Icon.MarketIcon, requiresDex: true },
    { id: 'dispensers-list', label: 'Dispensers', Icon: Icon.DollarIcon },
    { id: 'contracts-list', label: 'Contracts', Icon: Icon.ContractIcon, requiresVm: true },
    { id: 'messaging', label: 'Messaging', Icon: Icon.MessageIcon },
    { id: 'contacts', label: 'Contacts', Icon: Icon.UsersIcon },
    { id: 'lists', label: 'Lists', Icon: Icon.TokenListIcon },
    // PC-15: COINPAY obligations queue; a pending count also dots the More tab.
    { id: 'obligations', label: 'Payments due', Icon: Icon.ClockIcon, group: ['obligations'] },
];

export function BottomTabBar({
    currentView,
    onSelect,
    onLock,
    onOpenSettings,
    onOpenWalletPicker,
    hasVmAddress = false,
    hasDexSurface = true,
    isSignerMode = false,
    badges = {},
}) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const moreTriggerRef = useRef(null);
    const sheetRef = useRef(null);
    const sheetWasOpen = useRef(false);
    // The system Back gesture closes this before it leaves the screen.
    useBackHandler(sheetOpen ? () => setSheetOpen(false) : undefined);
    // Focus enters the sheet, cycles within its actions, and returns to More
    // when the sheet closes.
    useFocusTrap(sheetRef, { active: sheetOpen });

    // Close the sheet whenever the user navigates. The parent flips
    // currentView, which is enough of a signal that the user picked a
    // destination and the sheet should get out of the way.
    // Publish the bar's footprint while it is mounted, so bottom-pinned
    // overlays (the toast stack) can sit above it instead of on it. On an
    // LG K51 "Address copied" covered the whole bar (2026-10-12). Screens
    // without the bar leave the variable unset and keep their own offset.
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--xc-bottom-bar-h', '56px');
        return () => root.style.removeProperty('--xc-bottom-bar-h');
    }, []);

    useEffect(() => {
        if (sheetOpen) setSheetOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentView]);

    // Touch activation does not consistently focus a button before opening
    // the sheet, so the trigger remains the deterministic return target.
    useEffect(() => {
        if (sheetWasOpen.current && !sheetOpen) moreTriggerRef.current?.focus();
        sheetWasOpen.current = sheetOpen;
    }, [sheetOpen]);

    // Esc closes the sheet (sheet acts as a transient overlay).
    useEffect(() => {
        if (!sheetOpen) return undefined;
        function onKey(e) {
            if (e.key === 'Escape') setSheetOpen(false);
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [sheetOpen]);

    // `requiresDex` is a BUILD fact, not a wallet one: a profile that hides
    // the DEX surface compiles its routes out (none does today), so the row
    // would point at a view that does not exist in that bundle.
    // `requiresVm` is the registry gate Home and the palette use, not a BTC one.
    const sheetRows = SHEET_PRIMARY.filter(
        (row) => (!row.requiresVm || hasVmAddress)
            && (!row.requiresDex || hasDexSurface)
            && (!row.spendable || !isSignerMode),
    );
    // The Wallet Mode screen tells a signer-mode user "Send / receive
    // screens are hidden; this wallet does not broadcast". The bottom bar is
    // the whole navigation below 600px, so leaving Send in the thumb row would
    // break that promise on exactly the device most likely to be the signer.
    const primaryTabs = PRIMARY_TABS.filter((tab) => !tab.spendable || !isSignerMode);
    // Messaging lives behind "More", so any unread inside the sheet also needs a
    // dot on the More tab itself or the user would never see it while collapsed.
    const sheetHasUnread = sheetRows.some((row) => badges[row.id] > 0);
    const activeSheetRow = sheetRows.find((row) => isNavItemActive(row.id, currentView));
    const moreActive = Boolean(activeSheetRow)
        || isNavItemActive('settings', currentView)
        || currentView === 'menu'
        || currentView === 'alerts';

    return (
        <>
            <nav className={styles.bar} aria-label="Bottom navigation">
                {primaryTabs.map((tab) => {
                    const active = !moreActive && isNavItemActive(tab.id, currentView);
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
                    ref={moreTriggerRef}
                    type="button"
                    className={`${styles.tab} ${sheetOpen || moreActive ? styles.tabActive : ''}`}
                    aria-current={moreActive ? 'page' : undefined}
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
                        ref={sheetRef}
                        id="xc-bottom-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-label="More navigation"
                        className={styles.sheet}
                    >
                        <div className={styles.handle} aria-hidden="true" />
                        <ul className={styles.sheetList} role="list">
                            {sheetRows.map((row) => {
                                const active = isNavItemActive(row.id, currentView);
                                return (
                                    <li key={row.id}>
                                        <button
                                            type="button"
                                            className={`${styles.sheetItem} ${active ? styles.sheetItemActive : ''}`}
                                            aria-current={active ? 'page' : undefined}
                                            onClick={() => {
                                                setSheetOpen(false);
                                                onSelect(row.id);
                                            }}
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
                                        onClick={() => {
                                            setSheetOpen(false);
                                            onOpenWalletPicker();
                                        }}
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
                                        onClick={() => {
                                            setSheetOpen(false);
                                            onOpenSettings();
                                        }}
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
                                        onClick={() => {
                                            setSheetOpen(false);
                                            onLock();
                                        }}
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
