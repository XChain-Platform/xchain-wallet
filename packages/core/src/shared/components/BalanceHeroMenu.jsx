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
import { Button, Icon } from '@xchain-wallet/core/ui';
import styles from './TotalBalanceHero.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

/**
 * @typedef {object} BalanceHeroMenuItem
 * @property {string} id
 * @property {string} label
 * @property {import('react').ComponentType} Icon
 * @property {() => void} onSelect
 * @property {boolean} [disabled]
 * @property {boolean} [checked]        a toggle row; undefined renders a plain menuitem
 * @property {string} [keyShortcuts]
 * @property {string} [className]
 */

function enabledMenuItems(menu) {
    return Array.from(menu?.querySelectorAll([
        '[role="menuitem"]:not([aria-disabled="true"])',
        '[role="menuitemcheckbox"]:not([aria-disabled="true"])',
    ].join(',')) || []);
}

/**
 * The one "Balance actions" control a balance hero carries at every width:
 * a three-dots trigger that opens a menu of the hero's toggles (swap the
 * primary unit, hide the chart, hide the balance) plus any screen-specific
 * rows such as Home's refresh, settings, search, filter and lock.
 *
 * Opens on click, closes on Escape (focus returns to the trigger), on a
 * press outside, when focus leaves the menu, and after a row runs. Arrow
 * keys, Home and End move between enabled rows.
 *
 * @param {object} props
 * @param {BalanceHeroMenuItem[]} props.items        the hero's own toggles
 * @param {BalanceHeroMenuItem[]} [props.extraItems] screen-specific rows listed after the toggles
 * @param {string} [props.className]                 placement class from the host hero
 */
export function BalanceHeroMenu({ items, extraItems = [], className }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const rows = [...(items || []), ...(extraItems || [])].filter(Boolean);
    const label = t('components.totalBalanceHero.balanceActions');

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
        // Tabbing out of the menu closes it, as the header menu does, so no
        // menu stays open while focus sits on the page behind it.
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
        if (open) enabledMenuItems(menuRef.current)[0]?.focus();
    }, [open]);

    const onMenuKeyDown = (event) => {
        if (!event.target.closest?.('[role="menuitem"], [role="menuitemcheckbox"]')) return;
        const enabled = enabledMenuItems(menuRef.current);
        const index = enabled.indexOf(document.activeElement);
        let nextIndex = null;
        if (event.key === 'ArrowDown') nextIndex = (index + 1) % enabled.length;
        if (event.key === 'ArrowUp') nextIndex = (index - 1 + enabled.length) % enabled.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = enabled.length - 1;
        if (nextIndex === null || enabled.length === 0) return;
        event.preventDefault();
        enabled[nextIndex]?.focus();
    };

    return (
        <div ref={wrapRef} className={`${styles.menuWrap} ${className || ''}`}>
            <Button
                ref={triggerRef}
                type="button"
                className={styles.eye}
                onClick={() => setOpen((value) => !value)}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open ? 'true' : 'false'}
                title={label}
                icon={<Icon.MoreIcon />}
            >
                {null}
            </Button>
            {open ? (
                <div
                    ref={menuRef}
                    className={styles.actionMenu}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onMenuKeyDown}
                >
                    {rows.map(({ id, label: rowLabel, Icon: RowIcon, onSelect, disabled, checked, keyShortcuts, className: rowClass }) => (
                        <Button
                            key={id}
                            type="button"
                            role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                            className={`${styles.actionRow} ${rowClass || ''}`}
                            disabled={disabled}
                            aria-disabled={disabled ? 'true' : undefined}
                            aria-checked={checked === undefined ? undefined : String(Boolean(checked))}
                            aria-keyshortcuts={keyShortcuts}
                            onClick={() => {
                                setOpen(false);
                                triggerRef.current?.focus();
                                onSelect();
                            }}
                            icon={<RowIcon />}
                        >
                            {rowLabel}
                        </Button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
