// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import {
    ChainBadge, EmptyState, ListPage, ListRow, PageHeader, Screen, Skeleton, StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { alertsAutopayCannotSign } from '../../i18n/locales/en/alerts.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useCoinpayObligations } from '../hooks/useCoinpayObligations.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import {
    classifyObligation,
    baseUnitsToCoinText,
    obligationBaseUnits,
} from '../../market/obligationStatus.js';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { FillRing } from '../components/FillRing.jsx';
import { PairIcons } from '../components/PairIcons.jsx';
import { formatDecimalAmount, trimAmountTail } from '../utils/amountFormat.js';
import styles from './ObligationsView.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// The default COINPAY window (order_match.js COINPAY_EXPIRATION), used for
// the ring's share only when the match time is not known.
const DEFAULT_WINDOW_SECONDS = 2 * 3600;

// Under this many seconds left the ring turns red.
const URGENT_SECONDS = 30 * 60;

/**
 * §41.4 / PC-15: Payments due, a quick glance at what is due right now
 * (operator 2026-11-13, a simplified wallet-payments-due layout 1). One list
 * card with one row per payment whose window is open: a ring showing how much
 * of the window is left with the time under it, what the payment buys
 * ("Buying 600 XCHAIN") and what it pays ("Pay 0.0024 BTC"). A tap opens the
 * payment's detail (CoinpayForm), where it is approved.
 *
 * Paid payments leave the scan (it keeps pending_coinpay rows only), and a
 * payment whose window closed drops off the list: paying it now risks a
 * confirmation after expiry, which sends the coin without the tokens.
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
export function ObligationsView(props) {
    const scope = `${props.walletId || ''}\u0000${props.activeAccountId || ''}`;
    return <ScopedObligationsView key={scope} {...props} />;
}

function ScopedObligationsView({ walletId, activeAccountId, onPay, onBack }) {
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
    // Offline the scan holds and the screen says so once; it runs again when
    // the connection returns.
    const { offline, recheck } = useNetworkOffline({ walletId });
    // The hook scans on mount, on every poll and when the window becomes
    // visible again, so the page has no manual refresh control.
    const {
        obligations, incomplete, scanning, error: scanError,
    } = useCoinpayObligations(
        walletId,
        activeAccountId,
        { pollMs: 30_000, offline },
    );
    const showOffline = offline && obligations.length === 0;

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

    // Only payments whose window is open are listed; an expired one falls off.
    const due = obligations
        .map((o) => ({ ...o, ...classifyObligation(o.expiration, nowSec) }))
        .filter((o) => o.state !== 'expired');

    const sides = useMatchSides(messaging, obligations);

    // Search matches what is bought or paid: the token, the amount, the coin.
    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();
    const visible = needle === '' ? due : due.filter((o) => rowSearchText(o, sides).includes(needle));

    const header = (
        <PageHeader
            onBack={onBack}
            title="Payments Due"
            trailing={showOffline ? null : (
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    searchPlaceholder="Search"
                    searchLabel="Search payments due"
                    label="Filter payments due"
                />
            )}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage
                notices={(
                    <>
                        {autopayArmed ? (
                            <p className={styles.hint}>
                                Auto pay is armed for {autopayStatus.armed} order{autopayStatus.armed === 1 ? '' : 's'}:
                                confirmed matches are paid automatically while the wallet stays unlocked.
                            </p>
                        ) : null}
                        {autopayDisarmed ? (
                            <StatusMessage variant="error" className={styles.hint}>
                                Auto pay is disarmed: this wallet has auto pay orders but cannot sign
                                right now. Unlock the wallet with your password to re-arm it, or pay
                                matches manually from this queue.
                            </StatusMessage>
                        ) : null}
                        {scanError && !offline ? (
                            <StatusMessage variant="error" className={styles.hint}>{scanError}</StatusMessage>
                        ) : null}
                        {incomplete && !offline ? (
                            <StatusMessage variant="error" className={styles.hint}>
                                Couldn't load every payment due. Older payments may be missing from this list.
                            </StatusMessage>
                        ) : null}
                    </>
                )}
            >
                {showOffline ? (
                    <OfflineEmptyState body="Payments due load when the connection returns." onRetry={recheck} />
                ) : null}

                {!showOffline && scanning && obligations.length === 0 ? (
                    <p className={styles.hint}>Scanning for payments due…</p>
                ) : null}

                {!showOffline && !scanError && !incomplete && due.length === 0 && !(scanning && obligations.length === 0) ? (
                    <EmptyState title="No payments due" body="Matched orders that need a coin payment appear here." />
                ) : null}

                {!showOffline && due.length > 0 && visible.length === 0 ? (
                    <EmptyState title="No matching payments" body="Matching payments appear here after you change the search." />
                ) : null}

                {visible.length > 0 ? (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={styles.list} role="list" aria-label="Payments due">
                        {visible.map((o) => (
                            <li key={rowKey(o)} className={styles.item}>
                                <DueRow row={o} side={sides.sideFor(o)} onPay={onPay} />
                            </li>
                        ))}
                    </ul>
                ) : null}
            </ListPage>
        </Screen>
    );
}

function rowKey(o) {
    return `${o.chainId}-${o.orderMatchActionIndex}`;
}

function amountLabelFor(row) {
    const descriptor = chainRegistry.get(row.chainId);
    const ticker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    // The explorer serves this as a decimal coin figure, never base units:
    // "0.5" is half a coin and "10" is ten coins (see obligationBaseUnits).
    const coinText = baseUnitsToCoinText(obligationBaseUnits(row.coinAmount));
    return coinText != null
        ? `${coinText} ${ticker || 'coins'}`
        : `${String(row.coinAmount ?? '?')} base units`;
}

function coinTickerFor(chainId) {
    const descriptor = chainRegistry.get(chainId);
    return descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] || '' : '';
}

function sideKey(chainId, orderMatchActionIndex) {
    return `${chainId}:${orderMatchActionIndex}`;
}

/**
 * What each payment buys, read once for the whole list.
 *
 * One messaging call answers every row (two explorer list reads per payer
 * address behind it, see coinpayMatchSides.js), and it runs again only when
 * the set of payments changes: the countdown re-renders every second and the
 * scan hands a new array every poll, so the read is keyed on the payments'
 * identities, not on the array.
 *
 * `sideFor(row)` answers the side, `null` when the read finished without one,
 * or `undefined` while it is still loading.
 */
