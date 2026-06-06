// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { NetworkFilter } from './NetworkFilter.jsx';
import styles from './HeaderFilterButton.module.css';

/**
 * Header-mounted filter trigger. Click → reveals a popover containing
 * the network filter picker. Keeps the filter UI out of the body
 * vertical-real-estate while staying one click away.
 *
 * The chip-style indicator turns brand-blue when a non-`all` filter
 * is active, so the user always sees at a glance whether the view
 * is filtered.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies
 * @param {string} props.value
 * @param {(coin: string) => void} props.onChange
 */
export function HeaderFilterButton({ chainRegistry, coinFamilies, value, onChange }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
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

    const isActive = value && value !== 'all';

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <button
                type="button"
                className={`${styles.btn} ${isActive ? styles.btnActive : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                aria-label={isActive
                    ? `Network filter: ${value}. Click to change.`
                    : 'Filter by network'}
                title={isActive ? `Filter: ${value}` : 'Filter by network'}
            >
                <Icon.FilterIcon />
                {isActive ? <span className={styles.dot} aria-hidden="true" /> : null}
            </button>
            {open ? (
                <div className={styles.popover}>
                    <NetworkFilter
                        chainRegistry={chainRegistry}
                        coinFamilies={coinFamilies}
                        value={value}
                        onChange={(next) => { onChange(next); setOpen(false); }}
                    />
                </div>
            ) : null}
        </div>
    );
}
