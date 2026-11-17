// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { showsBottomBar, showsSidebar } from '../styles/breakpoints.js';
import { useLayoutTier } from '../styles/useLayoutTier.js';
import {
    SIDE_MENU_FALLBACK_WIDTH_PX,
    SIDE_MENU_KEY_STEP_PX,
    SIDE_MENU_SNAP_TO_ICONS_PX,
    SideMenuContext,
    clampSideMenuExtra,
    sideMenuExtraCeiling,
    stepSideMenuState,
    useSideMenu,
} from '../hooks/useSideMenu.js';
import {
    ROUTE_NAV_GROUPS,
    ROUTE_NAV_SECTIONS,
    SIDEBAR_NAV_GROUPS,
} from '../routeRegistry.js';
import {
    walletLockAction, walletMenuRow, walletMenuRowLabel, walletMenuRowVisible,
} from '../walletMenu.js';
import { NavSurfaceContext } from './navSurface.js';
import { CollapseHandle } from './CollapseHandle.jsx';
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
/** The icon rail's width (the CSS draws it); the resize edge's smallest value. */
const SIDE_MENU_ICONS_WIDTH_PX = 64;

const NAV_ROW_BUTTON = `${buttonStyles.btn} ${buttonStyles.ghost} ${buttonStyles.md} ${styles.item}`;

/**
 * §24.2 / G053 / G100: the side menu, the wide layouts' left navigation.
 * Lists grouped primary surfaces (Wallet, Trade, Network, Build and Social), then
 * Settings and Lock behind the footer border. Active row gets
 * `aria-current="page"`.
 *
 * Some rows are conditional on the wallet, not the build. In particular,
 * `isSignerMode` (§20) removes Send and Receive, because an air-gapped
 * signer wallet promises exactly that when the user picks that mode at
 * create, import or pair.
 *
 * Visibility is the parent's responsibility: this component renders
 * itself unconditionally. `<FullLayoutWithNav>` decides whether the
 * side menu shows at all (compact tier hands the slot to the bottom tab
 * bar instead) and in which of its three states (G100: collapsed, icons,
 * full). In the icons state, and always on the `rail` tier below 900px,
 * the rows show only their icons, with the labels clipped but still in the
 * accessibility tree and repeated as the tooltip. See
 * shared/styles/breakpoints.js for the tier definitions.
 *
 * `currentView` resolves through `ROUTE_NAV_SECTIONS`, so drilldowns keep
 * their parent surface highlighted. Utility sections without a sidebar row
 * leave the sidebar unselected instead of attributing the page to Home.
 */

export const LEFT_NAV_VIEW_GROUPS = ROUTE_NAV_GROUPS;

