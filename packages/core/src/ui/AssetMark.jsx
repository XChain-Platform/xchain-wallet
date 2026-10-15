// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
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
 * The overlay is how a row tells the same ticker on two chains apart (rows
 * carry no chain text), so a token always gets one: a chain with no bundled
 * icon, or whose icon fails to load, gets a lettered chain badge instead.
 * Native assets use the chain mark itself as their primary image. The neutral
 * monogram renders only when no artwork is showing, so transparent artwork
 * never reveals a letter behind it; a failed image falls back to the monogram.
 */
export function AssetMark({ chainId, tick, imageUrl = null, isNative = false, className = '' }) {
    const chainIconUrl = branding.chainIconSmallUrl(chainId);
    const artworkUrl = isNative ? chainIconUrl : imageUrl;
    const [failedArtworkUrl, setFailedArtworkUrl] = useState(null);
    const showArtwork = Boolean(artworkUrl) && failedArtworkUrl !== artworkUrl;
    const handleArtworkError = useCallback(() => {
        setFailedArtworkUrl(artworkUrl);
    }, [artworkUrl]);
    const [failedChainIconUrl, setFailedChainIconUrl] = useState(null);
    const showChainIcon = Boolean(chainIconUrl) && failedChainIconUrl !== chainIconUrl;
    const handleChainIconError = useCallback(() => {
        setFailedChainIconUrl(chainIconUrl);
    }, [chainIconUrl]);
    const initial = String(tick || '?').slice(0, 1).toUpperCase();
    const chainInitial = String(chainId || '?').split('-')[0].slice(0, 1).toUpperCase() || '?';

    return (
        <span className={`${styles.mark} ${className}`.trim()} data-asset-mark>
            {!showArtwork ? (
                <span className={styles.iconLetter} aria-hidden="true">
                    {initial}
                </span>
            ) : null}
            {showArtwork && isNative ? (
                <img
                    src={chainIconUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.image}
                    loading="lazy"
                    decoding="async"
                    onError={handleArtworkError}
                />
            ) : showArtwork ? (
                <img
                    src={imageUrl}
                    alt=""
                    aria-hidden="true"
                    className={`${styles.image} ${styles.tokenImage}`}
                    loading="lazy"
                    decoding="async"
                    onError={handleArtworkError}
                />
            ) : null}
            {!isNative && showChainIcon ? (
                <img
                    src={chainIconUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.chainOverlay}
                    loading="lazy"
                    decoding="async"
                    onError={handleChainIconError}
                    data-chain-overlay
                />
            ) : null}
            {!isNative && !showChainIcon ? (
                <span
                    className={`${styles.chainOverlay} ${styles.chainOverlayLetter}`}
                    aria-hidden="true"
                    data-chain-overlay
                >
                    {chainInitial}
                </span>
            ) : null}
        </span>
    );
}
