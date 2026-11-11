// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { ROUTE_NAV_SECTIONS, TAB_BAR_DESTINATIONS } from '../routeRegistry.js';
import { walletMenuRow, walletMenuRowVisible } from '../walletMenu.js';
import buttonStyles from '../../ui/Button.module.css';
import styles from './BottomTabBar.module.css';
import { t } from '../../i18n/index.js';

const BUTTON_BASE = `${buttonStyles.btn} ${buttonStyles.ghost} ${buttonStyles.md}`;
const TAB_CLASS = `${BUTTON_BASE} ${styles.tab}`;

function tabRow(id) {
    const row = walletMenuRow(id);
    return {
        ...row,
        label: t(row.labelKey),
        Icon: Icon[row.icon],
    };
}

const TABS = TAB_BAR_DESTINATIONS.map(tabRow);

function activeTabFor(currentView, tabs) {
    const section = ROUTE_NAV_SECTIONS[currentView];
    return tabs.some((tab) => tab.id === section) ? section : null;
}

function scrollMainToTop() {
    const main = typeof document === 'undefined' ? null : document.getElementById('xc-main');
    if (main) main.scrollTop = 0;
}

/**
 * Five catalogue-backed destinations for compact wallet layouts.
 *
 * @param {object} props
 * @param {string} props.currentView
 * @param {(view: string) => void} props.onSelect
 * @param {() => void} props.onOpenSettings
 * @param {boolean} [props.isSignerMode]
 */
export function BottomTabBar({
    currentView,
    onSelect,
    onOpenSettings,
    isSignerMode = false,
}) {
    const [rovingTab, setRovingTab] = useState(null);
    const tabs = TABS.filter((tab) => walletMenuRowVisible(tab, { isSignerMode }));
    const activeTab = activeTabFor(currentView, tabs);
    const tabIds = tabs.map((tab) => tab.id);
    const tabStop = rovingTab && tabIds.includes(rovingTab)
        ? rovingTab
        : (activeTab || tabIds[0]);

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--xc-bottom-bar-h', '3.5rem');
        return () => root.style.removeProperty('--xc-bottom-bar-h');
    }, []);

    const onBarKeyDown = (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const current = event.target.closest?.('[data-bottom-tab]');
        if (!current) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('[data-bottom-tab]'));
        const index = buttons.indexOf(current);
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        if (next === null || next === index) return;
        event.preventDefault();
        buttons[next].focus();
    };

    return (
        <nav
            className={styles.bar}
            aria-label={t('components.bottomTabBar.bottomNavigation')}
            onKeyDown={onBarKeyDown}
        >
            {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        data-bottom-tab={tab.id}
                        tabIndex={tabStop === tab.id ? 0 : -1}
                        className={`${TAB_CLASS} ${active ? styles.tabActive : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onFocus={() => setRovingTab(tab.id)}
                        onClick={() => {
                            if (active) scrollMainToTop();
                            if (tab.id === 'settings') onOpenSettings?.();
                            else onSelect(tab.id);
                        }}
                    >
                        <span className={styles.tabIcon} aria-hidden="true">
                            <tab.Icon />
                        </span>
                        <span className={styles.tabLabel}>{tab.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
