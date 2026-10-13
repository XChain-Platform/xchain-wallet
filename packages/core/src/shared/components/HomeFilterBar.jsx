// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// HomeFilterBar keeps the token query and network filter visible together
// directly above the Home asset tabs.

import { Icon } from '@xchain-wallet/core/ui';
import { NetworkFilter } from './NetworkFilter.jsx';
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
    return (
        <div className={styles.bar}>
            <div className={styles.searchWrap}>
                <span className={styles.searchIcon} aria-hidden="true">
                    <Icon.SearchIcon />
                </span>
                <input
                    type="search"
                    enterKeyHint="search"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className={styles.search}
                    placeholder="Search tokens…"
                    aria-label="Search tokens by name"
                    value={tokenQuery || ''}
                    onChange={(e) => onTokenQueryChange(e.target.value)}
                />
            </div>
            <div className={styles.networkWrap}>
                <NetworkFilter
                    chainRegistry={chainRegistry}
                    coinFamilies={coinFamilies || []}
                    value={networkFilter || 'all'}
                    onChange={onNetworkFilterChange}
                    ariaLabel="Filter by network"
                />
            </div>
        </div>
    );
}
