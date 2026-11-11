// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { showsBottomBar, showsSidebar } from '../styles/breakpoints.js';
import { useLayoutTier } from '../styles/useLayoutTier.js';
import {
    ROUTE_NAV_GROUPS,
    ROUTE_NAV_SECTIONS,
    SIDEBAR_PRIMARY_DESTINATIONS,
    SIDEBAR_SECONDARY_DESTINATIONS,
} from '../routeRegistry.js';
import { walletMenuRow, walletMenuRowVisible } from '../walletMenu.js';
import { NavSurfaceContext } from './navSurface.js';
import {
    NoticesRouteContext,
    ReachabilityNoticeHiddenContext,
    ReachabilityNoticeWantedContext,
    ReachabilityNoticeReportContext,
    ShellNoticesContext,
    ShellReachabilityNoticeContext,
} from './noticesRoute.js';
// The Button sheet loads first so the nav row rules below win at equal specificity.
import buttonStyles from '../../ui/Button.module.css';
import styles from './LeftNav.module.css';
import { t } from '../../i18n/index.js';
import screenStyles from '../../ui/Screen.module.css';

// Destination rows stand on the shared Button base (ghost, md) and keep the nav row look from .item.
const NAV_ROW_BUTTON = `${buttonStyles.btn} ${buttonStyles.ghost} ${buttonStyles.md} ${styles.item}`;

/**
 * §24.2 / G053: full-layout left navigation. Renders a fixed-width
 * sidebar listing primary surfaces (Home, History, Send, Receive,
 * Scan, DEX, Marketplace, Dispensers, Contracts, Messaging) plus a contacts row,
 * Settings, and Lock. Active row gets
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
 * `currentView` resolves through `ROUTE_NAV_SECTIONS`, so drilldowns keep
 * their parent surface highlighted. Utility sections without a sidebar row
 * leave the sidebar unselected instead of attributing the page to Home.
 */

export const LEFT_NAV_VIEW_GROUPS = ROUTE_NAV_GROUPS;

/** The label and icon row for a nav destination id. */
export const navItem = (id) => {
    const row = walletMenuRow(id);
    if (!row) return undefined;
    return {
        ...row,
        label: t(row.labelKey),
        Icon: Icon[row.icon],
    };
};

export function activeLeftNavItem(currentView) {
    return ROUTE_NAV_SECTIONS[currentView] || 'home';
}

export function isNavItemActive(itemId, currentView) {
    return itemId === activeLeftNavItem(currentView);
}

/**
 * @param {object} props
 * @param {string} props.currentView
 * @param {(view: string) => void} props.onSelect
 * @param {() => void} [props.onLock]
 * @param {() => void} [props.onOpenSettings]
 * @param {() => void} [props.onCommandPalette]   when provided, renders a search row at the top that opens the §33 command palette (Cmd/Ctrl+K); shells with their own header search (web) leave it unset
 * @param {boolean} [props.hasVmAddress] gates the Contracts row (the registry carries DEPLOY in COMMON_ACTIONS, so LTC and DOGE qualify too)
 * @param {boolean} [props.hasDexSurface] false only in a build that compiled the DEX surface out; the tab is then absent, not disabled
 * @param {boolean} [props.isSignerMode] §20 air-gapped signer mode; drops Send + Receive from the nav
 */
