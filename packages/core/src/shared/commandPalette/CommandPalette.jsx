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
//   Tab      jump the selection to the first result of the next category
//   Shift+Tab   ... previous category
//   Esc      close
// The search input keeps focus the whole time (it is the only tab stop),
// so the arrow keys drive a `aria-activedescendant` selection rather than
// roving DOM focus. That keeps the combobox pattern accessible and avoids a
// focus-trap dance.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../ui/index.js';
import { filterCommands } from './fuzzyMatch.js';
import styles from './CommandPalette.module.css';

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
 */
export function CommandPalette({ open, onClose, commands, placeholder, parseQuery }) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const listRef = useRef(/** @type {HTMLUListElement | null} */ (null));

    const results = useMemo(() => {
        const base = filterCommands(commands || [], query);
        const q = (query || '').trim();
        if (!q || typeof parseQuery !== 'function') return base;
        const freeform = parseQuery(q) || [];
        return freeform.length ? [...freeform, ...base] : base;
    }, [commands, query, parseQuery]);

    // Reset to a clean slate every time the palette opens, and focus the
    // input. Without the reset a re-open shows the previous query + stale
    // selection for a frame.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setActiveIndex(0);
        // Focus after paint so the input exists in the DOM.
        const id = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(id);
    }, [open]);

    // Keep the selection in range as the result set shrinks under typing.
    useEffect(() => {
        setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
    }, [results.length]);

    // Scroll the selected row into view when it moves off-screen.
    useEffect(() => {
        if (!open) return;
        const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex, open]);

    if (!open) return null;

    const runAt = (index) => {
        const command = results[index];
        if (!command) return;
        // Close first so a command that navigates doesn't render behind an
        // open palette for a frame.
        onClose();
        command.run();
    };

    // First index of the category that follows (or precedes) the currently
    // selected result. Used by Tab / Shift+Tab (§33.4 "Tab cycles result
    // categories"). Wraps around the ends.
    const jumpCategory = (dir) => {
        if (results.length === 0) return;
        const current = results[activeIndex]?.category;
        // Ordered list of distinct categories as they appear in results.
        const order = [];
        for (const r of results) {
            if (!order.includes(r.category)) order.push(r.category);
        }
        if (order.length <= 1) return;
        const ci = order.indexOf(current);
        const nextCat = order[(ci + dir + order.length) % order.length];
        const target = results.findIndex((r) => r.category === nextCat);
        if (target >= 0) setActiveIndex(target);
    };

    const onKeyDown = (e) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
                break;
            case 'Enter':
                e.preventDefault();
                runAt(activeIndex);
                break;
            case 'Tab':
                e.preventDefault();
                jumpCategory(e.shiftKey ? -1 : 1);
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
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
        let group = groups[groups.length - 1];
        if (!group || group.category !== command.category) {
            group = { category: command.category, rows: [] };
            groups.push(group);
        }
        group.rows.push({ command, index: flatIndex });
        flatIndex += 1;
    }

    const activeId = results[activeIndex] ? `xc-cmd-${results[activeIndex].id}` : undefined;

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onMouseDown={onClose}
        >
            <div
                className={styles.panel}
                role="presentation"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className={styles.searchRow}>
                    <span className={styles.searchIcon} aria-hidden="true">
                        <Icon.SearchIcon />
                    </span>
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus -- palette
                        is a transient modal; focusing search is the whole point */}
                    <input
                        ref={inputRef}
                        type="text"
                        className={styles.input}
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
                        onKeyDown={onKeyDown}
                        placeholder={placeholder || 'Search actions, tokens, contacts…'}
                        aria-label="Search commands"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="xc-cmd-listbox"
                        aria-activedescendant={activeId}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <kbd className={styles.escHint} aria-hidden="true">Esc</kbd>
                </div>
                <ul
                    ref={listRef}
                    id="xc-cmd-listbox"
                    className={styles.list}
                    role="listbox"
                    aria-label="Commands"
                >
                    {results.length === 0 ? (
                        <li className={styles.empty} role="presentation">
                            No matches for &ldquo;{query}&rdquo;
                        </li>
                    ) : (
                        groups.map((group) => (
                            // Keyed by category + first flat index, NOT category
                            // alone: results are score-sorted, so one category can
                            // split into several consecutive-run groups per render,
                            // and duplicate keys make React leave stale rows behind.
                            <li key={`${group.category}-${group.rows[0].index}`} role="presentation">
                                <div className={styles.groupHead} role="presentation">
                                    {group.category}
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
            </div>
        </div>
    );
}
