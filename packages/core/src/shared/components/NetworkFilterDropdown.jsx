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
import * as branding from '../../branding/branding.js';
import styles from './NetworkFilterDropdown.module.css';

// Each entry carries the icon URL at module load time so the dropdown renders
// without any async work. Uses mainnet icons because callers store coin
// families ('bitcoin' / 'litecoin' / 'dogecoin'), not per-network chainIds.
export const NETWORK_OPTIONS = [
    { value: 'bitcoin',  label: 'Bitcoin',  iconUrl: branding.chainIconSmallUrl('bitcoin-mainnet') },
    { value: 'litecoin', label: 'Litecoin', iconUrl: branding.chainIconSmallUrl('litecoin-mainnet') },
    { value: 'dogecoin', label: 'Dogecoin', iconUrl: branding.chainIconSmallUrl('dogecoin-mainnet') },
];

/**
 * Network filter dropdown shared by the contacts list and the Send address
 * book. A native <select> can't render images inside options, so this is a
 * small trigger + popover pattern: the filter icon for "All Networks" and the
 * coin icon for each chain. Designed to sit as a flex item (it sizes to its
 * container, e.g. 50% of a search/filter toolbar).
 *
 * @param {object} props
 * @param {'all' | string} props.value      currently selected network
 * @param {(value: string) => void} props.onChange
 */
export function NetworkFilterDropdown({ value, onChange }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (popoverRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const selected = NETWORK_OPTIONS.find((n) => n.value === value) || null;

    return (
        <div className={styles.networkWrap}>
            <button
                ref={triggerRef}
                type="button"
                className={styles.networkTrigger}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                aria-label="Filter by network"
            >
                <span className={styles.networkTriggerIcon} aria-hidden="true">
                    {selected?.iconUrl ? <img src={selected.iconUrl} alt="" /> : <Icon.FilterIcon />}
                </span>
                <span className={styles.networkTriggerLabel}>
                    {selected ? selected.label : 'All Networks'}
                </span>
                <span className={styles.networkCaret} aria-hidden="true">&#9660;</span>
            </button>
            {open ? (
                <ul ref={popoverRef} className={styles.networkPopover} role="listbox">
                    {[{ value: 'all', label: 'All Networks', iconUrl: null, icon: <Icon.FilterIcon /> }, ...NETWORK_OPTIONS].map((n) => (
                        <li key={n.value}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={value === n.value ? 'true' : 'false'}
                                className={`${styles.networkOption} ${value === n.value ? styles.networkOptionActive : ''}`}
                                onClick={() => { onChange(n.value); setOpen(false); }}
                            >
                                <span className={styles.networkOptionIcon} aria-hidden="true">
                                    {n.iconUrl ? <img src={n.iconUrl} alt="" /> : n.icon || null}
                                </span>
                                {n.label}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