export function LeftNav({
    currentView,
    onSelect,
    onLock,
    onOpenSettings,
    onCommandPalette,
    hasVmAddress = false,
    hasDexSurface = true,
    isSignerMode = false,
}) {
    const activeItem = activeLeftNavItem(currentView);
    // Signer mode's own hint promises "Send / receive screens
    // are hidden; this wallet does not broadcast". Absent, not disabled,
    // for the reason the DEX rows are absent: a greyed Send row still
    // reads as a capability the device has, and the whole value of the
    // mode is that an air-gapped user can believe the removal.
    // DEX rows are absent, not greyed, when the build has no DEX surface: the
    // store build compiles those routes out, so the destination does not
    // exist, and a visibly disabled exchange tab asks an app reviewer the
    // same question a working one does.
    // Contracts is gated on a VM address, matching Home and the command
    // palette (DEPLOY sits in COMMON_ACTIONS, so LTC/DOGE carry it).
    const gates = { isSignerMode, hasDexSurface, hasVmAddress };
    const toRows = (ids) => ids
        .map(navItem)
        .filter((item) => item && walletMenuRowVisible(item, gates));
    const primary = toRows(SIDEBAR_PRIMARY_DESTINATIONS);
    const secondary = toRows(SIDEBAR_SECONDARY_DESTINATIONS);
    const settingsItem = navItem('settings');
    const lockItem = navItem('lock');

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
            aria-label={t('components.leftNav.primaryNavigation')}
            onKeyDown={handleKeyDown}
        >
            <div className={styles.brand}>{t('components.leftNav.xchainWallet')}</div>
            {onCommandPalette ? (
                <div className={styles.search}>
                    <Button
                        variant="secondary"
                        block
                        icon={<Icon.SearchIcon />}
                        onClick={onCommandPalette}
                        aria-label={t('components.leftNav.openCommandPalette')}
                        aria-keyshortcuts="Meta+K Control+K"
                        title={t('components.leftNav.searchCmdCtrlK')}
                    >
                        <span className={styles.label}>{t('routes.addressList.search')}</span>
                    </Button>
                </div>
            ) : null}
            {/* Destination rows stay native buttons to preserve full-row navigation semantics. */}
            {/* Safari needs an explicit list role because this class removes list styling. */}
            <ul className={styles.list} role="list">
                {primary.map((item) => {
                    const active = activeItem === item.id;
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${NAV_ROW_BUTTON} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                title={item.label}
                                onClick={() => onSelect(item.id)}
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <item.Icon />
                                </span>
                                <span className={styles.label}>{item.label}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <hr className={styles.divider} />
            {/* Safari needs an explicit list role because this class removes list styling. */}
            <ul className={styles.list} role="list">
                {secondary.map((item) => {
                    const active = activeItem === item.id;
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`${NAV_ROW_BUTTON} ${active ? styles.itemActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                title={item.label}
                                onClick={() => onSelect(item.id)}
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <item.Icon />
                                </span>
                                <span className={styles.label}>{item.label}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className={styles.spacer} />
            <div className={styles.footer}>
                {onOpenSettings ? (
                    <button
                        type="button"
                        className={`${NAV_ROW_BUTTON} ${activeItem === settingsItem.id ? styles.itemActive : ''}`}
                        aria-current={activeItem === settingsItem.id ? 'page' : undefined}
                        title={settingsItem.label}
                        onClick={onOpenSettings}
                    >
                        <span className={styles.icon} aria-hidden="true">
                            <settingsItem.Icon />
                        </span>
                        <span className={styles.label}>{settingsItem.label}</span>
                    </button>
                ) : null}
                {onLock ? (
                    <div className={styles.action}>
                        <Button
                            variant="secondary"
                            block
                            icon={<lockItem.Icon />}
                            title={lockItem.label}
                            onClick={onLock}
                        >
                            <span className={styles.label}>{lockItem.label}</span>
                        </Button>
                    </div>
                ) : null}
            </div>
        </nav>
    );
}

// Moves focus to the page's main region (Screen renders it as #xc-main). A
// plain href="#xc-main" would also work, but the app can run under a hash
// router where an in-page anchor navigates, so focus is moved by hand.
function skipToMain(e) {
    const main = typeof document !== 'undefined' ? document.getElementById('xc-main') : null;
    if (!main) return;
    e.preventDefault();
    main.focus();
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
 * chrome above the route content so it survives route changes, so Home
 * no longer has to mount it itself. It never clips: the header row hosts
 * anchored popovers (the settings gear, the scan menu).
 *
 * The `notices` (queued broadcasts, reachability, update notices) are not
 * toolbar content. They stay mounted here, so their state survives route
 * changes, but render into a detached host that the route's `<Screen>`
 * moves into its scrolling body, below the page header and above the route
 * content (see noticesRoute.js). A route without a Screen shows them in a
 * fallback slot at the top of the route area.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.nav
 * @param {import('react').ReactNode} [props.bottomBar]
 * @param {import('react').ReactNode} [props.header]
 * @param {import('react').ReactNode} [props.notices]
 * @param {string} [props.routeKey]
 * @param {import('react').ReactNode} props.children
 */
export function FullLayoutWithNav({ nav, bottomBar, header, notices, children }) {
    const { routeKey } = arguments[0];
    const [layoutRef, tier] = useLayoutTier();
    const previousRouteKeyRef = useRef(routeKey);
    const sidebar = showsSidebar(tier) ? nav : null;
    const bar = showsBottomBar(tier) ? bottomBar : null;
    // PageHeader reads which surface is on screen to drop a Back control
    // that would duplicate a visible nav row.
    const navSurface = sidebar ? 'sidebar' : (bar ? 'tabBar' : null);

    const [noticesHost] = useState(() => {
        const host = document.createElement('div');
        host.className = styles.notices;
        return host;
    });
    const noticesFallbackRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const noticeSlotsRef = useRef(/** @type {HTMLElement[]} */ ([]));
    const [reachabilityHidden, setReachabilityHidden] = useState(0);
    const [reachabilityWanted, setReachabilityWanted] = useState(0);
    // What the reachability notice says, handed to the route so its page
    // carries the message once.
    const [reachabilityNotice, setReachabilityNotice] = useState(/** @type {any} */ (null));
    const hasNotices = Boolean(notices);
    const routeReachabilityNotice = useMemo(() => (
        hasNotices && reachabilityNotice ? { ...reachabilityNotice, hiddenCount: reachabilityHidden } : null
    ), [hasNotices, reachabilityNotice, reachabilityHidden]);
    // The newest claiming Screen shows the notices; with none, the fallback slot.
    const placeNotices = () => {
        (noticeSlotsRef.current.at(-1) ?? noticesFallbackRef.current)?.appendChild(noticesHost);
    };
    const shellNotices = useMemo(() => (hasNotices ? {
        claim(slot) {
            noticeSlotsRef.current.push(slot);
            placeNotices();
            return () => {
                noticeSlotsRef.current = noticeSlotsRef.current.filter((s) => s !== slot);
                placeNotices();
            };
        },
        setReachabilityHidden,
        setReachabilityWanted,
    } : null), [hasNotices]);

    // Child Screens claim the host in their own layout effects, which run
    // before this one; anything left unclaimed goes to the fallback slot.
    useLayoutEffect(() => {
        if (hasNotices && !noticesHost.parentNode) placeNotices();
    });

    useEffect(() => {
        if (previousRouteKeyRef.current === routeKey) return;
        previousRouteKeyRef.current = routeKey;
        const routeBody = document.querySelector(`.${styles.mainBody}`);
        if (!routeBody) return undefined;
        const focusHeading = () => {
            const heading = routeBody.querySelector('h1');
            if (!heading) return false;
            heading.tabIndex = -1;
            heading.classList.add(styles.routeFocusTarget);
            heading.focus({ preventScroll: true });
            // A heading under an inert overlay refuses focus; the observer
            // below tries again when the route becomes interactive.
            return document.activeElement === heading;
        };
        if (focusHeading()) return undefined;
        const observer = new MutationObserver(() => {
            if (focusHeading()) observer.disconnect();
        });
        observer.observe(routeBody, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
        // The page's own background can lose inert outside routeBody, so the
        // shell root is observed too.
        const shell = routeBody.closest('[data-xc-tier]');
        if (shell) observer.observe(shell, { attributes: true, attributeFilter: ['inert'], subtree: true });
        const stop = setTimeout(() => observer.disconnect(), 3000);
        return () => { clearTimeout(stop); observer.disconnect(); };
    }, [routeKey]);

    return (
        <div
            ref={layoutRef}
            data-xc-tier={tier}
            // Marks a visible rail, whose Search makes a search-only header menu redundant.
            data-xc-rail={sidebar ? 'shown' : undefined}
            className={`${styles.layout} ${bar ? styles.layoutWithBottomBar : ''}`}
        >
            <a href="#xc-main" className={styles.skipLink} onClick={skipToMain}>{t('components.leftNav.skipToMainContent')}</a>
            {sidebar ? <aside className={styles.sidebar}>{sidebar}</aside> : null}
            <div className={styles.main}>
                {header ? (
                    <NavSurfaceContext.Provider value={navSurface}>
                        <div className={styles.header}>{header}</div>
                    </NavSurfaceContext.Provider>
                ) : null}
                {hasNotices ? createPortal(
                    <NoticesRouteContext.Provider value={routeKey ?? null}>
                        <ReachabilityNoticeHiddenContext.Provider value={reachabilityHidden > 0}>
                            <ReachabilityNoticeWantedContext.Provider value={reachabilityWanted > 0}>
                                <ReachabilityNoticeReportContext.Provider value={setReachabilityNotice}>
                                    {notices}
                                </ReachabilityNoticeReportContext.Provider>
                            </ReachabilityNoticeWantedContext.Provider>
                        </ReachabilityNoticeHiddenContext.Provider>
                    </NoticesRouteContext.Provider>,
                    noticesHost,
                ) : null}
                <div className={styles.mainBody}>
                    {hasNotices ? <div ref={noticesFallbackRef} className={screenStyles.noticesFallback} /> : null}
                    <NavSurfaceContext.Provider value={navSurface}>
                        <ShellNoticesContext.Provider value={shellNotices}>
                            <ShellReachabilityNoticeContext.Provider value={routeReachabilityNotice}>
                                {children}
                            </ShellReachabilityNoticeContext.Provider>
                        </ShellNoticesContext.Provider>
                    </NavSurfaceContext.Provider>
                </div>
            </div>
            {bar ? <div className={styles.bottomBarSlot}>{bar}</div> : null}
        </div>
    );
}
