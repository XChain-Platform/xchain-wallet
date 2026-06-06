// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import * as branding from '../branding/branding.js';
import styles from './ChainBadge.module.css';

/**
 * Renders a chain's icon + display name with a tinted pill using the
 * chain's own descriptor.color. For non-mainnet networks the network kind
 * is shown in muted text next to the name so users can tell regtest from
 * mainnet at a glance, unless `showNetworkKind` is false.
 *
 * @param {object} props
 * @param {import('../registry/validate.js').ChainDescriptor} props.descriptor
 * @param {'sm' | 'md'} [props.size]
 * @param {boolean} [props.showName]
 * @param {boolean} [props.showNetworkKind]
 */
export function ChainBadge({ descriptor, size = 'sm', showName = true, showNetworkKind = true }) {
    const iconUrl = branding.chainIconSmallUrl(descriptor.id);
    const iconPx = size === 'md' ? 24 : 16;
    const style = { '--chain-color': descriptor.color };
    const className = `${styles.badge} ${styles[size]}`;
    return (
        <span className={className} style={style}>
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
            {showName ? (
                <span className={styles.name}>
                    {descriptor.displayName}
                    {showNetworkKind && descriptor.networkKind !== 'mainnet' ? (
                        <span className={styles.network}> {descriptor.networkKind}</span>
                    ) : null}
                </span>
            ) : null}
        </span>
    );
}
