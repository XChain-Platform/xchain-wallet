// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import styles from './AddressText.module.css';

/**
 * Keeps both identifying ends of a long address visible.
 *
 * @param {string} address
 * @returns {string}
 */
export function truncateAddress(address) {
    if (typeof address !== 'string' || address.length <= 14) {
        return address;
    }
    return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

/**
 * Monospace address display.
 *
 * Long identifiers render as `first6…last6` unless the context explicitly
 * requires the full value. Focusing a truncated value reveals the full
 * identifier without wrapping it, and copying always writes the full value.
 *
 * - When `highlight` is set, the address renders as three spans:
 *   first 6 (head, accent) / middle (muted) / last 6 (tail, accent).
 *   This is the §21.5 "checksum-positional highlighting" treatment.
 *   The head and tail still mark the identifying ends, with the muted
 *   middle pointing at the elided characters.
 *
 * @param {object} props
 * @param {string} props.address
 * @param {boolean} [props.truncate]
 * @param {boolean} [props.highlight]
 * @param {'sm' | 'md'} [props.size]
 * @param {string} [props.className]
 */
export function AddressText({ address, truncate = true, highlight = false, size = 'md', className = '' }) {
    const [focused, setFocused] = useState(false);
    const cls = `${styles.addr} ${styles[size]} ${className}`.trim();
    if (typeof address !== 'string' || address.length === 0) {
        return <span className={cls} dir="ltr">…</span>;
    }
    if (address.length <= 14) {
        return (
            <span className={cls} title={address} aria-label={address} dir="ltr">
                {address}
            </span>
        );
    }
    const head = address.slice(0, 6);
    const tail = address.slice(-6);
    const middleFull = address.slice(6, -6);
    const displayStyle = {
        display: 'inline-block',
        maxWidth: '100%',
        overflowX: focused ? 'auto' : 'hidden',
        verticalAlign: 'bottom',
        whiteSpace: 'nowrap',
        wordBreak: 'normal',
    };
    const commonProps = {
        className: cls,
        title: address,
        'aria-label': address,
        dir: 'ltr',
        tabIndex: 0,
        style: displayStyle,
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onCopy: (event) => {
            if (event.clipboardData) {
                event.clipboardData.setData('text/plain', address);
                event.preventDefault();
            }
        },
    };
    if (!highlight) {
        return <span {...commonProps}>{focused || !truncate ? address : truncateAddress(address)}</span>;
    }
    return (
        <span {...commonProps}>
            <span className={styles.head}>{head}</span>
            <span className={styles.middle}>{focused || !truncate ? middleFull : '…'}</span>
            <span className={styles.tail}>{tail}</span>
        </span>
    );
}
