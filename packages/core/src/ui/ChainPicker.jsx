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
import * as branding from '../branding/branding.js';
import { ChevronIcon } from './ChainPicker.icons.jsx';
import styles from './ChainPicker.module.css';

/**
 * Single-select chain picker. Replaces native `<select>` in any
 * "which network are we operating on" form (Send, Swap, Issue,
 * Compose message, Markets filter, etc.).
 *
 * Each row carries the chain's icon + display name + network-kind
 * suffix (mainnet implicit; testnet / regtest shown). Reads the icon
 * URL from `branding.chainIconSmallUrl(chainId)` so the component
 * stays decoupled from the chain registry's image tick wiring.
 *
 * Searchable when the option count exceeds 6.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(chainId: string) => void} props.onChange
 * @param {string[]} props.chainIds
 * @param {import('../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string} [props.label]
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.hideNetworkKind]   When true, suppresses the
 *        ` · testnet` / ` · regtest` suffix in the subtext. Useful on
 *        Receive where the page is already scoped to the user's own
 *        addresses; defaults to false so Send / Swap / Issue keep the
 *        "real money vs play money" cue.
 */
export function ChainPicker({
    value,
    onChange,
    chainIds,
    chainRegistry,
    label,
    placeholder = 'Select a network',
    disabled,
    hideNetworkKind = false,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

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
        return (chainIds || []).map((id) => {
            const d = chainRegistry?.get(id);
            return {
                id,
                label: d?.displayName || id,
                ticker: tickerForCoin(d?.coin),
                networkKind: d?.networkKind || 'mainnet',
                iconUrl: branding.chainIconSmallUrl(id),
            };
        });
    }, [chainIds, chainRegistry]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return entries;
        return entries.filter((e) =>
            e.label.toLowerCase().includes(q)
            || e.ticker.toLowerCase().includes(q)
            || e.networkKind.toLowerCase().includes(q)
        );
    }, [entries, query]);

    const selected = entries.find((e) => e.id === value) || null;

    return (
        <div className={styles.wrap}>
            {label ? <span className={styles.label}>{label}</span> : null}
            <button
                type="button"
                ref={triggerRef}
                className={styles.trigger}
                onClick={() => !disabled && setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                disabled={disabled}
            >
                <span className={styles.triggerIcon} aria-hidden="true">
                    {selected?.iconUrl ? <img src={selected.iconUrl} alt="" /> : null}
                </span>
                <span className={styles.triggerText}>
                    {selected ? (
                        <>
                            <span className={styles.triggerLabel}>{selected.label}</span>
                            <span className={styles.triggerSub}>
                                {selected.ticker}
                                {!hideNetworkKind && selected.networkKind !== 'mainnet'
                                    ? ` · ${selected.networkKind}`
                                    : ''}
                            </span>
                        </>
                    ) : (
                        <span className={styles.triggerLabel}>{placeholder}</span>
                    )}
                </span>
                <span className={styles.triggerCaret} aria-hidden="true">
                    <ChevronIcon open={open} />
                </span>
            </button>
            {open ? (
                <div ref={popoverRef} className={styles.popover} role="listbox">
                    {entries.length > 6 ? (
                        <div className={styles.searchWrap}>
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
                        {filtered.map((e) => (
                            <li key={e.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={value === e.id ? 'true' : 'false'}
                                    className={`${styles.item} ${value === e.id ? styles.itemActive : ''}`}
                                    onClick={() => { onChange(e.id); setOpen(false); setQuery(''); }}
                                >
                                    <span className={styles.itemIcon} aria-hidden="true">
                                        {e.iconUrl ? <img src={e.iconUrl} alt="" /> : null}
                                    </span>
                                    <span className={styles.itemBody}>
                                        <span className={styles.itemLabel}>{e.label}</span>
                                        <span className={styles.itemSub}>
                                            {e.ticker}
                                            {!hideNetworkKind && e.networkKind !== 'mainnet' ? ` · ${e.networkKind}` : ''}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                        {filtered.length === 0 ? (
                            <li className={styles.empty}>No matching networks.</li>
                        ) : null}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

function tickerForCoin(coin) {
    if (!coin) return '';
    const map = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    return map[coin] || coin.toUpperCase();
}
