// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { branding as brandingLib, registry as registryLib } from '@xchain-wallet/core';
import { tickerColor } from './BalanceList.jsx';
import { tickerForDescriptor } from '../../registry/coinTicker.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Chain-aware ticker icon. For a native ticker (BTC/LTC/DOGE) renders
 * the chain's coin icon; for a token renders a colored fallback letter
 * plus the small chain icon as a pip in the bottom-right corner.
 *
 * Mirrors the Receive asset card's icon-with-chain-pip pattern at any
 * size: pass `size` for the main icon's px dimension; the pip scales
 * proportionally.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick
 * @param {number} [props.size=28]
 */
export function TickerIcon({ chainId, tick, size = 28 }) {
    const descriptor = chainRegistry.get(chainId);
    const tickUpper = String(tick || '').toUpperCase();
    const nativeTicker = tickerForDescriptor(descriptor);
    const isNative = !!nativeTicker && tickUpper === nativeTicker;
    const accessibleName = descriptor?.displayName
        ? `${tickUpper || 'Unknown token'} on ${descriptor.displayName}`
        : `${tickUpper || 'Unknown'} token`;
    const pipSize = Math.max(10, Math.round(size * 0.5));
    const wrapStyle = {
        position: 'relative',
        width: size,
        height: size,
        flex: '0 0 auto',
        display: 'inline-block',
    };
    const imgStyle = {
        width: size,
        height: size,
        display: 'block',
        objectFit: 'contain',
        borderRadius: '50%',
    };
    const fallbackStyle = {
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        background: tickerColor(tickUpper),
        color: 'var(--xc-text-inverted)',
        fontWeight: 700,
        fontSize: Math.max(10, Math.round(size * 0.43)),
    };
    const pipStyle = {
        position: 'absolute',
        bottom: -2,
        insetInlineEnd: -2,
        width: pipSize,
        height: pipSize,
        borderRadius: '50%',
        background: 'var(--xc-surface-raised)',
        boxShadow: '0 0 0 1.5px var(--xc-bg-muted)',
        objectFit: 'cover',
        display: 'block',
    };
    const nativeIconUrl = descriptor ? brandingLib.chainIconLargeUrl(descriptor.id) : null;
    const nativeIconSmallUrl = descriptor ? brandingLib.chainIconSmallUrl(descriptor.id) : null;
    const nativeIconSrcSet = nativeIconUrl && nativeIconSmallUrl && nativeIconUrl !== nativeIconSmallUrl
        ? `${nativeIconSmallUrl} 144w, ${nativeIconUrl} 500w`
        : undefined;
    const chainPipUrl = descriptor ? brandingLib.chainIconSmallUrl(descriptor.id) : null;
    return (
        <span role="img" aria-label={accessibleName} style={wrapStyle}>
            {isNative && nativeIconUrl ? (
                <img
                    src={nativeIconUrl}
                    srcSet={nativeIconSrcSet}
                    sizes={nativeIconSrcSet ? `${size}px` : undefined}
                    width={size}
                    height={size}
                    alt=""
                    aria-hidden="true"
                    style={imgStyle}
                    decoding="async"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : (
                <span style={fallbackStyle} aria-hidden="true">
                    {tickUpper.slice(0, 1) || '?'}
                </span>
            )}
            {!isNative && chainPipUrl ? (
                <img
                    src={chainPipUrl}
                    width={pipSize}
                    height={pipSize}
                    alt=""
                    aria-hidden="true"
                    title={descriptor?.displayName}
                    style={pipStyle}
                    decoding="async"
                />
            ) : null}
        </span>
    );
}
