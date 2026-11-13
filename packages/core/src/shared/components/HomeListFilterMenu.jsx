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
import { useFilterPanelTop } from './useFilterPanelTop.js';
import { Button, Icon, IconSelect } from '@xchain-wallet/core/ui';
import { HomeFilterBar } from './HomeFilterBar.jsx';
import styles from './HomeListFilterMenu.module.css';
import { t } from '../../i18n/index.js';

// The search box names the tab it filters, as [placeholder, label]. Each
// key is a literal t() call so the key audits can see it.
const SEARCH_COPY = {
    coins: () => [t('home.filter.searchCoins'), t('home.filter.searchCoinsByName')],
    tokens: () => [t('home.filter.searchTokens'), t('home.filter.searchTokensByName')],
    nfts: () => [t('home.filter.searchNfts'), t('home.filter.searchNftsByName')],
    defi: () => [t('home.filter.searchDefi'), t('home.filter.searchDefiByName')],
    activity: () => [t('home.filter.searchActivity'), t('home.filter.searchActivityByName')],
};

/**
 * Keeps Home list sorting and filtering behind one compact header control.
 * The query and network values remain owned by Home so they survive tab
 * changes, while this component owns only the temporary popover state.
 */
export function HomeListFilterMenu({
    sortBy,
    onSortChange,
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    tokenQuery,
    onTokenQueryChange,
    tab = 'tokens',
    showSort = true,
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const panelTop = useFilterPanelTop(open, triggerRef);
    const canFilter = typeof onNetworkFilterChange === 'function'
        && typeof onTokenQueryChange === 'function';
    const filterActive = Boolean(tokenQuery?.trim()) || networkFilter !== 'all';
    // How many filters (search text, a network) narrow the list, shown as a
    // blue bubble on the button so a short list explains itself.
    const activeFilterCount = (tokenQuery?.trim() ? 1 : 0) + (networkFilter && networkFilter !== 'all' ? 1 : 0);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (!wrapRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
        };
        const onFocusIn = (event) => {
            if (!wrapRef.current?.contains(event.target)) setOpen(false);
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('focusin', onFocusIn);
        return () => {
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('focusin', onFocusIn);
        };
    }, [open]);

    useEffect(() => {
        if (open) wrapRef.current?.querySelector('input, select')?.focus();
    }, [open]);

    const label = t('home.filter.filterAndSort');
    const [searchPlaceholder, searchLabel] = (SEARCH_COPY[tab] || SEARCH_COPY.tokens)();
    // Activity is ordered by time, so it offers no sort that would do nothing.
    const sortSelect = showSort ? (
        <IconSelect
            size="md"
            aria-label={t('home.filter.sort')}
            value={sortBy}
            onChange={(value) => onSortChange(value)}
            options={[
                { value: 'name', label: t('home.filter.sortByName'), icon: <Icon.TokenListIcon /> },
                { value: 'value', label: t('home.filter.sortByValue'), icon: <Icon.DollarIcon /> },
            ]}
        />
    ) : null;
    return (
        <div ref={wrapRef} className={styles.wrap}>
            <Button
                ref={triggerRef}
                type="button"
                size="md"
                variant="secondary"
                className={`${styles.trigger} ${filterActive ? styles.triggerActive : ''}`}
                icon={<Icon.FilterIcon />}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                title={label}
                onClick={() => setOpen((value) => !value)}
            >
                {null}
            </Button>
            {activeFilterCount > 0 ? <span className={styles.filterBadge} aria-hidden="true" /> : null}
            {open ? (
                <div className={styles.panel} role="dialog" aria-label={label} style={panelTop == null ? undefined : { '--xc-filter-panel-top': `${panelTop}px` }}>
                    {canFilter ? null : sortSelect}
                    {canFilter ? (
                        <HomeFilterBar
                            variant="menu"
                            chainRegistry={chainRegistry}
                            coinFamilies={coinFamilies || []}
                            networkFilter={networkFilter}
                            onNetworkFilterChange={onNetworkFilterChange}
                            tokenQuery={tokenQuery}
                            onTokenQueryChange={onTokenQueryChange}
                            searchPlaceholder={searchPlaceholder}
                            searchLabel={searchLabel}
                            middle={sortSelect}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
