// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    ChainBadge,
    AddressText,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useCoinpayObligations } from '../hooks/useCoinpayObligations.js';
import {
    classifyObligation,
    countdownText,
    baseUnitsToCoinText,
} from '../../market/obligationStatus.js';
import { coinpayExpiryText } from '../../market/coinpayExpiry.js';
import styles from './ObligationsView.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * §41.4 / PC-15: the COINPAY obligations center. One queue across
 * every chain + address of the wallet listing each pending
 * native-coin payment a matched order is waiting on: payee, amount,
 * live countdown, and a one-tap "Pay now" into CoinpayForm prefilled.
 *
 * State model per row (obligationStatus.js):
 *   - open / at-risk: payable; at-risk (<30min) is flagged act-now.
 *   - expired: the wall-clock deadline passed but the row is still
 *     `pending_coinpay` (expiry only *settles* at the next block past
 *     the deadline). Paying in that gap risks confirming after
 *     expiry, which burns the coin with no token settlement, so
 *     expired rows lose "Pay now" and say what happens instead.
 *
 * This surface is PC-16 auto-pay's visibility/fallback layer: it
 * never signs anything itself; every payment goes through
 * CoinpayForm's existing review + sign flow.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]  scope the address union to this account
 * @param {(ref: { chainId: string, address: string, orderMatchActionIndex: string }) => void} props.onPay
 * @param {() => void} props.onBack
 */
export function ObligationsView({ walletId, activeAccountId, onPay, onBack }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    // Faster poll than the app-level badge: this screen is the user
    // actively watching deadlines.
    const { obligations, scanning, refresh } = useCoinpayObligations(
        walletId,
        activeAccountId,
        { pollMs: 30_000 },
    );

    // 1s tick drives the countdowns. One interval for the whole list.
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(t);
    }, []);

    const classified = obligations.map((o) => ({
        ...o,
        ...classifyObligation(o.expiration, nowSec),
    }));
    const payable = classified.filter((o) => o.state !== 'expired');
    const expired = classified.filter((o) => o.state === 'expired');

    const header = (
        <PageHeader
            onBack={onBack}
            title="Payments due"
            trailing={(
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={refresh}
                    disabled={scanning}
                    icon={<Icon.RefreshIcon />}
                    aria-label="Refresh payments"
                >
                    Refresh
                </Button>
            )}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.wrapFull : styles.wrapPopup}>
                {scanning && obligations.length === 0 ? (
                    <p className={styles.hint}>Scanning for payments due…</p>
                ) : null}

                {!scanning && classified.length === 0 ? (
                    <div className={styles.empty}>
                        <p className={styles.emptyTitle}>No payments due</p>
                        <p className={styles.hint}>
                            When one of your DEX orders matches against native
                            coin (BTC, LTC, or DOGE), the coin payment that
                            completes the trade appears here with its deadline.
                            Unpaid matches expire and the escrowed tokens
                            return to the seller.
                        </p>
                    </div>
                ) : null}

                {payable.length > 0 ? (
                    <ul className={styles.list} role="list" aria-label="Pending payments">
                        {payable.map((o) => (
                            <ObligationRow key={rowKey(o)} row={o} onPay={onPay} />
                        ))}
                    </ul>
                ) : null}

                {expired.length > 0 ? (
                    <>
                        <p className={styles.sectionLabel}>Expired, awaiting settlement</p>
                        <p className={styles.hint}>
                            These payment windows have closed. Do not pay them:
                            a payment confirming after the deadline sends your
                            coin without receiving the tokens. The match
                            settles back to the seller at the next block.
                        </p>
                        <ul className={styles.list} role="list" aria-label="Expired payments">
                            {expired.map((o) => (
                                <ObligationRow key={rowKey(o)} row={o} onPay={onPay} />
                            ))}
                        </ul>
                    </>
                ) : null}
            </div>
        </Screen>
    );
}

function rowKey(o) {
    return `${o.chainId}-${o.orderMatchActionIndex}`;
}

function ObligationRow({ row, onPay }) {
    const descriptor = chainRegistry.get(row.chainId);
    const ticker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const coinText = baseUnitsToCoinText(row.coinAmount);
    const amountLabel = coinText != null
        ? `${coinText} ${ticker || 'coins'}`
        : `${String(row.coinAmount ?? '?')} base units`;
    const countdown = countdownText(row.secondsLeft);
    const absolute = coinpayExpiryText(row.expiration);

    const stateChip = row.state === 'expired'
        ? <span className={`${styles.chip} ${styles.chipExpired}`}>Expired</span>
        : row.state === 'at-risk'
            ? (
                <span className={`${styles.chip} ${styles.chipAtRisk}`}>
                    {countdown ? `${countdown} left` : 'Expiring'}
                </span>
            )
            : countdown
                ? <span className={`${styles.chip} ${styles.chipOpen}`}>{countdown} left</span>
                : <span className={`${styles.chip} ${styles.chipOpen}`}>No deadline reported</span>;

    return (
        <li className={styles.row}>
            <div className={styles.rowMain}>
                <div className={styles.rowHead}>
                    {descriptor
                        ? <ChainBadge descriptor={descriptor} size="sm" />
                        : <span>{row.chainId}</span>}
                    <span className={styles.rowTitle}>
                        Matched order #{row.orderMatchActionIndex}
                    </span>
                    {stateChip}
                </div>
                <div className={styles.rowDetail}>
                    Pay <strong>{amountLabel}</strong> to{' '}
                    <AddressText address={row.payeeAddress} />
                </div>
                <div className={styles.rowMeta}>
                    From <AddressText address={row.address} />
                    {absolute ? <> · deadline {absolute}</> : null}
                </div>
                {row.state === 'at-risk' ? (
                    <div className={styles.atRiskNote} role="status">
                        Act now: payments need time to confirm before the
                        deadline. A payment confirming late loses the coin.
                    </div>
                ) : null}
            </div>
            <div className={styles.rowActions}>
                {row.state !== 'expired' ? (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onPay({
                            chainId: row.chainId,
                            address: row.address,
                            orderMatchActionIndex: row.orderMatchActionIndex,
                        })}
                    >
                        Pay now
                    </Button>
                ) : null}
            </div>
        </li>
    );
}
