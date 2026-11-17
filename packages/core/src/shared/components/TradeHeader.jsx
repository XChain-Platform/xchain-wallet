// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The two pieces the Order and Swap pages share in the ring layout
// (wallet-orders-layout-1-ring): the detail header card (the large fill
// ring, the verb, the big amount, what it is for and the status chip) and a
// list row's second line ("for 0.004 BTC · 2 hours ago"). Both hold no
// words of their own; the pages pass them in.

import styles from './TradeHeader.module.css';

/**
 * The detail page's header card.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.ring     the large FillRing
 * @param {import('react').ReactNode} props.verb     "Selling", "Buying" or "Swapping"
 * @param {import('react').ReactNode} props.amount   the big amount ("1,000 XCHAIN")
 * @param {import('react').ReactNode} [props.counter] what it is for ("for 0.004 BTC")
 * @param {import('react').ReactNode} [props.chip]   the status chip
 * @param {string} [props.label]                     the card's accessible name
 */
export function TradeHeader({ ring, verb, amount, counter = null, chip = null, label }) {
    return (
        <section className={styles.header} aria-label={label} data-trade-header>
            {ring}
            <div className={styles.text}>
                <span className={styles.topLine} data-trade-header-top-line>
                    <span className={styles.verb}>{verb}</span>
                    {chip ? <span className={styles.chip}>{chip}</span> : null}
                </span>
                <span className={styles.amount}>{amount}</span>
                {counter ? <span className={styles.counter}>{counter}</span> : null}
            </div>
        </section>
    );
}

/**
 * A list row's second line: its parts in order, a middle dot between them.
 *
 * @param {{ parts: Array<import('react').ReactNode> }} props
 */
export function TradeRowMeta({ parts }) {
    const shown = (parts || []).filter((part) => part != null && part !== '' && part !== false);
    return (
        <span className={styles.rowMeta}>
            {shown.map((part, index) => (
                // The parts are fixed per row, so their position is their identity.
                <span key={index} className={styles.metaItem}>{part}</span>
            ))}
        </span>
    );
}
