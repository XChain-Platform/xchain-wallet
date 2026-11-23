// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33 Command Palette (Cmd-K). A modal launcher over the wallet's actions
// and destinations. This component is deliberately pure: it takes a flat
// `commands` array (each with its own `run` closure supplied by the shell)
// and owns only the query, selection, and keyboard behaviour. All
// navigation / side effects live in the closures, so the palette is
// shell-agnostic and unit-testable without a router.
//
// Keyboard (§33.4):
//   ↑ / ↓    move the selection through the flat result list (wrapping)
//   Enter    run the selected command and close
//   Tab      stays within the modal search control
//   Esc      close
// The search input keeps focus while the palette is active, so the arrow keys
// drive an `aria-activedescendant` selection rather than roving DOM focus.

import {
    useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { Button, Icon } from '../../ui/index.js';
import buttonStyles from '../../ui/Button.module.css';
import { categoryLabel, COMMAND_CATEGORIES } from './commandRegistry.js';
import { filterCommands } from './fuzzyMatch.js';
import styles from './CommandPalette.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap } from '../utils/focusTrap.js';
import { t } from '../../i18n/index.js';
import { visibleWalletMenu, walletLockAction } from '../walletMenu.js';
import { TIER_RAIL_MIN_PX } from '../styles/breakpoints.js';
import '../../i18n/locales/en/commandPalette.js';
import '../../i18n/locales/en/walletMenu.js';
import '../../i18n/locales/en/pwaInstall.js';

const MENU_SEARCH_GROUPS = [
    'Suggested',
    'Menu',
    'In Settings',
    'In All actions',
    ...COMMAND_CATEGORIES.filter((category) => ![
        'Suggested', 'Recent', 'Create', 'Trade', 'Sign',
    ].includes(category)),
];

const CATALOGUE_SEARCH_GROUPS = new Set(['Menu', 'In Settings', 'In All actions']);

const commandSearchGroup = (command) => command.searchGroup || command.category;

function orderMenuSearchResults(results, commands, query = '') {
    const sourceOrder = new Map(commands.map((command, index) => [command.id, index]));
    // Inside the Menu group a label that starts with the query leads, so
    // "sign" opens on Sign message rather than an earlier box's Multisig signing.
    const needle = query.trim().toLowerCase();
    const leads = (command) => (needle && String(command.searchTitle || command.title || '').toLowerCase().startsWith(needle) ? 0 : 1);
    const groupOrder = new Map(MENU_SEARCH_GROUPS.map((group, index) => [group, index]));
    let nextGroup = groupOrder.size;
    for (const command of results) {
        const group = commandSearchGroup(command);
        if (!groupOrder.has(group)) {
            groupOrder.set(group, nextGroup);
            nextGroup += 1;
        }
    }
    return results
        .map((command, rank) => ({ command, rank }))
        .sort((a, b) => {
            const aGroup = commandSearchGroup(a.command);
            const bGroup = commandSearchGroup(b.command);
            const groupDifference = groupOrder.get(aGroup) - groupOrder.get(bGroup);
            if (groupDifference) return groupDifference;
            if (aGroup === bGroup && CATALOGUE_SEARCH_GROUPS.has(aGroup)) {
                const leadDifference = aGroup === 'Menu' ? leads(a.command) - leads(b.command) : 0;
                if (leadDifference) return leadDifference;
                return (sourceOrder.get(a.command.id) ?? a.rank)
                    - (sourceOrder.get(b.command.id) ?? b.rank);
            }
            return a.rank - b.rank;
        })
        .map(({ command }) => command);
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('./fuzzyMatch.js').Command[]} props.commands
 * @param {string} [props.placeholder]
 * @param {(query: string) => import('./fuzzyMatch.js').Command[]} [props.parseQuery]
 *        §33.3: turns the raw query into free-form intent commands (e.g.
 *        "send 100 MYTOKEN"). Their results are prepended above the fuzzy
 *        matches, so a recognized intent is the pre-selected top result.
 * @param {{
 *   gates: { isSignerMode?: boolean, hasDexSurface?: boolean, hasVmAddress?: boolean, hasBtcAddress?: boolean },
 *   currentView?: string,
 *   onSelect: (viewId: string) => void,
 *   onOpenSettings: () => void,
 *   onLock?: () => void,
 *   onOpenPopup?: () => void,
 *   onOpenSidebar?: () => void,
 *   onOpenFullScreen?: () => void,
 *   onInstall?: () => void | Promise<void>,
 * }} [props.menu]
 *        onOpenPopup, onOpenSidebar and onOpenFullScreen are the extension's
 *        view switches; each shows as a header button only when the shell
 *        passes it.
 * @param {boolean} [props.focusSearch=true]  with a menu, false opens with the
 *        menu's scroll surface focused instead of the search field, so a
 *        click on the menu button can scroll the menu at once; typing a
 *        character still goes to search.
 */
export function CommandPalette({
    open, onClose, commands, placeholder, parseQuery, menu, focusSearch = true,
}) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [walletKeyboardFocus, setWalletKeyboardFocus] = useState(false);
    const [recentCommandIds, setRecentCommandIds] = useState(/** @type {string[]} */ ([]));
    // The system Back gesture closes this before it leaves the screen.
    useBackHandler(open ? onClose : undefined);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const listRef = useRef(/** @type {HTMLElement | null} */ (null));
    const dialogRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [wideMenu, setWideMenu] = useState(false);
    const surfaceFirst = Boolean(menu) && !focusSearch;
    useFocusTrap(dialogRef, { active: open, initialFocusRef: surfaceFirst ? listRef : inputRef });

    const walletGroups = menu ? visibleWalletMenu(menu.gates) : [];
    const walletRows = walletGroups.flatMap((group) => group.rows);
    // Lock wallet is a header button, so arrow keys cover the grid rows only.
    const walletSelectableRows = walletRows;
    const lockAction = menu?.onLock ? walletLockAction() : null;
    const trimmedQuery = (query || '').trim();
    const showingWalletMenu = Boolean(menu) && !trimmedQuery;
    const currentWalletIndex = menu
        ? walletSelectableRows.findIndex((row) => row.id === menu.currentView)
        : 0;
    const currentWalletIndexRef = useRef(currentWalletIndex);
    currentWalletIndexRef.current = currentWalletIndex;

    const results = useMemo(() => {
        const base = filterCommands(commands || [], query, {
            respectSearchOnlyTitle: Boolean(menu),
        });
        const q = (query || '').trim();
        if (!q) {
            if (menu) return [];
            // Resolve IDs against the current catalogue so recent rows always
            // use fresh route closures and disappear when their command does.
            const commandById = new Map(base.map((command) => [command.id, command]));
            const recent = recentCommandIds
                .map((id) => commandById.get(id))
                .filter(Boolean)
                .map((command) => ({ ...command, category: 'Recent' }));
            if (recent.length === 0) return base;
            const recentIds = new Set(recent.map((command) => command.id));
            return [...recent, ...base.filter((command) => !recentIds.has(command.id))];
        }
        const freeform = typeof parseQuery === 'function' ? (parseQuery(q) || []) : [];
        const combined = freeform.length ? [...freeform, ...base] : base;
        return menu ? orderMenuSearchResults(combined, commands || [], q) : combined;
    }, [commands, query, parseQuery, recentCommandIds, menu]);

    // Reset before paint so input arriving as the palette appears cannot be
    // overwritten by a later effect. Re-opens still start from a clean slate.
    useLayoutEffect(() => {
        if (!open) return;
        setQuery('');
        setActiveIndex(currentWalletIndexRef.current);
        setWalletKeyboardFocus(false);
    }, [open]);

    useLayoutEffect(() => {
        if (!open || !menu) {
            setWideMenu(false);
            return undefined;
        }
        const element = dialogRef.current;
        const measure = () => {
            const containerWidth = element?.getBoundingClientRect?.().width || 0;
            const viewportWidth = typeof window === 'undefined'
                ? 0
                : (window.innerWidth || document.documentElement?.clientWidth || 0);
            setWideMenu((containerWidth || viewportWidth) >= TIER_RAIL_MIN_PX);
        };
        measure();
        if (element && typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(measure);
            observer.observe(element);
            return () => observer.disconnect();
        }
        if (typeof window === 'undefined') return undefined;
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [open, menu]);

    useEffect(() => {
        if (!open) return;
        // Focus after paint so the input exists in the DOM.
        const id = requestAnimationFrame(() => (surfaceFirst ? listRef : inputRef).current?.focus());
        return () => cancelAnimationFrame(id);
    }, [open, surfaceFirst]);

    // Escape closes the palette wherever focus sits, as ShortcutHelp does. It
    // was handled on the search input alone, so a click on the panel's
    // heading, padding or Esc hint moved focus to the page and Escape stopped
    // closing it.
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const selectionCount = showingWalletMenu ? walletSelectableRows.length : results.length;

    // Keep the selection in range as the visible row set changes.
    useEffect(() => {
        setActiveIndex((i) => (selectionCount === 0 ? 0 : Math.min(i, selectionCount - 1)));
    }, [selectionCount]);

    // Scroll the selected row into view when it moves off-screen.
    useEffect(() => {
        if (!open) return;
        const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex, open]);

    if (!open) return null;

    const runCommandAt = (index) => {
        const command = results[index];
        if (!command) return;
        // Synthetic free-form commands are query-specific and do not exist in
        // the catalogue on the next open, so only catalogue rows become recent.
        if ((commands || []).some((candidate) => candidate.id === command.id)) {
            setRecentCommandIds((ids) => [
                command.id,
                ...ids.filter((id) => id !== command.id),
            ].slice(0, 5));
        }
        // Close first so a command that navigates doesn't render behind an
        // open palette for a frame.
        onClose();
        command.run();
    };

    const selectWalletRow = (row) => {
        if (!row || !menu) return;
        onClose();
        if (row.id === 'settings') menu.onOpenSettings();
        else menu.onSelect(row.id);
    };

    const runAt = (index) => {
        if (showingWalletMenu) selectWalletRow(walletSelectableRows[index]);
        else runCommandAt(index);
    };

    // Left/Right step to the nearest row in the adjacent box column, by
    // rendered position, so any column count (2 to 6) navigates the same way.
    // Returns null when there is no row that way (or no layout, as in jsdom).
    const neighbourAcross = (direction) => {
        const rows = Array.from(listRef.current?.querySelectorAll('[data-index]') || []);
        const current = rows.find((el) => Number(el.getAttribute('data-index')) === activeIndex);
        if (!current) return null;
        const from = current.getBoundingClientRect();
        let best = null;
        let bestScore = Infinity;
        for (const el of rows) {
            if (el === current) continue;
            const box = el.getBoundingClientRect();
            const dx = (box.left - from.left) * direction;
            if (dx <= 1) continue;
            const dy = Math.abs(box.top - from.top);
            const score = dy * 1000 + dx;
            if (score < bestScore) {
                bestScore = score;
                best = Number(el.getAttribute('data-index'));
            }
        }
        return best;
    };

    // A printable key on the focused menu surface starts a search: focus moves
    // to the field before the key's default action, so the character lands there.
    const onSurfaceKeyDown = (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
        inputRef.current?.focus();
    };

    const onKeyDown = (e) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setWalletKeyboardFocus(true);
                setActiveIndex((i) => (selectionCount === 0 ? 0 : (i + 1) % selectionCount));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setWalletKeyboardFocus(true);
                setActiveIndex((i) => (selectionCount === 0
                    ? 0
                    : (i <= 0 ? selectionCount - 1 : i - 1)));
                break;
            case 'ArrowLeft':
            case 'ArrowRight': {
                // Only the empty-query menu is two-dimensional; in a text
                // query the arrows keep moving the caret.
                if (!showingWalletMenu) break;
                const next = neighbourAcross(e.key === 'ArrowRight' ? 1 : -1);
                if (next !== null) {
                    e.preventDefault();
                    setWalletKeyboardFocus(true);
                    setActiveIndex(next);
                }
                break;
            }
            case 'Enter':
                e.preventDefault();
                runAt(activeIndex);
                break;
            default:
                break;
        }
    };

    // Group consecutive results by category for the rendered section
    // headers, while keeping the flat index each row carries for selection.
    const groups = [];
    let flatIndex = 0;
    for (const command of results) {
        const category = menu ? commandSearchGroup(command) : command.category;
        let group = groups[groups.length - 1];
        if (!group || group.category !== category) {
            group = { category, rows: [] };
            groups.push(group);
        }
        group.rows.push({ command, index: flatIndex });
        flatIndex += 1;
    }

    const activeId = showingWalletMenu
        ? (walletSelectableRows[activeIndex]
            ? `xc-wallet-menu-${walletSelectableRows[activeIndex].id}`
            : undefined)
        : (results[activeIndex] ? `xc-cmd-${results[activeIndex].id}` : undefined);

    const updateQuery = (value) => {
        setQuery(value);
        setActiveIndex(value.trim() ? 0 : currentWalletIndex);
    };

    const searchControl = (
        <div className={styles.searchRow}>
            {/* The icon sits inside the field, as on Home's filter search. */}
            <span className={styles.searchField}>
                <span className={styles.searchIcon} aria-hidden="true">
                    <Icon.SearchIcon />
                </span>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus -- palette
                    is a transient modal; focusing search is the whole point */}
                <input
                    ref={inputRef}
                    type="search"
                    enterKeyHint="search"
                    autoCapitalize="off"
                    className={styles.input}
                    value={query}
                    onChange={(e) => updateQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder || (menu
                        ? t('walletMenu.search')
                        : t('commandPalette.commandPalette.searchActionsTokensContacts'))}
                    aria-label={t('commandPalette.commandPalette.searchCommands')}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="xc-cmd-listbox"
                    aria-activedescendant={activeId}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            </span>
            <kbd className={styles.escHint} aria-hidden="true">
                {menu
                    ? t('commandPalette.commandPalette.shortcut')
                    : t('commandPalette.commandPalette.esc')}
            </kbd>
        </div>
    );

    const closeButton = (
        <span className={styles.close}>
            <Button
                variant="secondary"
                size="md"
                icon={<Icon.XIcon />}
                onClick={onClose}
                aria-label={menu
                    ? t('walletMenu.closeMenu')
                    : t('commandPalette.commandPalette.closeCommandPalette')}
                tabIndex={menu && !wideMenu ? 0 : -1}
            />
        </span>
    );

    // Plain icon button left of Close, normal icon colour (not a danger row).
    const lockButton = lockAction ? (
        <span className={styles.lock}>
            <Button
                variant="secondary"
                size="md"
                icon={<Icon.LockIcon />}
                onClick={() => { onClose(); menu.onLock(); }}
                aria-label={lockAction.label}
                data-wallet-menu-lock=""
            />
        </span>
    ) : null;

    // The extension's view switches sit left of Lock: search, Open as popup,
    // Open in sidebar, Open full screen, Lock, Close, each view offering the
    // two it is not (operator 2026-11-22). The opener runs first, inside the
    // click, since the browser opens a side panel or the toolbar popup only
    // during a user gesture.
    const viewButton = (handler, label, ButtonIcon, attr) => (handler ? (
        <span className={styles.viewSwitch}>
            <Button
                variant="secondary"
                size="md"
                icon={<ButtonIcon />}
                onClick={() => { handler(); onClose(); }}
                aria-label={label}
                title={label}
                {...{ [attr]: '' }}
            />
        </span>
    ) : null);
    const installButton = viewButton(menu?.onInstall, t('pwaInstall.installApp'), Icon.DownloadIcon, 'data-wallet-menu-install');
    const popupButton = viewButton(menu?.onOpenPopup, t('walletMenu.openPopup'), Icon.PopupWindowIcon, 'data-wallet-menu-popup');
    const sidebarButton = viewButton(menu?.onOpenSidebar, t('walletMenu.openSidebar'), Icon.SidebarIcon, 'data-wallet-menu-sidebar');
    const fullScreenButton = viewButton(menu?.onOpenFullScreen, t('walletMenu.openFullScreen'), Icon.MaximizeIcon, 'data-wallet-menu-full-screen');

    const walletButtonClass = `${buttonStyles.btn} ${buttonStyles.rowAction} ${buttonStyles.md}`;

    return (
        <div
            ref={dialogRef}
            className={`${styles.overlay} ${menu ? styles.menuOverlay : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="xc-command-surface-title"
            data-wallet-menu={menu ? '' : undefined}
            onMouseDown={onClose}
        >
            <div
                className={`${styles.panel} ${menu ? styles.menuPanel : ''}`}
                role="presentation"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <h2 id="xc-command-surface-title" className={styles.visuallyHidden}>
                    {menu
                        ? t('walletMenu.menu')
                        : t('commandPalette.commandPalette.commandPalette')}
                </h2>
                {menu ? (
                    <header className={styles.menuHeader}>
                        {searchControl}
                        <div className={styles.menuActions}>
                            {installButton}
                            {popupButton}
                            {sidebarButton}
                            {fullScreenButton}
                            {lockButton}
                            {closeButton}
                        </div>
                    </header>
                ) : (
                    <>
                        <header className={styles.header}>
                            <span className={styles.handle} aria-hidden="true" />
                            <h2 className={styles.title} aria-hidden="true">
                                {t('commandPalette.commandPalette.commandPalette')}
                            </h2>
                            {closeButton}
                        </header>
                        {searchControl}
                    </>
                )}
                {showingWalletMenu ? (
                    <div
                        ref={listRef}
                        className={styles.walletSurface}
                        tabIndex={-1}
                        onKeyDown={onSurfaceKeyDown}
                    >
                        <div
                            id="xc-cmd-listbox"
                            className={styles.walletGrid}
                            role="listbox"
                            aria-label={t('commandPalette.commandPalette.commands')}
                        >
                            {walletGroups.map((group) => (
                                <section
                                    key={group.id}
                                    className={styles.walletGroup}
                                    data-wallet-menu-group={group.id}
                                    role="group"
                                    aria-labelledby={`xc-wallet-menu-group-${group.id}`}
                                >
                                    {/* A listbox group holds only options, so the visible heading is
                                        hidden from the accessibility tree and names the group through
                                        aria-labelledby instead. */}
                                    <div
                                        id={`xc-wallet-menu-group-${group.id}`}
                                        className={styles.walletGroupHead}
                                        aria-hidden="true"
                                    >
                                        {group.label}
                                    </div>
                                    <ul className={styles.walletGroupList} role="presentation">
                                        {group.rows.map((row) => {
                                            const index = walletRows.findIndex((item) => item.id === row.id);
                                            const selected = index === activeIndex;
                                            const current = row.id === menu.currentView;
                                            const RowIcon = Icon[row.icon];
                                            return (
                                                <li key={row.id} role="presentation">
                                                    <button
                                                        id={`xc-wallet-menu-${row.id}`}
                                                        type="button"
                                                        tabIndex={-1}
                                                        data-index={index}
                                                        data-wallet-menu-row={row.id}
                                                        data-wallet-menu-keyboard-focused={selected && walletKeyboardFocus ? '' : undefined}
                                                        className={`${walletButtonClass} ${styles.walletRow} ${current ? styles.walletRowActive : ''}`}
                                                        role="option"
                                                        aria-selected={selected}
                                                        aria-current={current ? 'page' : undefined}
                                                        onMouseMove={() => {
                                                            setWalletKeyboardFocus(false);
                                                            setActiveIndex(index);
                                                        }}
                                                        onClick={() => selectWalletRow(row)}
                                                    >
                                                        <span className={styles.walletRowIcon} aria-hidden="true">
                                                            {RowIcon ? <RowIcon /> : null}
                                                        </span>
                                                        <span className={styles.walletRowLabel}>{row.label}</span>
                                                        <span className={styles.rowChevron} aria-hidden="true">
                                                            <Icon.ForwardIcon />
                                                        </span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </section>
                            ))}
                        </div>
                    </div>
                ) : (
                    <ul
                        ref={listRef}
                        id="xc-cmd-listbox"
                        className={styles.list}
                        role="listbox"
                        aria-label={t('commandPalette.commandPalette.commands')}
                    >
                        {results.length === 0 ? (
                        <li className={styles.empty} role="presentation">
                            {t('commandPalette.commandPalette.noMatchesFor')}{query}&rdquo;
                        </li>
                    ) : (
                        groups.map((group) => (
                            // Keyed by category + first flat index, NOT category
                            // alone: results are score-sorted, so one category can
                            // split into several consecutive-run groups per render,
                            // and duplicate keys make React leave stale rows behind.
                            <li key={`${group.category}-${group.rows[0].index}`} role="presentation">
                                <div className={styles.groupHead} role="presentation">
                                    {categoryLabel(group.category)}
                                </div>
                                <ul className={styles.groupList} role="presentation">
                                    {group.rows.map(({ command, index }) => {
                                        const selected = index === activeIndex;
                                        const RowIcon = command.Icon;
                                        return (
                                            <li
                                                key={command.id}
                                                id={`xc-cmd-${command.id}`}
                                                data-index={index}
                                                role="option"
                                                aria-selected={selected}
                                                className={`${styles.row} ${selected ? styles.rowActive : ''}`}
                                                onMouseMove={() => setActiveIndex(index)}
                                                onClick={() => runAt(index)}
                                            >
                                                <span className={styles.rowIcon} aria-hidden="true">
                                                    {RowIcon ? <RowIcon /> : null}
                                                </span>
                                                <span className={styles.rowText}>
                                                    <span className={styles.rowTitle}>{command.title}</span>
                                                    {command.subtitle ? (
                                                        <span className={styles.rowSubtitle}>{command.subtitle}</span>
                                                    ) : null}
                                                </span>
                                                <span className={styles.rowChevron} aria-hidden="true">
                                                    <Icon.ForwardIcon />
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        ))
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
}
