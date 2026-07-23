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
 * AddressField: an address input with a single trailing icon action
 * inside the field. The two canonical uses:
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
 *
 * @typedef {object} AddressFieldOwnProps
 * @property {'contacts' | 'addresses'} icon
 * @property {() => void} onIconClick
 * @property {string} [iconLabel]
 */
export const AddressField = forwardRef(function AddressField(
    { icon, onIconClick, iconLabel, size = 'md', label, disabled, style, ...rest },
    ref,
) {
    const { Component: IconComponent, defaultLabel } = ICONS[icon] || ICONS.contacts;
    const wrapClass = [
        styles.wrap,
        size === 'lg' ? styles.lg : '',
        label ? '' : styles.noLabel,
    ].filter(Boolean).join(' ');
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
                style={{ paddingInlineEnd: '48px', ...style }}
                {...rest}
            />
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
        </div>
    );
});
