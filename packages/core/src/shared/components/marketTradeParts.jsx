// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Small parts the Market page, the Trade page and the order form share:
// the Buy and Sell arrows (the shared icon set has neither shape),
// the Trade page's swap ticket and the trade-history price tidier.

import { roundDecimalString, trimAmountTail } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/market.js';
import { GiveGetQuick } from './giveGet/index.js';
import styles from './MarketTrading.module.css';

// The pair is set by the page, so the coin chips have nothing to pick.
const fixedAsset = () => {};

/**
 * The Trade page's Swap mode ticket, drawn with the shared Give/Get Quick
 * cards so a swap looks the same everywhere: You pay over You get, a round
 * flip between them, and the Buying or Selling tag beside the flip. The host
 * keeps all state (values, edits and the side).
 *
 * @param {object} props
 * @param {'buy' | 'sell'} props.side
 * @param {string} props.chainId
 * @param {string} props.payTick
 * @param {string} props.getTick
 * @param {string} props.payValue
 * @param {string} props.getValue
 * @param {(raw: string) => void} props.onPayChange
 * @param {(raw: string) => void} props.onGetChange
 * @param {() => void} props.onSettle    focus left a field: the typed side settles to its exact value
 * @param {string} props.payBalance      'Balance 0.1234'
 * @param {string} [props.getNote]       'at 0.0000006291 each'
 * @param {() => void} props.onFlip
 */
export function SwapTicket({ side, chainId, payTick, getTick, payValue, getValue, onPayChange, onGetChange, onSettle, payBalance, getNote, onFlip }) {
    const buying = side === 'buy';
    return (
        // React's onBlur bubbles, so leaving either amount field settles the draft.
        <div className={styles.quickTicket} onBlur={onSettle}>
            <GiveGetQuick
                give={{
                    label: 'You pay',
                    asset: { chainId, tick: payTick },
                    assetLabel: t('market.trade.payAsset'),
                    onOpenAsset: fixedAsset,
                    amount: payValue,
                    onAmountChange: onPayChange,
                    amountLabel: 'You pay',
                    footNote: (
                        <span className={buying ? styles.flipTagBuy : styles.flipTagSell}>
                            {buying ? t('market.trade.buying') : t('market.trade.selling')}
                        </span>
                    ),
                    balanceText: payBalance,
                }}
                get={{
                    label: 'You get',
                    asset: { chainId, tick: getTick },
                    assetLabel: t('market.trade.getAsset'),
                    onOpenAsset: fixedAsset,
                    amount: getValue,
                    onAmountChange: onGetChange,
                    amountLabel: 'You get',
                    balanceText: getNote || undefined,
                }}
                onFlip={onFlip}
                flipLabel={buying ? 'Flip to sell' : 'Flip to buy'}
            />
        </div>
    );
}

/** Buy: an arrow into the wallet. */
export function BuyGlyph() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-xc-icon="">
            <path d="M17 7 7 17" />
            <path d="M16 17H7V8" />
        </svg>
    );
}

/** Sell: an arrow out of the wallet. */
export function SellGlyph() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-xc-icon="">
            <path d="M7 17 17 7" />
            <path d="M8 7h9v9" />
        </svg>
    );
}

/**
 * A trade price at a readable length: 8 places, or four significant digits
 * past the leading zeros when the price is that small. A trade-history price
 * can carry 18 places; the book's own prices pass unchanged.
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function tidyQuotePrice(value) {
    if (value === null || value === undefined) return null;
    const s = trimAmountTail(String(value));
    if (!/^\d+\.\d+$/.test(s)) return s || null;
    const [whole, frac] = s.split('.');
    const lead = frac.search(/[1-9]/);
    if (whole !== '0' || lead < 0) return trimAmountTail(roundDecimalString(s, 8) ?? s);
    return trimAmountTail(roundDecimalString(s, Math.max(8, lead + 4)) ?? s);
}
