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
import { Button, Icon, RadioGroup } from '@xchain-wallet/core/ui';
import { HomeFilterBar } from './HomeFilterBar.jsx';
import styles from './HomeListFilterMenu.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/walletDetails.js';

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
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const canFilter = typeof onNetworkFilterChange === 'function'
        && typeof onTokenQueryChange === 'function';
    const filterActive = Boolean(tokenQuery?.trim()) || networkFilter !== 'all';

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
        if (open) wrapRef.current?.querySelector('input[type="radio"]:checked')?.focus();
    }, [open]);

    const label = t('home.filter.filterAndSort');
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
            {open ? (
                <div className={styles.panel} role="dialog" aria-label={label}>
                    <RadioGroup
                        className={styles.sortGroup}
                        legend={t('home.filter.sort')}
                        value={sortBy}
                        onChange={onSortChange}
                        options={[
                            { value: 'name', label: t('walletDetails.name') },
                            { value: 'value', label: t('home.tabs.value') },
                        ]}
                    />
                    {canFilter ? (
                        <HomeFilterBar
                            variant="menu"
                            chainRegistry={chainRegistry}
                            coinFamilies={coinFamilies || []}
                            networkFilter={networkFilter}
                            onNetworkFilterChange={onNetworkFilterChange}
                            tokenQuery={tokenQuery}
                            onTokenQueryChange={onTokenQueryChange}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
