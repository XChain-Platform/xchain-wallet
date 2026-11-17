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
import '../../i18n/locales/en/alerts.js';
import '../../i18n/locales/en/home.js';

// The Balances Type values (HomeTabs' HOME_BALANCE_TYPES, kept here so the
// menu does not import Home's whole list).
const HOME_BALANCE_TYPE_VALUES = ['all', 'coins', 'tokens'];

// The search box names the tab it filters, as [placeholder, label]. Each
// key is a literal t() call so the key audits can see it.
const SEARCH_COPY = {
    all: () => [t('home.filter.searchAll'), t('home.filter.searchAllByName')],
    // Balances lists coins and tokens (NFTs included), as All did.
    balances: () => [t('home.filter.searchAll'), t('home.filter.searchAllByName')],
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
 * On Home's Balances tab it also carries the Type field (All types, Coins,
 * Tokens; operator 2026-11-15), the standard themed dropdown with an icon per
 * option, whose value Home owns too.
 *
 * @param {object} props
 * @param {'all' | 'coins' | 'tokens'} [props.balanceType]          the Balances list's Type; omitted off Balances
 * @param {(value: 'all' | 'coins' | 'tokens') => void} [props.onBalanceTypeChange]
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
    balanceType,
    onBalanceTypeChange,
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const panelTop = useFilterPanelTop(open, triggerRef);
    const canFilter = typeof onNetworkFilterChange === 'function'
        && typeof onTokenQueryChange === 'function';
    const showType = typeof onBalanceTypeChange === 'function';
    const typeActive = showType && Boolean(balanceType) && balanceType !== 'all';
    const filterActive = Boolean(tokenQuery?.trim()) || networkFilter !== 'all' || typeActive;
    // How many filters (search text, a network, a Type) narrow the list,
    // shown as a blue bubble on the button so a short list explains itself.
    const activeFilterCount = (tokenQuery?.trim() ? 1 : 0)
        + (networkFilter && networkFilter !== 'all' ? 1 : 0)
        + (typeActive ? 1 : 0);

    useEffect(() => {
        if (!open) return undefined;
        // The Network choice opens a full-screen list portaled outside the
        // panel; a press, Escape or focus inside it belongs to that list, so
        // the panel stays open under it and the pick reaches its handler.
        const inPickerLayer = (event) => Boolean(event.target?.closest?.('[data-picker-layer]'));
        const onPointerDown = (event) => {
            if (inPickerLayer(event)) return;
            if (!wrapRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            if (inPickerLayer(event)) return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
        };
        const onFocusIn = (event) => {
            if (inPickerLayer(event)) return;
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
    // The Balances list's Type: the standard themed dropdown, never a native
    // select or radio buttons, an icon on every option (G119).
    const typeSelect = showType ? (
        <IconSelect
            size="md"
            aria-label={t('home.filter.type')}
            value={HOME_BALANCE_TYPE_VALUES.includes(balanceType) ? balanceType : 'all'}
            onChange={(value) => onBalanceTypeChange(value)}
            options={[
                { value: 'all', label: t('alerts.type.all'), icon: <Icon.GridIcon /> },
                { value: 'coins', label: t('home.tabs.coins'), icon: <Icon.CoinsIcon /> },
                { value: 'tokens', label: t('home.tabs.tokens'), icon: <Icon.TokenIcon /> },
            ]}
        />
    ) : null;
    const listControls = typeSelect && sortSelect
        ? <>{typeSelect}{sortSelect}</>
        : (typeSelect || sortSelect);
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
                    {canFilter ? null : listControls}
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
                            middle={listControls}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
