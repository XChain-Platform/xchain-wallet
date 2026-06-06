// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './NetworkFilter.module.css';

/**
 * Single-select network filter that scales to N chains. Replaces the
 * fixed `[All] [BTC] [LTC] [DOGE]` chip row with one trigger button
 * that surfaces the currently selected filter; clicking opens a
 * dropdown with every coin family in the dataset.
 *
 * The dropdown is searchable when there are more than 6 entries —
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
 */
export function NetworkFilter({ chainRegistry, coinFamilies, value, onChange }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

    // Close on outside click / Escape
    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (popoverRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

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

    return (
        <div className={styles.wrap}>
            <button
                type="button"
                ref={triggerRef}
                className={styles.trigger}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
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
                <div ref={popoverRef} className={styles.popover} role="listbox">
                    {entries.length > 6 ? (
                        <div className={styles.searchWrap}>
                            <Icon.SearchIcon />
                            <input
                                type="text"
                                className={styles.search}
                                placeholder="Search networks…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                autoFocus
                            />
                        </div>
                    ) : null}
                    <ul className={styles.list}>
                        <li>
                            <button
                                type="button"
                                role="option"
                                aria-selected={value === 'all' ? 'true' : 'false'}
                                className={`${styles.item} ${value === 'all' ? styles.itemActive : ''}`}
                                onClick={() => { onChange('all'); setOpen(false); setQuery(''); }}
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
                                        aria-selected={value === e.coin ? 'true' : 'false'}
                                        className={`${styles.item} ${value === e.coin ? styles.itemActive : ''}`}
                                        onClick={() => { onChange(e.coin); setOpen(false); setQuery(''); }}
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
