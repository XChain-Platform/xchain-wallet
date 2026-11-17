// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A trade's two token icons, overlapped (wallet-orders-layout-1-ring): the
// traded token first and the one it is paid in tucked under it, as the
// market page's pair badge draws them. My Orders and My Swaps rows lead
// with it. Decorative: the row's title names the trade.

import { TickerIcon } from './TickerIcon.jsx';
import styles from './PairIcons.module.css';

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.first    the traded token's ticker
 * @param {string} props.second   the ticker it is paid in
 */
export function PairIcons({ chainId, first, second }) {
    return (
        <span className={styles.pairIcons} aria-hidden="true">
            <TickerIcon chainId={chainId} tick={first} context="header" pip={false} />
            <TickerIcon chainId={chainId} tick={second} context="header" pip={false} />
        </span>
    );
}
