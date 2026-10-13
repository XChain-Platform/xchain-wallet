// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 */
export function NetworkFilter({ chainRegistry, coinFamilies, value, onChange, ariaLabel }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

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

    const close = useCallback(({ restoreFocus = false } = {}) => {
        setOpen(false);
        setQuery('');
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    const focusOption = useCallback((index) => {
        const options = Array.from(popoverRef.current?.querySelectorAll('[role="option"]') || []);
        if (options.length === 0) return;
        const wrapped = (index + options.length) % options.length;
        options[wrapped]?.focus();
    }, []);

    const handleListKeyDown = useCallback((event) => {
        const options = Array.from(popoverRef.current?.querySelectorAll('[role="option"]') || []);
        const current = options.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusOption(current + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusOption(current < 0 ? options.length - 1 : current - 1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            focusOption(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            focusOption(options.length - 1);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close({ restoreFocus: true });
        }
    }, [close, focusOption]);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (popoverRef.current?.contains(e.target)) return;
            close();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close({ restoreFocus: true });
        };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [close, open]);

    useEffect(() => {
        if (!open || entries.length > 6) return;
        const selectedIndex = Math.max(0, [
            'all',
            ...entries.map((entry) => entry.coin),
        ].indexOf(value));
        const options = popoverRef.current?.querySelectorAll('[role="option"]');
        options?.[selectedIndex]?.focus();
    }, [open, entries, value]);

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

    return (
        <div className={styles.wrap}>
            <button
                type="button"
                ref={triggerRef}
                className={styles.trigger}
                onClick={() => { if (open) close(); else setOpen(true); }}
                onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    setOpen(true);
                }}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
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
                    role="listbox"
                    aria-label="Networks"
                    onKeyDown={handleListKeyDown}
                >
                    {entries.length > 6 ? (
                        <div className={styles.searchWrap}>
                            <Icon.SearchIcon />
                            <input
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
                                onKeyDown={(event) => {
                                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    focusOption(event.key === 'ArrowDown' ? 0 : -1);
                                }}
                                autoFocus
                            />
                        </div>
                    ) : null}
                    <ul className={styles.list}>
                        <li>
                            <button
                                type="button"
                                role="option"
                                aria-label="All networks"
                                aria-selected={value === 'all' ? 'true' : 'false'}
                                className={`${styles.item} ${value === 'all' ? styles.itemActive : ''}`}
                                onClick={() => { onChange('all'); close(); }}
                                title="All networks"
                            >
                                <span className={styles.itemIcon} aria-hidden="true">
                                    <Icon.FilterIcon />
                                </span>
                                <span className={styles.itemLabel}>All networks</span>
                                <span className={styles.itemTicker}>{entries.length}</span>
                            </button>
                        </li>
                        {filtered.map((e) => {
                            const iconUrl = branding.chainIconSmallUrl(e.chainId || '');
                            return (
                                <li key={e.coin}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-label={e.label}
                                        aria-selected={value === e.coin ? 'true' : 'false'}
                                        className={`${styles.item} ${value === e.coin ? styles.itemActive : ''}`}
                                        onClick={() => { onChange(e.coin); close(); }}
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
                            <li className={styles.empty}>No matching networks.</li>
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
