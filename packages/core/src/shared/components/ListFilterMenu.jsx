// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Button, Icon, Input } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import { useFilterPanelTop } from './useFilterPanelTop.js';
import { NetworkFilter } from './NetworkFilter.jsx';
import menuStyles from './HomeListFilterMenu.module.css';
import barStyles from './HomeFilterBar.module.css';

/**
 * The standard list filter, as a button that opens Home's filter
 * panel (search box first, then the page's own pickers), for a page header's
 * trailing slot. A blue dot on the button says a filter is narrowing the list.
 *
 * @param {object} props
 * @param {string} props.query                   the search text
 * @param {(value: string) => void} props.onQueryChange
 * @param {string} props.searchPlaceholder
 * @param {string} props.searchLabel             accessible name for the search box
 * @param {boolean} [props.active]               another filter is off its default
 * @param {string} [props.label]                 the button's accessible name
 * @param {import('react').ReactNode} [props.children]  pickers under the search box
 * @param {any} [props.chainRegistry]            with coinFamilies and onNetworkFilterChange, shows Home's network picker under the search box
 * @param {string[]} [props.coinFamilies]
 * @param {string} [props.networkFilter]         'all' or a coin family
 * @param {(value: string) => void} [props.onNetworkFilterChange]
 * @param {(event: import('react').KeyboardEvent<HTMLInputElement>) => void} [props.onSearchKeyDown]
 *        keys typed in the search box, so Enter can choose the top row and the arrows can move into the list
 * @param {string} [props.resultsId]             id of the list the search narrows, for aria-controls
 */
export function ListFilterMenu({
    query,
    onQueryChange,
    searchPlaceholder,
    searchLabel,
    active = false,
    label = t('components.listFilterMenu.filter'),
    children = null,
    chainRegistry = null,
    coinFamilies = null,
    networkFilter = 'all',
    onNetworkFilterChange = null,
    onSearchKeyDown = undefined,
    resultsId = undefined,
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const panelTop = useFilterPanelTop(open, triggerRef);
    const hasNetwork = Boolean(chainRegistry && Array.isArray(coinFamilies) && typeof onNetworkFilterChange === 'function');
    const filterOn = Boolean(query?.trim()) || active || (hasNetwork && (networkFilter || 'all') !== 'all');

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
        // Arrowing from the search box into the list it narrows keeps the
        // panel open, so the search can be refined and the arrows used again.
        const onFocusIn = (event) => {
            if (wrapRef.current?.contains(event.target)) return;
            if (resultsId && document.getElementById(resultsId)?.contains(event.target)) return;
            setOpen(false);
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('focusin', onFocusIn);
        return () => {
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('focusin', onFocusIn);
        };
    }, [open, resultsId]);

    // The caret lands in the search box when the panel opens, so typed
    // letters search instead of firing the page's keyboard shortcuts.
    useEffect(() => {
        if (open) wrapRef.current?.querySelector('input')?.focus();
    }, [open]);

    return (
        <div ref={wrapRef} className={menuStyles.wrap}>
            <Button
                ref={triggerRef}
                type="button"
                size="md"
                variant="secondary"
                className={`${menuStyles.trigger} ${filterOn ? menuStyles.triggerActive : ''}`}
                icon={<Icon.FilterIcon />}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                title={label}
                onClick={() => setOpen((value) => !value)}
            >
                {null}
            </Button>
            {filterOn ? <span className={menuStyles.filterBadge} aria-hidden="true" /> : null}
            {open ? (
                <div
                    className={menuStyles.panel}
                    role="dialog"
                    aria-label={label}
                    style={panelTop == null ? undefined : { '--xc-filter-panel-top': `${panelTop}px` }}
                >
                    <div className={`${barStyles.bar} ${barStyles.menu}`}>
                        <div className={barStyles.searchWrap}>
                            <span className={barStyles.searchIcon} aria-hidden="true">
                                <Icon.SearchIcon />
                            </span>
                            <Input
                                type="search"
                                size="md"
                                enterKeyHint="search"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                className={barStyles.search}
                                placeholder={searchPlaceholder}
                                aria-label={searchLabel}
                                aria-controls={resultsId}
                                value={query || ''}
                                onChange={(e) => onQueryChange(e.target.value)}
                                onKeyDown={onSearchKeyDown}
                            />
                        </div>
                        {hasNetwork ? (
                            <div className={barStyles.networkWrap}>
                                <NetworkFilter
                                    chainRegistry={chainRegistry}
                                    coinFamilies={coinFamilies}
                                    value={networkFilter || 'all'}
                                    onChange={onNetworkFilterChange}
                                    ariaLabel={t('home.filter.filterByNetwork')}
                                />
                            </div>
                        ) : null}
                        {children}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
