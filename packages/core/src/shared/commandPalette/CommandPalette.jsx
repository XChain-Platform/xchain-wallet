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
import { visibleWalletMenu, walletMenuFooter } from '../walletMenu.js';
import { TIER_RAIL_MIN_PX } from '../styles/breakpoints.js';
import '../../i18n/locales/en/commandPalette.js';
import '../../i18n/locales/en/walletMenu.js';

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

function orderMenuSearchResults(results, commands) {
    const sourceOrder = new Map(commands.map((command, index) => [command.id, index]));
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
 * }} [props.menu]
 */
export function CommandPalette({
    open, onClose, commands, placeholder, parseQuery, menu,
}) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [recentCommandIds, setRecentCommandIds] = useState(/** @type {string[]} */ ([]));
    // The system Back gesture closes this before it leaves the screen.
    useBackHandler(open ? onClose : undefined);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const listRef = useRef(/** @type {HTMLElement | null} */ (null));
    const dialogRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [wideMenu, setWideMenu] = useState(false);
    useFocusTrap(dialogRef, { active: open, initialFocusRef: inputRef });

    const walletGroups = menu ? visibleWalletMenu(menu.gates) : [];
    const walletRows = walletGroups.flatMap((group) => group.rows);
    const walletFooterRows = menu
        ? walletMenuFooter().filter((row) => row.id !== 'lock' || menu.onLock)
        : [];
    const walletSelectableRows = [...walletRows, ...walletFooterRows];
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
        return menu ? orderMenuSearchResults(combined, commands || []) : combined;
    }, [commands, query, parseQuery, recentCommandIds, menu]);

    // Reset before paint so input arriving as the palette appears cannot be
    // overwritten by a later effect. Re-opens still start from a clean slate.
    useLayoutEffect(() => {
        if (!open) return;
        setQuery('');
        setActiveIndex(currentWalletIndexRef.current);
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
        const id = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(id);
    }, [open]);

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
        else if (row.id === 'lock') menu.onLock?.();
        else menu.onSelect(row.id);
    };

    const runAt = (index) => {
        if (showingWalletMenu) selectWalletRow(walletSelectableRows[index]);
        else runCommandAt(index);
    };

    const onKeyDown = (e) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex((i) => (selectionCount === 0 ? 0 : (i + 1) % selectionCount));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex((i) => (selectionCount === 0
                    ? 0
                    : (i <= 0 ? selectionCount - 1 : i - 1)));
                break;
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

    const walletButtonClass = `${buttonStyles.btn} ${buttonStyles.rowAction} ${buttonStyles.md}`;

    return (
        <div
            ref={dialogRef}
            className={`${styles.overlay} ${menu ? styles.menuOverlay : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="xc-wallet-menu-title"
            data-wallet-menu={menu ? '' : undefined}
            onMouseDown={onClose}
        >
            <div
                className={`${styles.panel} ${menu ? styles.menuPanel : ''}`}
                role="presentation"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <h2 id="xc-wallet-menu-title" className={styles.visuallyHidden}>
                    {t('walletMenu.menu')}
                </h2>
                {menu ? (
                    <header className={styles.menuHeader}>
                        {searchControl}
                        {closeButton}
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
                    <div ref={listRef} className={styles.walletSurface}>
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
                                    <h3
                                        id={`xc-wallet-menu-group-${group.id}`}
                                        className={styles.walletGroupHead}
                                    >
                                        {group.label}
                                    </h3>
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
                                                        data-wallet-menu-focused={selected ? '' : undefined}
                                                        className={`${walletButtonClass} ${styles.walletRow} ${current ? styles.walletRowActive : ''}`}
                                                        role="option"
                                                        aria-selected={selected}
                                                        aria-current={current ? 'page' : undefined}
                                                        onMouseMove={() => setActiveIndex(index)}
                                                        onClick={() => selectWalletRow(row)}
                                                    >
                                                        <span className={styles.walletRowIcon} aria-hidden="true">
                                                            {RowIcon ? <RowIcon /> : null}
                                                        </span>
                                                        <span className={styles.walletRowLabel}>{row.label}</span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </section>
                            ))}
                        </div>
                        <div className={styles.walletFooter}>
                            {walletFooterRows.map((row) => {
                                const index = walletSelectableRows.findIndex((item) => item.id === row.id);
                                const selected = index === activeIndex;
                                const current = row.id === menu.currentView;
                                const RowIcon = Icon[row.icon];
                                return (
                                    <button
                                        key={row.id}
                                        id={`xc-wallet-menu-${row.id}`}
                                        type="button"
                                        data-index={index}
                                        data-wallet-menu-row={row.id}
                                        data-wallet-menu-focused={selected ? '' : undefined}
                                        data-destructive={row.id === 'lock' ? 'true' : undefined}
                                        className={`${walletButtonClass} ${styles.walletFooterRow} ${current ? styles.walletRowActive : ''}`}
                                        aria-current={current ? 'page' : undefined}
                                        onMouseMove={() => setActiveIndex(index)}
                                        onClick={() => selectWalletRow(row)}
                                    >
                                        <span className={styles.walletRowIcon} aria-hidden="true">
                                            {RowIcon ? <RowIcon /> : null}
                                        </span>
                                        <span className={styles.walletRowLabel}>{row.label}</span>
                                    </button>
                                );
                            })}
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
