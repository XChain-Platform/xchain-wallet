// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import * as branding from '../branding/branding.js';
import styles from './ChainBadge.module.css';

/**
 * Renders a chain icon with an optional display name. The wrapper keeps the
 * display name as its accessible name when the visible label is omitted.
 *
 * @param {object} props
 * @param {import('../registry/validate.js').ChainDescriptor} props.descriptor
 * @param {'sm' | 'md'} [props.size]
 * @param {boolean} [props.showName]
 */
export function ChainBadge({ descriptor, size = 'sm', showName = false }) {
    const iconUrl = branding.chainIconSmallUrl(descriptor.id);
    const iconPx = size === 'md' ? 24 : 16;
    const style = { '--chain-color': descriptor.color };
    const className = `${styles.badge} ${styles[size]}`;
    return (
        // An icon-only badge is an image named for its chain; with the name shown,
        // the visible text names it.
        <span
            className={className}
            style={style}
            role={showName ? undefined : 'img'}
            aria-label={showName ? undefined : descriptor.displayName}
        >
            {iconUrl ? (
                <img
                    src={iconUrl}
                    alt=""
                    className={styles.icon}
                    width={iconPx}
                    height={iconPx}
                />
            ) : (
                <span className={styles.iconFallback} aria-hidden="true">
                    {descriptor.coin.slice(0, 1).toUpperCase()}
                </span>
            )}
            {showName ? <span>{descriptor.displayName}</span> : null}
        </span>
    );
}
