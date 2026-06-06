// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import styles from './AddressText.module.css';

/**
 * Monospace address display.
 *
 * - When `truncate` is true (default), addresses longer than 14
 *   characters render as `first6…last6`. Full address available via
 *   `title` and `aria-label`.
 *
 * - When `highlight` is set, the address renders as three spans —
 *   first 6 (head, accent) / middle (muted) / last 6 (tail, accent).
 *   This is the §21.5 "checksum-positional highlighting" treatment.
 *   Combines with `truncate`: the head and tail still mark the
 *   identifying ends, with the muted middle pointing at the elided
 *   characters.
 *
 * @param {object} props
 * @param {string} props.address
 * @param {boolean} [props.truncate]
 * @param {boolean} [props.highlight]
 * @param {'sm' | 'md'} [props.size]
 */
export function AddressText({ address, truncate = true, highlight = false, size = 'md' }) {
    const cls = `${styles.addr} ${styles[size]}`;
    if (typeof address !== 'string' || address.length === 0) {
        return <span className={cls}>—</span>;
    }
    if (address.length <= 14) {
        return (
            <span className={cls} title={address} aria-label={address}>
                {address}
            </span>
        );
    }
    const head = address.slice(0, 6);
    const tail = address.slice(-6);
    const middleFull = address.slice(6, -6);
    if (!highlight) {
        const display = truncate ? `${head}…${tail}` : address;
        return (
            <span className={cls} title={address} aria-label={address}>
                {display}
            </span>
        );
    }
    return (
        <span className={cls} title={address} aria-label={address}>
            <span className={styles.head}>{head}</span>
            <span className={styles.middle}>{truncate ? '…' : middleFull}</span>
            <span className={styles.tail}>{tail}</span>
        </span>
    );
}
