// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// HomeFilterBar: always-visible token search + network dropdown that
// sits directly above the Home asset tabs. It is the inline counterpart
// of the filter that used to hide inside the header popover
// (HeaderNetworkButton): same `networkFilter` / `tokenQuery` state, just
// surfaced on the page so filtering is one tap, not two. Reuses the
// network-dropdown styling from HeaderNetworkButton.module.css.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Icon } from '@xchain-wallet/core/ui';
import netStyles from './HeaderNetworkButton.module.css';
import styles from './HomeFilterBar.module.css';

/**
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies                     ordered coin family list (e.g. ['bitcoin','litecoin','dogecoin'])
 * @param {string} props.networkFilter                      'all' or a coin id
 * @param {(coin: string) => void} props.onNetworkFilterChange
 * @param {string} props.tokenQuery                         free-text token filter
 * @param {(query: string) => void} props.onTokenQueryChange
 */
export function HomeFilterBar({
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    tokenQuery,
    onTokenQueryChange,
}) {
    const [networksOpen, setNetworksOpen] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!networksOpen) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setNetworksOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setNetworksOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [networksOpen]);

    const networkActive = networkFilter && networkFilter !== 'all';

    const entries = useMemo(() => {
        return (coinFamilies || []).map((coin) => {
            const desc = chainRegistry.byCoin(coin)[0];
            return { coin, label: desc?.displayName || coin, chainId: desc?.id };
        });
    }, [coinFamilies, chainRegistry]);

    const selectedEntry = networkActive ? entries.find((e) => e.coin === networkFilter) : null;
    const selectedLabel = selectedEntry?.label || 'All networks';
    const selectedIconUrl = selectedEntry ? branding.chainIconSmallUrl(selectedEntry.chainId || '') : '';

    function pickNetwork(next) {
        onNetworkFilterChange(next);
        setNetworksOpen(false);
    }

    return (
        <div className={styles.bar}>
            <div className={styles.searchWrap}>
                <span className={styles.searchIcon} aria-hidden="true">
                    <Icon.SearchIcon />
                </span>
                <input
                    type="search"
                    className={styles.search}
                    placeholder="Search tokens…"
                    aria-label="Search tokens by name"
                    value={tokenQuery || ''}
                    onChange={(e) => onTokenQueryChange(e.target.value)}
                />
            </div>
            <div ref={wrapRef} className={`${netStyles.networkSelectWrap} ${styles.networkWrap}`}>
                <button
                    type="button"
                    className={`${netStyles.networkSelect} ${styles.netSelect}`}
                    onClick={() => setNetworksOpen((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={networksOpen ? 'true' : 'false'}
                    aria-label="Filter by network"
                >
                    {selectedIconUrl ? (
                        <img src={selectedIconUrl} alt="" aria-hidden="true" className={netStyles.networkSelectIcon} />
                    ) : (
                        <span className={netStyles.networkSelectIconPlaceholder} aria-hidden="true">
                            <Icon.FilterIcon />
                        </span>
                    )}
                    <span className={netStyles.networkSelectLabel}>{selectedLabel}</span>
                    <span className={netStyles.networkSelectCaret} aria-hidden="true">
                        {networksOpen ? '▴' : '▾'}
                    </span>
                </button>
                {networksOpen ? (
                    <ul className={netStyles.networkOptions} role="listbox" aria-label="Networks">
                        <li>
                            <button
                                type="button"
                                role="option"
                                aria-selected={networkFilter === 'all' ? 'true' : 'false'}
                                className={`${netStyles.networkOption} ${networkFilter === 'all' ? netStyles.networkOptionActive : ''}`}
                                onClick={() => pickNetwork('all')}
                            >
                                <span className={netStyles.networkSelectIconPlaceholder} aria-hidden="true">
                                    <Icon.FilterIcon />
                                </span>
                                <span className={netStyles.networkSelectLabel}>All networks</span>
                            </button>
                        </li>
                        {entries.map((e) => {
                            const iconUrl = branding.chainIconSmallUrl(e.chainId || '');
                            return (
                                <li key={e.coin}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={networkFilter === e.coin ? 'true' : 'false'}
                                        className={`${netStyles.networkOption} ${networkFilter === e.coin ? netStyles.networkOptionActive : ''}`}
                                        onClick={() => pickNetwork(e.coin)}
                                    >
                                        {iconUrl ? (
                                            <img src={iconUrl} alt="" aria-hidden="true" className={netStyles.networkSelectIcon} />
                                        ) : (
                                            <span className={netStyles.networkSelectIconPlaceholder} aria-hidden="true" />
                                        )}
                                        <span className={netStyles.networkSelectLabel}>{e.label}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
            </div>
        </div>
    );
}