/** The label and icon row for a nav destination id. */
export const navItem = (id) => {
    // Lock wallet is not a menu row (it is a header button there), but the
    // side nav keeps its own Lock row.
    const row = id === 'lock' ? walletLockAction() : walletMenuRow(id);
    if (!row) return undefined;
    const sidebarLabelKeys = {
        markets: 'components.leftNav.exchangeDex',
        'my-tokens': 'components.leftNav.myTokens',
        'governance-polls': 'components.leftNav.governance',
        'bet-markets': 'components.leftNav.bettingMarkets',
    };
    const labelKey = sidebarLabelKeys[id] || row.labelKey;
    return {
        ...row,
        labelKey,
        label: sidebarLabelKeys[id]
            ? t(sidebarLabelKeys[id])
            : id === 'lock'
                ? row.label
                : walletMenuRowLabel(id),
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
 * @param {boolean} [props.hasBtcAddress] gates the Staking row
 * @param {boolean} [props.hasGovernanceAddress] gates the Governance row
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
    hasBtcAddress = false,
    hasGovernanceAddress = false,
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
    const gates = {
        isSignerMode,
        hasDexSurface,
        hasVmAddress,
        hasBtcAddress,
        hasGovernanceAddress,
    };
    const toRows = (ids) => ids
        .map(navItem)
        .filter((item) => item && walletMenuRowVisible(item, gates));
    const groups = SIDEBAR_NAV_GROUPS
        .map((group) => ({
            ...group,
            label: t(group.labelKey),
            rows: toRows(group.destinations),
        }))
        .filter((group) => group.rows.length > 0);
    const settingsItem = navItem('settings');
    const lockItem = navItem('lock');
    // G100: the menu's edge does the work (operator 2026-11-13): its tab
    // hides and shows the menu, and dragging the edge snaps between icons and
    // names. The footer carries no menu-size rows.
    const sideMenu = useContext(SideMenuContext);

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
            <div className={styles.groups}>
                {groups.map((group, index) => (
                    <div key={group.id}>
                        {index > 0 ? <hr className={styles.groupDivider} /> : null}
                        <div className={styles.groupLabel}>{group.label}</div>
                        {/* Safari needs an explicit list role because this class removes list styling. */}
                        <ul className={styles.list} role="list" aria-label={group.label}>
                            {group.rows.map((item) => {
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
                    </div>
                ))}
            </div>
            <div className={styles.spacer} />
            <div className={styles.footer}>
                {/* Safari needs an explicit list role because this class removes list styling. */}
                <ul className={styles.list} role="list" aria-label={t('components.leftNav.footerActions')}>
                    {onOpenSettings ? (
                        <li>
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
                        </li>
                    ) : null}
                    {onLock ? (
                        <li>
                            <button
                                type="button"
                                className={NAV_ROW_BUTTON}
                                title={lockItem.label}
                                onClick={onLock}
                                data-xc-lock-row=""
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <lockItem.Icon />
                                </span>
                                <span className={styles.label}>{lockItem.label}</span>
                            </button>
                        </li>
                    ) : null}
                </ul>
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

const SIDE_MENU_ID = 'xc-side-menu';

/** +1 when screen-right is "wider" for the menu, -1 in a right-to-left layout. */
function inlineSign(el) {
    try {
        return el && globalThis.getComputedStyle?.(el).direction === 'rtl' ? -1 : 1;
    } catch {
        return 1;
    }
}

/**
 * G100: the side menu's edge controls, mirrored from the Prometheus
 * dashboard's sidebar (a chevron tab riding the menu's edge that collapses
 * and restores it, and a resize strip on the same edge). The wallet adds the
 * third state and keyboard support: the tab is a real button (Enter/Space
 * collapses or restores, Left/Right step through collapsed, icons and full),
 * and the strip is a focusable `separator` (Left/Right resize, Shift for
 * larger steps, Home/End to the minimum and maximum, Enter or a double-click
 * back to the default width).
 */
function SideMenuEdge({
    state,
    widest,
    defaultWidth,
    extra,
    extraCeiling,
    onSetState,
    onToggleCollapsed,
    onDrag,
    onDragEnd,
    onResetWidth,
}) {
    const collapsed = state === 'collapsed';
    const handleLabel = t(collapsed ? 'components.leftNav.showSideMenu' : 'components.leftNav.hideSideMenu');
    const dragRef = useRef(/** @type {null | { x: number, start: number, sign: number, raw: number }} */ (null));

    const onHandleKeyDown = (event) => {
        const towardWider = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!towardWider) return;
        event.preventDefault();
        const direction = towardWider * inlineSign(event.currentTarget);
        // Where only icons fit (the rail tier), opening restores the saved
        // open state, as a click does, so a saved Full survives for wide windows.
        if (collapsed && direction > 0) {
            onToggleCollapsed();
            return;
        }
        const next = stepSideMenuState(state, direction, widest);
        if (next !== state) onSetState(next);
    };

    const setExtraFromKey = (event) => {
        const step = SIDE_MENU_KEY_STEP_PX * (event.shiftKey ? 4 : 1);
        const towardWider = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        // Icons: wider snaps to names; Full at its narrowest: narrower snaps to icons.
        if (towardWider && state === 'icons') {
            if (towardWider * inlineSign(event.currentTarget) > 0) { event.preventDefault(); onSetState('full'); }
            return;
        }
        if (towardWider && state === 'full' && extra === 0 && towardWider * inlineSign(event.currentTarget) < 0) {
            event.preventDefault();
            onSetState('icons');
            return;
        }
        let next = null;
        if (towardWider) next = extra + step * towardWider * inlineSign(event.currentTarget);
        else if (event.key === 'Home' || event.key === 'Enter') next = 0;
        else if (event.key === 'End') next = extraCeiling;
        if (next === null) return;
        event.preventDefault();
        if (next === 0) onResetWidth();
        else onDragEnd(clampSideMenuExtra(next, extraCeiling));
    };

    const onPointerDown = (event) => {
        if (event.button) return;
        event.preventDefault();
        const target = event.currentTarget;
        // The drag follows the pointer as a menu width and snaps live, both
        // ways, in one drag (operator 2026-11-13): Icons turns Full once the
        // edge is pulled the snap distance past the rail, and Full turns
        // Icons once pushed the snap distance inside its narrowest width.
        const startWidth = state === 'icons' ? SIDE_MENU_ICONS_WIDTH_PX : defaultWidth + extra;
        dragRef.current = { x: event.clientX, sign: inlineSign(target), mode: state, extra };
        try { target.setPointerCapture?.(event.pointerId); } catch { /* capture is a nicety */ }
        const move = (e) => {
            const drag = dragRef.current;
            if (!drag) return;
            const width = startWidth + (e.clientX - drag.x) * drag.sign;
            if (drag.mode === 'icons') {
                if (width > SIDE_MENU_ICONS_WIDTH_PX + SIDE_MENU_SNAP_TO_ICONS_PX) {
                    drag.mode = 'full';
                    drag.extra = clampSideMenuExtra(width - defaultWidth, extraCeiling);
                    onSetState('full');
                    if (drag.extra > 0) onDrag(drag.extra);
                }
                return;
            }
            if (width < defaultWidth - SIDE_MENU_SNAP_TO_ICONS_PX) {
                drag.mode = 'icons';
                drag.extra = 0;
                onSetState('icons');
                return;
            }
            drag.extra = clampSideMenuExtra(width - defaultWidth, extraCeiling);
            onDrag(drag.extra);
        };
        // On the window, so a pointer that outruns the strip keeps resizing
        // where capture is unavailable; captured events bubble here too.
        const up = () => {
            const drag = dragRef.current;
            dragRef.current = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            // The state already snapped while dragging; Full keeps its width.
            if (drag?.mode === 'full') onDragEnd(drag.extra);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    };

    return (
        <div className={styles.sideMenuEdge}>
            {state !== 'collapsed' ? (
                <div
                    role="separator"
                    tabIndex={0}
                    className={styles.sideMenuResizer}
                    aria-orientation="vertical"
                    aria-controls={SIDE_MENU_ID}
                    aria-label={t('components.leftNav.resizeSideMenu')}
                    aria-valuemin={SIDE_MENU_ICONS_WIDTH_PX}
                    aria-valuemax={defaultWidth + extraCeiling}
                    aria-valuenow={state === 'icons' ? SIDE_MENU_ICONS_WIDTH_PX : defaultWidth + extra}
                    title={t('components.leftNav.resizeSideMenuHint')}
                    onKeyDown={setExtraFromKey}
                    onDoubleClick={onResetWidth}
                    onPointerDown={onPointerDown}
                />
            ) : null}
            {/* The shared collapse handle (wide Home's overview divider wears
                the same one); this sheet only places it on the edge. */}
            <CollapseHandle
                orientation="vertical"
                collapsed={collapsed}
                className={styles.sideMenuHandle}
                aria-controls={SIDE_MENU_ID}
                aria-label={handleLabel}
                aria-keyshortcuts="ArrowLeft ArrowRight"
                title={handleLabel}
                onClick={onToggleCollapsed}
                onKeyDown={onHandleKeyDown}
            />
        </div>
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

    // G100: the side menu's state. Names can show at any width with a side
    // menu (operator 2026-11-13); a rail-width window (an iPad) keeps its own
    // open choice, icons by default, so a wide window's Full never carries over.
    const sideMenu = useSideMenu();
    const onRail = tier === 'rail';
    const widestState = 'full';
    const openState = onRail ? sideMenu.railOpen : stepSideMenuState(sideMenu.state, 0, widestState);
    const menuState = sidebar
        ? (sideMenu.state === 'collapsed' ? 'collapsed' : openState)
        : null;
    const setOpenState = (next) => {
        if (next === 'collapsed') sideMenu.setState('collapsed');
        else if (onRail) sideMenu.setRailOpen(next);
        else sideMenu.setState(next);
    };
    const asideRef = useRef(/** @type {HTMLElement | null} */ (null));
    const [layoutWidth, setLayoutWidth] = useState(0);
    const [defaultWidth, setDefaultWidth] = useState(SIDE_MENU_FALLBACK_WIDTH_PX);
    const [dragExtra, setDragExtra] = useState(/** @type {number | null} */ (null));
    // Transitions switch on only after the first frame, so the saved state
    // paints in place on load instead of animating in (Prometheus sb-anim).
    const [animate, setAnimate] = useState(false);
    const extraCeiling = sideMenuExtraCeiling(layoutWidth, defaultWidth);
    const appliedExtra = menuState === 'full'
        ? clampSideMenuExtra(dragExtra ?? sideMenu.extra, extraCeiling)
        : 0;

    useLayoutEffect(() => {
        const el = layoutRef.current;
        if (!el) return undefined;
        const measure = () => setLayoutWidth(el.getBoundingClientRect?.().width || 0);
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [layoutRef]);

    // The full menu's default width is what its widest row needs (CSS
    // max-content); the applied extra rides on top of it, so the default is
    // the measured width less that extra. No layout engine measures 0 and
    // keeps the fallback.
    useLayoutEffect(() => {
        if (menuState !== 'full') return;
        const measured = asideRef.current?.getBoundingClientRect?.().width || 0;
        const natural = Math.round(measured - appliedExtra);
        if (natural > 0) setDefaultWidth((prev) => (prev === natural ? prev : natural));
    });

    useEffect(() => {
        if (typeof requestAnimationFrame !== 'function') return undefined;
        const frame = requestAnimationFrame(() => setAnimate(true));
        return () => globalThis.cancelAnimationFrame?.(frame);
    }, []);

    const sideMenuContext = useMemo(() => (menuState && menuState !== 'collapsed' ? {
        state: menuState,
    } : null), [menuState]);

    // PageHeader reads which surface is on screen to drop a Back control
    // that would duplicate a visible nav row; a collapsed menu shows none.
    const navSurface = sidebar && menuState !== 'collapsed' ? 'sidebar' : (bar ? 'tabBar' : null);

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
            // A rail-width window showing names lays out as the full tier.
            data-xc-tier={onRail && menuState === 'full' ? 'full' : tier}
            // Marks a visible rail, whose Search makes a search-only header menu redundant.
            data-xc-rail={sidebar ? 'shown' : undefined}
            data-xc-side-menu={menuState ?? undefined}
            data-xc-side-menu-motion={sidebar && animate && dragExtra === null ? 'on' : undefined}
            data-xc-side-menu-drag={dragExtra !== null ? 'on' : undefined}
            className={`${styles.layout} ${bar ? styles.layoutWithBottomBar : ''}`}
            style={sidebar ? { '--xc-side-menu-extra': `${appliedExtra}px` } : undefined}
        >
            <a href="#xc-main" className={styles.skipLink} onClick={skipToMain}>{t('components.leftNav.skipToMainContent')}</a>
            {/* Collapsed, the zero-width menu has its rows unmounted, so only
                the edge handle stays in the tab order. */}
            {sidebar ? (
                <aside id={SIDE_MENU_ID} ref={asideRef} className={styles.sidebar}>
                    {menuState !== 'collapsed' ? (
                        <SideMenuContext.Provider value={sideMenuContext}>{sidebar}</SideMenuContext.Provider>
                    ) : null}
                </aside>
            ) : null}
            {sidebar ? (
                <SideMenuEdge
                    state={menuState}
                    widest={widestState}
                    defaultWidth={defaultWidth}
                    extra={appliedExtra}
                    extraCeiling={extraCeiling}
                    onSetState={(next) => { setDragExtra(null); setOpenState(next); }}
                    onToggleCollapsed={sideMenu.toggleCollapsed}
                    onDrag={setDragExtra}
                    onDragEnd={(px) => { setDragExtra(null); sideMenu.setExtra(px); }}
                    onResetWidth={() => { setDragExtra(null); sideMenu.resetWidth(); }}
                />
            ) : null}
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
