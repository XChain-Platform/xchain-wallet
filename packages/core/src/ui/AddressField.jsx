// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef } from 'react';
import { Input } from './Input.jsx';
import { UsersIcon, ScanIcon } from './icons/index.jsx';
import styles from './AddressField.module.css';

const ICONS = {
    contacts: { Component: UsersIcon, defaultLabel: 'Open address book' },
    addresses: { Component: ScanIcon, defaultLabel: 'Choose address' },
};

/**
 * AddressField: an address input with an optional trailing icon action
 * inside the field. The two canonical icon uses:
 *
 *   - To ("contacts"): outbound destination. The field accepts typed or
 *     pasted addresses; the address-book icon navigates to the user's
 *     saved contacts (ContactsPickerScreen), and picking an entry fills
 *     the field.
 *   - From ("addresses"): the source address a transaction spends from,
 *     always one of the wallet's own. The field is read-only; the QR
 *     icon navigates to the wallet's own address list (the same screen
 *     as change-address) to select one.
 *
 * The component renders the field + icon only; the host owns the picker
 * screen the icon navigates to and writes the result back via
 * `value` / `onChange` (To) or its own selection state (From).
 *
 * Props (all others forward to `Input`, incl. label / size / hint /
 * error / readOnly / onPaste):
 *   - icon          'contacts' | 'addresses'
 *   - onIconClick   () => void   navigate to the picker screen
 *   - iconLabel     accessible label override for the icon button
 *   - onPaste       host callback for URI handling; unconsumed plain text
 *                     with surrounding whitespace is trimmed before insertion
 *
 * @typedef {object} AddressFieldOwnProps
 * @property {'contacts' | 'addresses'} [icon]
 * @property {() => void} [onIconClick]
 * @property {string} [iconLabel]
 */
export const AddressField = forwardRef(function AddressField(
    {
        icon,
        onIconClick,
        iconLabel,
        size = 'md',
        label,
        disabled,
        style,
        value,
        onChange,
        onPaste,
        ...rest
    },
    ref,
) {
    const { Component: IconComponent, defaultLabel } = ICONS[icon] || {};
    const wrapClass = [
        styles.wrap,
        size === 'lg' ? styles.lg : '',
        label ? '' : styles.noLabel,
    ].filter(Boolean).join(' ');

    const handlePaste = (event) => {
        onPaste?.(event);
        if (event.defaultPrevented || typeof onChange !== 'function') return;

        const pasted = event.clipboardData?.getData?.('text');
        if (typeof pasted !== 'string' || pasted === pasted.trim()) return;

        const input = event.currentTarget;
        const current = String(value ?? input.value ?? '');
        const start = input.selectionStart ?? current.length;
        const end = input.selectionEnd ?? start;
        event.preventDefault();
        onChange({
            target: { value: `${current.slice(0, start)}${pasted.trim()}${current.slice(end)}` },
        });
    };

    return (
        <div className={wrapClass}>
            <Input
                ref={ref}
                label={label}
                size={size}
                disabled={disabled}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={IconComponent ? { paddingInlineEnd: '48px', ...style } : style}
                value={value}
                onChange={onChange}
                onPaste={handlePaste}
                {...rest}
            />
            {IconComponent ? (
                <button
                    type="button"
                    className={styles.iconButton}
                    onClick={onIconClick}
                    disabled={disabled}
                    aria-label={iconLabel || defaultLabel}
                    title={iconLabel || defaultLabel}
                >
                    <IconComponent />
                </button>
            ) : null}
        </div>
    );
});
