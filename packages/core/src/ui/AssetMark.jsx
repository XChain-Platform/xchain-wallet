// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import styles from './AssetMark.module.css';

const PALETTE = [
    '#1A74A8', '#7B2C8F', '#0369A1', '#047857', '#B45309',
    '#DC2626', '#7C3AED', '#BE185D', '#0F766E', '#C2410C',
    '#4F46E5', '#4D7C0F', '#0E7490', '#9333EA', '#BE123C',
];

export function tickerColor(tick) {
    const value = String(tick || '');
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return PALETTE[hash % PALETTE.length];
}

/**
 * Displays an asset image with its chain mark overlaid for non-native assets.
 * Native assets use the chain mark itself as their primary image.
 */
export function AssetMark({ chainId, tick, imageUrl = null, isNative = false, className = '' }) {
    const chainIconUrl = branding.chainIconSmallUrl(chainId);
    const handleImageError = useCallback((event) => {
        event.currentTarget.style.display = 'none';
    }, []);
    const initial = String(tick || '?').slice(0, 1).toUpperCase();

    return (
        <span className={`${styles.mark} ${className}`.trim()} data-asset-mark>
            <span
                className={styles.iconLetter}
                style={{ background: tickerColor(tick) }}
                aria-hidden="true"
            >
                {initial}
            </span>
            {isNative && chainIconUrl ? (
                <img
                    src={chainIconUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.image}
                    loading="lazy"
                    decoding="async"
                    onError={handleImageError}
                />
            ) : imageUrl ? (
                <img
                    src={imageUrl}
                    alt=""
                    aria-hidden="true"
                    className={`${styles.image} ${styles.tokenImage}`}
                    loading="lazy"
                    decoding="async"
                    onError={handleImageError}
                />
            ) : null}
            {!isNative && chainIconUrl ? (
                <img
                    src={chainIconUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.chainOverlay}
                    loading="lazy"
                    decoding="async"
                    onError={handleImageError}
                />
            ) : null}
        </span>
    );
}
