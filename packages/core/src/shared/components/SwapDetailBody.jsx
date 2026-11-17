// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Swap Details pieces in the ring layout (wallet-orders-layout-1-ring):
// the header card (the large fill ring, "Swapping", the give amount, what it
// is for and the status chip), the Details panel (the facts as label-left,
// value-right rows in one card, no copy buttons) and the Matches section
// (the swap's lifecycle timeline, the Matches tab's panel). SwapDetail owns
// the reads and the actions; this module only lays the swap out, so the
// session can restyle it without touching the page's data.

import { AddressText, ChainBadge, Icon, SectionHeader } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/actionDetail.js';
import '../../i18n/locales/en/addressList.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/issue.js';
import '../../i18n/locales/en/mySwaps.js';
import '../../i18n/locales/en/publishFile.js';
import '../../i18n/locales/en/send.js';
import { formatActivityTime } from '../utils/dateTime.js';
import { placedAt, shortHash } from '../utils/orderView.js';
import { SwapFillRing, SwapStatusChip } from './SwapRow.jsx';
import { TradeHeader } from './TradeHeader.jsx';
import S from './SwapViews.module.css';

/**
 * The details header card. The give amount, what it is for and the status
 * carry the swap-detail-give, -get and -status test ids the facts card
 * used to hold, since the header is always on screen.
 *
 * @param {{ give: string, get: string, status: string }} props
 */
export function SwapHeader({ give, get, status }) {
    return (
        <TradeHeader
            label={t('mySwaps.detail.title')}
            ring={<SwapFillRing status={status} size="lg" />}
            verb={t('mySwaps.detail.swapping')}
            amount={<span data-testid="swap-detail-give">{give}</span>}
            counter={<span data-testid="swap-detail-get">{t('mySwaps.row.for', { amount: get })}</span>}
            chip={<span data-testid="swap-detail-status"><SwapStatusChip status={status} /></span>}
        />
    );
}

/**
 * The Details panel.
 *
 * @param {object} props
 * @param {any} [props.row]                    the swap row, for its placed time
 * @param {string | null} [props.expiryText]
 * @param {any} [props.descriptor]
 * @param {string | number} props.actionIndex
 * @param {string | null} [props.ownerAddress]
 * @param {string | null} [props.txHash]
 * @param {string | null} [props.explorerUrl]  the transaction's explorer page
 * @param {string | null} [props.allowList]    bound allow-list action index
 * @param {string | null} [props.blockList]    bound block-list action index
 */
export function SwapDetailBody({
    row = null,
    expiryText = null,
    descriptor = null,
    actionIndex,
    ownerAddress = null,
    txHash = null,
    explorerUrl = null,
    allowList = null,
    blockList = null,
}) {
    const listText = (index) => (index ? t('mySwaps.detail.listIndex', { index: String(index) }) : t('send.advanced.none'));
    const placed = placedAt(row);
    return (
        <div className={S.details}>
            <dl className={S.facts} aria-label={t('mySwaps.detail.title')}>
                {expiryText ? (
                    <div className={S.fact} data-testid="swap-detail-expires">
                        <dt>{t('components.expiration.expires')}</dt>
                        <dd>{expiryText}</dd>
                    </div>
                ) : null}
                {placed ? (
                    <div className={S.fact} data-testid="swap-detail-placed">
                        <dt>{t('mySwaps.detail.placed')}</dt>
                        <dd>{formatActivityTime(placed)}</dd>
                    </div>
                ) : null}
                {descriptor ? (
                    <div className={S.fact} data-testid="swap-detail-network">
                        <dt>{t('addressList.detail.network')}</dt>
                        <dd><ChainBadge descriptor={descriptor} size="sm" showName /></dd>
                    </div>
                ) : null}
                <div className={S.fact} data-testid="swap-detail-index">
                    <dt>{t('components.placeOrderPanel.swap')}</dt>
                    <dd>{t('mySwaps.row.index', { index: String(actionIndex ?? '') })}</dd>
                </div>
                {ownerAddress ? (
                    <div className={S.fact} data-testid="swap-detail-from">
                        <dt>{t('send.fields.from')}</dt>
                        <dd><span className={S.addressBox}><AddressText address={ownerAddress} fit /></span></dd>
                    </div>
                ) : null}
                <div className={S.fact} data-testid="swap-detail-allow-list">
                    <dt>{t('issue.allowList')}</dt>
                    <dd>{listText(allowList)}</dd>
                </div>
                <div className={S.fact} data-testid="swap-detail-block-list">
                    <dt>{t('issue.blockList')}</dt>
                    <dd>{listText(blockList)}</dd>
                </div>
                {txHash ? (
                    <div className={S.fact} data-testid="swap-detail-transaction">
                        <dt>{t('publishFile.done.transaction')}</dt>
                        <dd>
                            <code className={S.mono} title={txHash}>{shortHash(txHash)}</code>
                            {explorerUrl ? (
                                /* The kit has no link-button primitive for an external explorer destination. */
                                <a
                                    className={S.txLink}
                                    href={explorerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={t('actionDetail.actions.viewOnExplorer')}
                                    title={t('actionDetail.actions.viewOnExplorer')}
                                >
                                    <Icon.ExternalLinkIcon />
                                </a>
                            ) : null}
                        </dd>
                    </div>
                ) : null}
            </dl>
        </div>
    );
}

/**
 * The Matches section: the swap's lifecycle timeline under its heading, the
 * Matches tab's panel (or under Details on a page without the tabs).
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function SwapMatches({ children }) {
    return (
        <section className={S.section} aria-label={t('mySwaps.detail.matches')}>
            <SectionHeader title={t('mySwaps.detail.matches')} />
            {children}
        </section>
    );
}
