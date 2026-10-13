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
    AddressText, Button, ChainBadge, EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader, StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useCoinpayObligations } from '../hooks/useCoinpayObligations.js';
import {
    classifyObligation,
    countdownText,
    baseUnitsToCoinText,
    obligationBaseUnits,
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
    const { shell, messaging } = useMessaging();
    const variant = screenVariantFor(shell);

    // PC-16: auto-pay armed/disarmed summary. "Disarmed" = consented
    // orders exist but no pre-unlocked signer can pay them (locked
    // session, HW/watch-only wallet, or a desktop session opened by the
    // OS keychain alone - wallet seeds carry their own KDF, so arming
    // needs one password unlock). The startup re-arm prompt of the spec
    // is this banner plus the matching engine notification.
    const [autopayStatus, setAutopayStatus] = useState(
        /** @type {{ armed: number, unsignableWalletIds: string[] } | null} */ (null),
    );
    useEffect(() => {
        if (typeof messaging?.getAutopayStatus !== 'function') return;
        let cancelled = false;
        messaging.getAutopayStatus({ walletId })
            .then((s) => { if (!cancelled) setAutopayStatus(s || null); })
            .catch(() => { if (!cancelled) setAutopayStatus(null); });
        return () => { cancelled = true; };
    }, [messaging, walletId]);
    const autopayDisarmed = Boolean(autopayStatus && autopayStatus.armed > 0 &&
        autopayStatus.unsignableWalletIds?.includes?.(walletId));
    const autopayArmed = Boolean(autopayStatus && autopayStatus.armed > 0 && !autopayDisarmed);

    // Faster poll than the app-level badge: this screen is the user
    // actively watching deadlines.
    const { obligations, scanning, error: scanError, refresh } = useCoinpayObligations(
        walletId,
        activeAccountId,
        { pollMs: 30_000 },
    );

    // One interval drives every live countdown and clears at the final deadline.
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const current = Math.floor(Date.now() / 1000);
        setNowSec(current);
        const hasLiveDeadline = () => obligations.some((o) => {
            const expiration = Number(o.expiration);
            return Number.isFinite(expiration) && expiration > 0
                && expiration <= 1e13 && expiration > Math.floor(Date.now() / 1000);
        });
        if (!hasLiveDeadline()) return undefined;
        const t = setInterval(() => setNowSec(() => {
            const next = Math.floor(Date.now() / 1000);
            if (!hasLiveDeadline()) clearInterval(t);
            return next;
        }), 1000);
        return () => clearInterval(t);
    }, [obligations]);

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
            // Icon only: the header's trailing slot draws every button as a
            // 38px circle, and the word "Refresh" ran off the screen edge.
            trailing={(
                <button
                    type="button"
                    onClick={refresh}
                    disabled={scanning}
                    aria-label="Refresh payments"
                    title="Refresh payments"
                >
                    <Icon.RefreshIcon />
                </button>
            )}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {autopayArmed ? (
                    <p className={styles.hint}>
                        CoinPay auto-pay is armed for {autopayStatus.armed} order{autopayStatus.armed === 1 ? '' : 's'}:
                        confirmed matches are paid automatically while the wallet stays unlocked.
                    </p>
                ) : null}
                {autopayDisarmed ? (
                    <StatusMessage variant="error" className={styles.hint}>
                        Auto-pay is disarmed: this wallet has auto-pay orders but cannot sign
                        right now. Unlock the wallet with your password to re-arm it, or pay
                        matches manually from this queue.
                    </StatusMessage>
                ) : null}
                {scanning && obligations.length === 0 ? (
                    <p className={styles.hint}>Scanning for payments due…</p>
                ) : null}

                {scanError ? (
                    <StatusMessage variant="error" className={styles.hint}>{scanError}</StatusMessage>
                ) : null}

                {!scanning && !scanError && classified.length === 0 ? (
                    <EmptyState
                        icon={<Icon.ClockIcon />}
                        title="No payments due"
                        body="When a DEX order matches against BTC, LTC or DOGE, the coin payment that completes it appears here with its deadline."
                    />
                ) : null}

                {payable.length > 0 ? (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={styles.list} role="list" aria-label="Pending payments">
                        {payable.map((o) => (
                            <ObligationRow key={rowKey(o)} row={o} onPay={onPay} />
                        ))}
                    </ul>
                ) : null}

                {expired.length > 0 ? (
                    <>
                        <SectionHeader
                            title="Expired, awaiting settlement"
                            description={(
                                <>
                                    These payment windows have closed. Do not pay them:
                                    a payment confirming after the deadline sends your
                                    coin without receiving the tokens. The match
                                    settles back to the seller at the next block.
                                </>
                            )}
                        />
                        {/* Safari needs an explicit list role because this class removes list styling. */}
                        <ul className={styles.list} role="list" aria-label="Expired payments">
                            {expired.map((o) => (
                                <ObligationRow key={rowKey(o)} row={o} onPay={onPay} />
                            ))}
                        </ul>
                    </>
                ) : null}
            </ListPage>
        </Screen>
    );
}

function rowKey(o) {
    return `${o.chainId}-${o.orderMatchActionIndex}`;
}

function ObligationRow({ row, onPay }) {
    const descriptor = chainRegistry.get(row.chainId);
    const ticker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    // The explorer serves this as a decimal coin figure, never base units:
    // "0.5" is half a coin and "10" is ten coins (see obligationBaseUnits).
    const coinText = baseUnitsToCoinText(obligationBaseUnits(row.coinAmount));
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
