// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One My Swaps list row: the pair's token icons, the swap in words, what it
// is for and when it was placed, and the fill ring with the status word. The
// whole row is one button that opens the swap's details; it holds no actions
// of its own. Presentational only, so the session can restyle it without
// touching the list's data.

import { ListRow } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { formatActivityTime } from '../utils/dateTime.js';
import { fillRingLook, placedAt, sideAmountText } from '../utils/orderView.js';
import { FillRing } from './FillRing.jsx';
import { PairIcons } from './PairIcons.jsx';
import { TradeRowMeta } from './TradeHeader.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/mySwaps.js';
import '../../i18n/locales/en/settings.js';
import S from './SwapViews.module.css';
import L from '../routes/ObligationsView.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * The chip text for a derived swap status. Open and Cancelled reuse the
 * keys that already hold those words.
 *
 * @param {string} status
 */
export function swapStatusLabel(status) {
    switch (status) {
        case 'open': return t('settings.developer.open');
        case 'settled': return t('mySwaps.status.settled');
        case 'cancelling': return t('mySwaps.status.cancelling');
        case 'cancelled': return t('mySwaps.status.closed');
        case 'expired': return t('mySwaps.status.expired');
        default: return t('mySwaps.status.invalid');
    }
}

/**
 * The status chip, shared by the row and the details page.
 *
 * @param {{ status: string }} props
 */
export function SwapStatusChip({ status }) {
    const label = swapStatusLabel(status);
    return (
        <span
            className={`${S.chip} ${status === 'open' ? S.chipOpen : S.chipClosed}`}
            data-testid="swap-status-chip"
            data-status={status}
        >
            {label}
        </span>
    );
}

/**
 * A swap's give and get in the ring layout's words: the grouped amounts
 * ("500 PEPECASH") and the two tickers for the pair icons. A swap with no
 * row falls back to the display text it was handed.
 *
 * @param {any} row
 * @param {string | null | undefined} chainId
 * @param {{ give?: string, get?: string }} [fallback]
 */
export function swapTerms(row, chainId, fallback = {}) {
    const nativeTick = chainId ? (tickerForDescriptor(chainRegistry.get(chainId)) || '') : '';
    if (!row || typeof row !== 'object') {
        return { give: fallback.give || '', get: fallback.get || '', giveUnit: '', getUnit: '' };
    }
    return {
        give: sideAmountText(row.give_tick, row.give_coin, row.give_amount, row.give_ownership, nativeTick),
        get: sideAmountText(row.get_tick, row.get_coin, row.get_amount, row.get_ownership, nativeTick),
        giveUnit: String(row.give_tick || row.give_coin || nativeTick || ''),
        getUnit: String(row.get_tick || row.get_coin || nativeTick || ''),
    };
}

/**
 * The fill ring a swap shows on its row (small, with the status word) and
 * its details header (large). A swap is single-fill, so it reads 0% until it
 * settles and 100% with a tick once it has.
 *
 * @param {{ status: string, size?: 'sm' | 'lg' }} props
 */
export function SwapFillRing({ status, size = 'sm' }) {
    const percent = status === 'settled' ? 100 : 0;
    const { tone, mark } = fillRingLook(status);
    return (
        <FillRing
            percent={percent}
            tone={tone}
            mark={mark}
            size={size}
            status={status}
            caption={size === 'sm' ? swapStatusLabel(status) : null}
            fitCaption
            label={t('mySwaps.ring.filled', { percent: String(percent) })}
        />
    );
}

/**
 * One My Swaps row in the ring layout (wallet-orders-layout-1-ring): the
 * pair's token icons overlapped, "Swap 500 PEPECASH", "for 40 WOW" and when
 * it was placed, then the fill ring with the status word under it.
 *
 * @param {object} props
 * @param {string} props.give            what the swap gives, as display text
 * @param {string} props.get             what the swap gets, as display text
 * @param {string} props.status          the derived status: open, settled, cancelling, cancelled, expired or invalid
 * @param {string | number} props.actionIndex
 * @param {any} [props.row]              the swap row, for the grouped amounts, tickers and placed time
 * @param {string} [props.chainId]       the swap's chain, for the native coin's ticker and icon
 * @param {() => void} props.onOpen
 */
export function SwapRow({ give, get, status, actionIndex, row, chainId, onOpen }) {
    const terms = swapTerms(row, chainId, { give, get });
    const placed = placedAt(row);
    return (
        <ListRow
            type="button"
            onClick={onOpen}
            aria-label={t('mySwaps.row.open', {
                index: String(actionIndex ?? ''),
                give,
                get,
                status: swapStatusLabel(status),
            })}
            chevron
            leading={chainId && terms.giveUnit ? (
                <PairIcons chainId={chainId} first={terms.giveUnit} second={terms.getUnit} />
            ) : null}
            title={t('mySwaps.row.title', { amount: terms.give })}
            subtitle={(
                <TradeRowMeta
                    parts={[
                        t('mySwaps.row.for', { amount: terms.get }),
                        placed ? formatActivityTime(placed) : null,
                    ]}
                />
            )}
            trailing={<SwapFillRing status={status} />}
            trailingClassName={L.ringSlot}
        />
    );
}
