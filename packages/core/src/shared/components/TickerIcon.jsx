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
import { branding as brandingLib, registry as registryLib } from '@xchain-wallet/core';
import { tickerColor } from './BalanceList.jsx';
import { IdentityAvatar } from './WalletIdentity.jsx';
import { tickerForDescriptor } from '../../registry/coinTicker.js';

const chainRegistry = registryLib.defaultRegistry();
// Rendered pixel width per avatar context, mirroring --xc-avatar-size-* in
// tokens.css, so the srcset picks the smallest candidate that stays sharp.
const AVATAR_PIXELS = Object.freeze({ header: 28, list: 40, hero: 88 });

/**
 * Chain-aware ticker icon. For a native ticker (BTC/LTC/DOGE) renders
 * the chain's coin icon; for a token renders a colored fallback letter
 * plus the small chain icon as a pip in the bottom-right corner.
 *
 * Mirrors the Receive asset card's icon-with-chain-pip pattern at any
 * context: header, list, and hero surfaces consume the shared avatar scale.
 * The numeric size remains accepted and maps legacy callers to a context.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick
 * @param {number} [props.size] legacy size mapped to the nearest context
 * @param {'header'|'list'|'hero'} [props.context='list']
 */
export function TickerIcon({ chainId, tick, size, context }) {
    const [failedImageUrl, setFailedImageUrl] = useState(null);
    const descriptor = chainRegistry.get(chainId);
    const tickUpper = String(tick || '').toUpperCase();
    const nativeTicker = tickerForDescriptor(descriptor);
    const isNative = !!nativeTicker && tickUpper === nativeTicker;
    const accessibleName = descriptor?.displayName
        ? `${tickUpper || 'Unknown token'} on ${descriptor.displayName}`
        : `${tickUpper || 'Unknown'} token`;
    const avatarContext = context || contextForLegacySize(size);
    const avatarSize = `var(--xc-avatar-size-${avatarContext})`;
    const pipSize = `var(--xc-avatar-pip-${avatarContext})`;
    const wrapStyle = {
        position: 'relative',
        width: avatarSize,
        height: avatarSize,
        flex: '0 0 auto',
        display: 'inline-block',
        verticalAlign: 'middle',
    };
    const pipStyle = {
        position: 'absolute',
        bottom: -2,
        insetInlineEnd: -2,
        width: pipSize,
        height: pipSize,
        borderRadius: 'var(--xc-avatar-shape)',
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
    const showNativeIcon = isNative && nativeIconUrl && failedImageUrl !== nativeIconUrl;
    return (
        <span role="img" aria-label={accessibleName} style={wrapStyle}>
            <IdentityAvatar
                name={tickUpper || '?'}
                seed={`${chainId}:${tickUpper}`}
                context={avatarContext}
                tone={tickerColor(tickUpper)}
                variant="asset"
                src={showNativeIcon ? nativeIconUrl : null}
                srcSet={showNativeIcon ? nativeIconSrcSet : undefined}
                imagePixels={AVATAR_PIXELS[avatarContext]}
            />
            {!isNative && chainPipUrl && failedImageUrl !== chainPipUrl ? (
                <img
                    src={chainPipUrl}
                    width={pipSize}
                    height={pipSize}
                    alt=""
                    aria-hidden="true"
                    title={descriptor?.displayName}
                    style={pipStyle}
                    decoding="async"
                    onError={() => setFailedImageUrl(chainPipUrl)}
                />
            ) : null}
        </span>
    );
}

function contextForLegacySize(size) {
    if (typeof size !== 'number') return 'list';
    if (size <= 24) return 'header';
    if (size > 48) return 'hero';
    return 'list';
}
