// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { bridgeDisplayTick, coinDisplay } from './BridgeTick.js';
import { t } from '../../i18n/index.js';

/**
 * A bridged token's name, as a user should read it.
 *
 * A copy of PEPECASH on Dogecoin is stored as `BTC.PEPECASH`
 * (xchain-token-bridge.md section 3: the bridged row lives under its origin
 * chain's root). The rooted string is the wire name and means nothing to a
 * holder, so every surface renders the bare name with a badge that explicitly
 * says it is bridged and names the origin. This follows the `USDT.e`
 * presentation that the spec cites as the accepted precedent.
 *
 * Two things this must NOT do, because both would mislead about ownership of a
 * real balance:
 *
 *   - drop the origin. "PEPECASH" alone on Dogecoin would read as a Dogecoin
 *     token, and a squatter could issue a DIFFERENT bare PEPECASH there. The
 *     badge is what distinguishes them;
 *   - show a badge on a native row. A token native to this chain has no origin
 *     to name, and a badge there would imply it came from somewhere else.
 *
 * `localCoin` is what makes the second case correct: `BTC.PEPECASH` on BITCOIN
 * is an ordinary subasset of the reserved root, not a bridged copy, and takes no
 * badge. Callers pass the chain the row is being shown on.
 *
 * @param {object} props
 * @param {string} props.tick
 * @param {string} [props.localCoin]  this chain's native ticker or coin id
 * @param {string} [props.className]  applied to the wrapping span
 */
export function BridgeOriginTick({ tick, localCoin, className }) {
    const { label, origin } = bridgeDisplayTick(tick, localCoin);
    if (!origin) return <>{label}</>;
    return (
        <span className={className}>
            {label}
            {' '}
            <span
                style={badgeStyle}
                // The wire name is what the explorer, the indexer and any
                // support conversation use, so it stays reachable on hover
                // rather than being hidden behind the friendlier rendering.
                title={t('bridgeOrigin.onChainName', { tick })}
            >
                {t('bridgeOrigin.from', { origin: coinDisplay(origin) })}
            </span>
        </span>
    );
}

const badgeStyle = {
    display: 'inline-block',
    padding: '0 var(--xc-space-1, 4px)',
    borderRadius: 'var(--xc-radius-sm, 4px)',
    border: '1px solid var(--xc-border)',
    background: 'var(--xc-bg-muted)',
    color: 'var(--xc-text-muted)',
    fontSize: '0.75em',
    fontWeight: 600,
    lineHeight: 1.6,
    verticalAlign: 'middle',
    maxWidth: '100%',
    overflowWrap: 'anywhere',
};
