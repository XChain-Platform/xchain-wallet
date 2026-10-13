// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './NetworkFilter.module.css';

/**
 * Single-select network filter that scales to N chains. Replaces the
 * fixed `[All] [BTC] [LTC] [DOGE]` chip row with one trigger button
 * that surfaces the currently selected filter; clicking opens a
 * dropdown with every coin family in the dataset.
 *
 * The dropdown is searchable when there are more than 6 entries;
 * cheap to add and pays off the moment a wallet hosts more chains.
 *
 * `value` is the active filter: `'all'` or a coin family
 * (`'bitcoin'` / `'litecoin'` / `'dogecoin'` / …). `onChange`
 * fires with the new selection.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies   coin families discovered in the active dataset, ordered for display
 * @param {string} props.value
 * @param {(coin: string) => void} props.onChange
 * @param {string} [props.ariaLabel]
 * @param {'sm' | 'md' | 'lg'} [props.size]
 */
export function NetworkFilter({
    chainRegistry,
    coinFamilies,
    value,
    onChange,
    ariaLabel,
    size = 'md',
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const listboxId = useId();
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);
    const searchRef = useRef(null);
    const focusOnOpenRef = useRef('selected');

    const closeFilter = useCallback((restoreFocus = false) => {
        setOpen(false);
        setQuery('');
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (popoverRef.current?.contains(e.target)) return;
            closeFilter();
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            closeFilter(true);
        };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [closeFilter, open]);

    const entries = useMemo(() => {
        return coinFamilies.map((coin) => {
            const desc = chainRegistry.byCoin(coin)[0];
            return {
                coin,
                label: desc?.displayName || coin,
                ticker: shortLabelForCoin(coin),
                chainId: desc?.id,
                color: desc?.color,
            };
        });
    }, [coinFamilies, chainRegistry]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return entries;
        return entries.filter((e) =>
            e.label.toLowerCase().includes(q) || e.ticker.toLowerCase().includes(q)
        );
    }, [entries, query]);

    const triggerLabel = value === 'all'
        ? 'All networks'
        : (entries.find((e) => e.coin === value)?.label || value);
    const triggerSub = value === 'all'
        ? `${entries.length} ${entries.length === 1 ? 'network' : 'networks'}`
        : null;
    const triggerIconUrl = value === 'all'
        ? null
        : branding.chainIconSmallUrl(entries.find((e) => e.coin === value)?.chainId || '');

    useEffect(() => {
        if (!open) return;
        if (focusOnOpenRef.current === 'search') {
            searchRef.current?.focus();
            return;
        }
        const options = listboxOptions(popoverRef.current);
        const selectedOption = options.find(
            (option) => option.getAttribute('aria-selected') === 'true',
        );
        const fallback = focusOnOpenRef.current === 'last' ? options.at(-1) : options[0];
        (selectedOption || fallback)?.focus();
    }, [open]);

    const openFilter = (focus = 'selected') => {
        focusOnOpenRef.current = focus;
        setOpen(true);
    };

    const onPopoverKeyDown = (e) => {
        const options = listboxOptions(popoverRef.current);
        if (e.target === searchRef.current) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            (e.key === 'ArrowDown' ? options[0] : options.at(-1))?.focus();
            return;
        }

        const index = options.indexOf(document.activeElement);
        let nextIndex = null;
        if (e.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
        if (e.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length;
        if (e.key === 'Home') nextIndex = 0;
        if (e.key === 'End') nextIndex = options.length - 1;
        if (nextIndex !== null && options.length > 0) {
            e.preventDefault();
            options[nextIndex]?.focus();
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && index >= 0) {
            e.preventDefault();
            options[index].click();
        }
        if (e.key === 'Tab') closeFilter();
    };

    return (
        <div className={`${styles.wrap} ${styles[size] || ''}`.trim()}>
            <button
                type="button"
                ref={triggerRef}
                className={styles.trigger}
                onClick={() => {
                    if (open) closeFilter();
                    else openFilter(entries.length > 6 ? 'search' : 'selected');
                }}
                onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    e.preventDefault();
                    openFilter(e.key === 'ArrowUp' ? 'last' : 'selected');
                }}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                aria-controls={open ? listboxId : undefined}
                aria-label={ariaLabel}
                title={triggerLabel}
            >
                <span className={styles.triggerIcon} aria-hidden="true">
                    {triggerIconUrl ? (
                        <img src={triggerIconUrl} alt="" />
                    ) : (
                        <Icon.FilterIcon />
                    )}
                </span>
                <span className={styles.triggerText}>
                    <span className={styles.triggerLabel}>{triggerLabel}</span>
                    {triggerSub ? (
                        <span className={styles.triggerSub}>{triggerSub}</span>
                    ) : null}
                </span>
                <span className={styles.triggerCaret} aria-hidden="true">
                    {open ? '▴' : '▾'}
                </span>
            </button>
            {open ? (
                <div
                    ref={popoverRef}
                    className={styles.popover}
                    onKeyDown={onPopoverKeyDown}
                >
                    {entries.length > 6 ? (
                        <div className={styles.searchWrap}>
                            <Icon.SearchIcon />
                            <input
                                ref={searchRef}
                                type="search"
                                enterKeyHint="search"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                className={styles.search}
                                placeholder="Search networks…"
                                aria-label="Search networks"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                    ) : null}
                    <ul id={listboxId} className={styles.list} role="listbox" aria-label="Networks">
                        <li role="presentation">
                            <button
                                type="button"
                                role="option"
                                tabIndex={-1}
                                aria-label="All networks"
                                aria-selected={value === 'all' ? 'true' : 'false'}
                                className={`${styles.item} ${value === 'all' ? styles.itemActive : ''}`}
                                onClick={() => { onChange('all'); closeFilter(true); }}
                                title="All networks"
                            >
                                <span className={styles.itemIcon} aria-hidden="true">
                                    <Icon.FilterIcon />
                                </span>
                                <span className={styles.itemLabel}>All networks</span>
                                <span className={styles.itemTicker}>{entries.length}</span>
                            </button>
                        </li>
                        {filtered.map((e, index) => {
                            const iconUrl = branding.chainIconSmallUrl(e.chainId || '');
                            return (
                                <li key={`${e.coin}-${index}`} role="presentation">
                                    <button
                                        type="button"
                                        role="option"
                                        tabIndex={-1}
                                        aria-label={e.label}
                                        aria-selected={value === e.coin ? 'true' : 'false'}
                                        className={`${styles.item} ${value === e.coin ? styles.itemActive : ''}`}
                                        onClick={() => { onChange(e.coin); closeFilter(true); }}
                                        title={e.label}
                                    >
                                        <span className={styles.itemIcon} aria-hidden="true">
                                            {iconUrl ? <img src={iconUrl} alt="" /> : null}
                                        </span>
                                        <span className={styles.itemLabel}>{e.label}</span>
                                        <span className={styles.itemTicker}>{e.ticker}</span>
                                    </button>
                                </li>
                            );
                        })}
                        {filtered.length === 0 ? (
                            <li
                                className={styles.empty}
                                role="option"
                                aria-disabled="true"
                            >
                                No matching networks.
                            </li>
                        ) : null}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

function shortLabelForCoin(coin) {
    const map = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    return map[coin] || coin.toUpperCase();
}

function listboxOptions(popover) {
    return Array.from(popover?.querySelectorAll('[role="option"]:not([aria-disabled="true"])') || []);
}