function useMatchSides(messaging, obligations) {
    const requests = obligations.map((o) => ({
        chainId: o.chainId,
        address: o.address,
        orderMatchActionIndex: String(o.orderMatchActionIndex),
        coinAmount: o.coinAmount,
        coinTicker: coinTickerFor(o.chainId),
    }));
    const readKey = requests
        .map((r) => `${r.chainId}:${r.address}:${r.orderMatchActionIndex}:${String(r.coinAmount ?? '')}`)
        .sort()
        .join('|');
    const latest = useRef(requests);
    latest.current = requests;
    const [state, setState] = useState(
        /** @type {{ key: string, done: boolean, failed: boolean, sides: Record<string, any> }} */
        ({ key: '', done: false, failed: false, sides: {} }),
    );
    // A failed read is tried again on the scan's next poll (a new rows array),
    // not on every countdown tick.
    const [attempt, setAttempt] = useState(0);
    const failedNow = state.failed && state.key === readKey;
    useEffect(() => {
        if (failedNow) setAttempt((a) => a + 1);
        // Only a new scan result re-arms the read.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [obligations]);
    useEffect(() => {
        if (readKey === '') return undefined;
        if (typeof messaging?.getCoinpayMatchSides !== 'function') {
            setState((s) => ({ key: readKey, done: true, failed: false, sides: s.sides }));
            return undefined;
        }
        let cancelled = false;
        Promise.resolve()
            .then(() => messaging.getCoinpayMatchSides({ obligations: latest.current }))
            .then((answer) => {
                if (cancelled) return;
                const found = answer && typeof answer === 'object' ? answer : {};
                setState((s) => ({ key: readKey, done: true, failed: false, sides: { ...s.sides, ...found } }));
            }, () => {
                if (!cancelled) setState((s) => ({ key: readKey, done: true, failed: true, sides: s.sides }));
            });
        return () => { cancelled = true; };
    }, [readKey, messaging, attempt]);

    const settled = state.done && state.key === readKey;
    return {
        sideFor(row) {
            const side = state.sides[sideKey(row.chainId, row.orderMatchActionIndex)];
            if (side && typeof side === 'object') return side;
            return settled ? null : undefined;
        },
    };
}

function boughtText(side) {
    const amount = formatDecimalAmount(trimAmountTail(String(side.amount))) || String(side.amount);
    return `${amount} ${side.tick}`;
}

function rowSearchText(row, sides) {
    const side = sides.sideFor(row);
    return [
        side ? boughtText(side) : '',
        row.coinAmount,
        amountLabelFor(row),
    ].map((v) => String(v ?? '')).join(' ').toLowerCase();
}

/**
 * Short time left for the ring's caption: "1h 5m", "24m", "40s".
 *
 * @param {number | null} secondsLeft
 * @returns {string | null}
 */
export function shortTimeLeft(secondsLeft) {
    if (typeof secondsLeft !== 'number' || !Number.isFinite(secondsLeft) || secondsLeft <= 0) return null;
    const s = Math.floor(secondsLeft);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
}

/** The share of the payment window still left, 0 to 100, or null with no deadline. */
function windowLeftPercent(row, side) {
    if (typeof row.secondsLeft !== 'number') return null;
    const expiration = Number(row.expiration);
    const matchedAt = side && typeof side.matchedAt === 'number' ? side.matchedAt : null;
    const total = matchedAt !== null && expiration > matchedAt ? expiration - matchedAt : DEFAULT_WINDOW_SECONDS;
    return Math.min(100, Math.max(0, (row.secondsLeft / total) * 100));
}

function DueRing({ row, side }) {
    const time = shortTimeLeft(row.secondsLeft);
    // Green while there is plenty of time, red under 30 minutes (operator 2026-11-14).
    const urgent = typeof row.secondsLeft === 'number' && row.secondsLeft < URGENT_SECONDS;
    return (
        <FillRing
            percent={windowLeftPercent(row, side)}
            tone={urgent ? 'danger' : 'success'}
            mark="clock"
            status={urgent ? 'at-risk' : 'open'}
            caption={time}
            label={time ? `${time} left to pay` : 'No deadline reported'}
        />
    );
}

function DueRow({ row, side, onPay }) {
    const descriptor = chainRegistry.get(row.chainId);
    const coinTick = coinTickerFor(row.chainId);
    const pay = `Pay ${amountLabelFor(row)}`;
    const time = shortTimeLeft(row.secondsLeft);
    let title;
    if (side) {
        title = `Buying ${boughtText(side)}`;
    } else if (side === null) {
        title = 'Buying tokens';
    } else {
        // Still reading what this payment buys: say so, never a guess.
        title = (
            <span className={styles.titleLoading} data-loading="bought-side">
                Buying
                <Skeleton shape="text" width="5em" className={styles.titleSkeleton} />
            </span>
        );
    }
    let leading = null;
    if (side) leading = <PairIcons chainId={row.chainId} first={side.tick} second={coinTick} />;
    else if (descriptor) leading = <ChainBadge descriptor={descriptor} size="sm" showName={false} />;
    const cannotSign = row.attention === 'autopay-cannot-sign';
    const attentionCopy = cannotSign ? alertsAutopayCannotSign : null;
    const named = [typeof title === 'string' ? title : 'Buying', pay, attentionCopy, time ? `${time} left` : null]
        .filter(Boolean).join(', ');
    return (
        <ListRow
            type="button"
            onClick={() => onPay({
                chainId: row.chainId,
                address: row.address,
                orderMatchActionIndex: row.orderMatchActionIndex,
            })}
            aria-label={named}
            chevron
            className={cannotSign ? styles.attentionRow : undefined}
            data-autopay-cannot-sign={cannotSign ? '' : undefined}
            leading={leading}
            title={title}
            subtitle={(
                <span className={styles.rowDetail}>
                    <span>{pay}</span>
                    {attentionCopy ? <span className={styles.attentionCopy}>{attentionCopy}</span> : null}
                </span>
            )}
            trailing={<DueRing row={row} side={side} />}
            trailingClassName={styles.ringSlot}
        />
    );
}
