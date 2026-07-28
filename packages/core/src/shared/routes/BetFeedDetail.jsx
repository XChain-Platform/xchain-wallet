// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Screen, PageHeader, Button, Input } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { nativeFeeErrorMessage } from '../../sdk/nativeFeePreflight.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { trimAmountTail, sumDecimalStrings } from '../utils/amountFormat.js';
import { outcomeLabelsOf } from '../utils/betOutcomeLabels.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

function unwrap(resp) {
    if (!resp) return null;
    if (Array.isArray(resp)) return resp[0] || null;
    if (Array.isArray(resp.data)) return resp.data[0] || null;
    if (resp.data && typeof resp.data === 'object') return resp.data;
    return resp;
}

/** Is this market still live, i.e. can its pools still change? */
export function isLiveFeedStatus(status) {
    return status === 'open' || status === 'closed' || !status;
}

// Rebuild the per-outcome split from the bets themselves, in the shape the
// explorer's `pools` rows use, so the renderer needs no second code path.
export function splitFromBets(rows) {
    const byOutcome = new Map();
    for (const b of Array.isArray(rows) ? rows : []) {
        // `Number(null)` is 0, so a row with no outcome would otherwise be
        // silently counted as a bet on outcome 0 - a wrong pool, not a
        // missing one.
        if (b?.outcome === null || b?.outcome === undefined || b?.outcome === '') continue;
        const outcome = Number(b.outcome);
        if (!Number.isFinite(outcome)) continue;
        const cur = byOutcome.get(outcome) || { outcome, amounts: [], bet_count: 0 };
        cur.amounts.push(b?.amount);
        cur.bet_count += 1;
        byOutcome.set(outcome, cur);
    }
    return [...byOutcome.values()].map(({ outcome, amounts, bet_count }) => ({
        outcome, bet_count, pool: sumDecimalStrings(amounts),
    }));
}

function statusLabel(status) {
    if (status === 'open') return 'Taking bets';
    if (status === 'closed') return 'Betting closed, waiting on the result';
    if (status === 'resolved') return 'Settled';
    if (status === 'resolved_void') return 'Void, everyone refunded';
    if (status === 'cancelled') return 'Cancelled, everyone refunded';
    if (status === 'expired') return 'Expired unresolved, everyone refunded';
    return status ? String(status) : 'Unknown';
}

// The SDK carries implied odds at 8 decimals because it is a ratio rather than
// an amount. "1.386x your stake" reads; "1.38600000x your stake" does not.
function trimZeros(v) {
    const s = String(v === null || v === undefined ? '' : v);
    if (!s.includes('.')) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}

function fmtTime(unix) {
    if (unix === null || unix === undefined) return 'n/a';
    const n = Number(unix);
    if (!Number.isFinite(n)) return 'n/a';
    return new Date(n * 1000).toLocaleString();
}

/**
 * One betting market: its terms, the current pool split, and its status history.
 *
 * The pool figures come from the explorer's open-bets-only sum, which is the same
 * predicate settlement uses, so the split shown here is the split the payout math
 * will actually work from. It is still NOT a locked-in price: this is a
 * parimutuel market, so every later bet moves everyone's share.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string | number} props.feedIndex
 * @param {(chainId: string, address: string) => void} [props.onOpenOracle]
 * @param {() => void} props.onBack
 */
export function BetFeedDetail({ walletId, chainId, feedIndex, onOpenOracle, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const signerReady = useSignerReady(walletId);
    const { isWatcherMode } = useWalletMode();

    const [feed, setFeed] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [outcome, setOutcome] = useState(/** @type {number | null} */ (null));
    const [amount, setAmount] = useState('');
    const [password, setPassword] = useState('');
    const [projected, setProjected] = useState(/** @type {any} */ (null));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any} */ (null));
    const [settledSplit, setSettledSplit] = useState(/** @type {any[] | null} */ (null));

    const reload = useCallback(() => {
        setFeed(null);
        setError(null);
        messaging.betFeed({ chainId, feedIndex })
            .then((resp) => setFeed(unwrap(resp)))
            .catch((err) => setError(err?.message || 'Failed to load the market.'));
    }, [chainId, feedIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        setFeed(null);
        setError(null);
        messaging.betFeed({ chainId, feedIndex })
            .then((resp) => { if (!cancelled) setFeed(unwrap(resp)); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load the market.'); });
        return () => { cancelled = true; };
    }, [chainId, feedIndex, messaging]);

    // A settled market's split has to be rebuilt from its bets, because the
    // explorer sums `pools` over OPEN bets only. That predicate is right for
    // payout math and wrong as a record: the moment a market resolves,
    // cancels or expires, every bet leaves `open` and the market renders with
    // an empty pool list - so a market that took real money and paid it out
    // reported "no bets yet" on the very screen a bettor opens to check what
    // happened, directly above a history saying it settled.
    //
    // Only for terminal markets: while a market is live the explorer's own
    // aggregate is the authority (it is what settlement will use), and asking
    // for every bet row on a busy market would be a worse read of the same
    // number.
    useEffect(() => {
        let cancelled = false;
        setSettledSplit(null);
        if (!feed || isLiveFeedStatus(feed.feed_status)) return undefined;
        if (typeof messaging.bets !== 'function') return undefined;
        messaging.bets({ chainId, query: String(feedIndex), type: 'feed', opts: { limit: 500 } })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp : (resp?.data || []);
                setSettledSplit(splitFromBets(rows));
            })
            // Falling back to the live-pool rows keeps the screen readable; it
            // shows zeros rather than a wrong total.
            .catch(() => { if (!cancelled) setSettledSplit(null); });
        return () => { cancelled = true; };
    }, [feed, chainId, feedIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function' ? messaging.getActiveAddresses(walletId) : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                setFromAddressId(preferredSourceId(byChain?.[chainId] || [], active?.[chainId]));
            })
            .catch(() => { /* best-effort; betting requires it and is guarded at submit */ });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);
    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // : placing a bet is fee-bearing (BET v2 pre-funds one payout credit),
    // so it carries the same fee lane as every other fee-bearing action. On
    // LTC/DOGE the hook forces it on: there is no XCHAIN fee lane on those
    // chains, so a bet placed without the native output is broadcast, costs a
    // miner fee, and never joins the pool.
    const coinTicker = protocolCoinTickerFor(chainId);
    const nativeFee = useNativeFee(chainId);

    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // A real ref, not `{ current: password }`: Approve runs from the closure
    // captured when the confirm page OPENED, which is before the password on that
    // page has been typed. A fresh object per render leaves that closure holding
    // the empty string, so the bet fails as a wrong password.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'placeBetAction',
        hardware: 'placeBetActionHw',
    });

    // Wire order of the market's outcomes. Derived up here rather than at render
    // because the projection needs the COUNT: the explorer's pools only carry
    // outcomes that already have a bet, so the count is the only thing that tells
    // the payout math an unbacked outcome exists at all.
    const outcomeLabels = useMemo(() => outcomeLabelsOf(feed), [feed]);

    // Projected payout comes from the SDK's own settlement-order math over the
    // host, never a local approximation: a projection that disagrees with the
    // settled amount in the last decimal place reads to a user as a bug.
    //
    // Failures stay silent on purpose: a stake half-typed ("0.", "") is not an
    // error the user needs told about, it just has no projection yet.
    useEffect(() => {
        let cancelled = false;
        setProjected(null);
        if (!feed || outcome === null || !amount) return undefined;
        if (typeof messaging.betProjectPayout !== 'function') return undefined;
        messaging.betProjectPayout({
            chainId,
            pools: feed.pools || [],
            outcomeCount: outcomeLabels.length,
            outcome,
            stake: amount,
            feePct: feed.fee || 0,
        })
            .then((v) => { if (!cancelled) setProjected(v && typeof v === 'object' ? v : null); })
            .catch(() => { if (!cancelled) setProjected(null); });
        return () => { cancelled = true; };
    }, [feed, outcome, amount, chainId, messaging, outcomeLabels]);

    // The UI-level params, derived in ONE place so the object handed to compose is
    // byte-for-byte the object handed to submit. Two derivations could diverge and
    // the divergence would be signed rather than caught.
    function betParams() {
        return { feedActionIndex: feedIndex, outcome, amount: String(amount).trim() };
    }

    function sourceDescriptor() {
        return {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
    }

    // Compose through the SDK's own placeBetParams builder, host-side. A
    // client-side wire mirror would be SIGNED rather than caught, and for BET the
    // stakes are literal: a place-bet and a resolve differ on the wire only by
    // AMOUNT ('s rule, sharper here).
    async function placeBet() {
        if (!fromAddress) { setFormError('No address on this chain to bet from.'); return; }
        setFormError(null);
        const from = sourceDescriptor();
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                compose: () => messaging.composeBetForConfirm({
                    walletId, chainId, from, builder: 'placeBetParams', params: betParams(),
                    // The fee mode must reach COMPOSE, not just submit: the
                    // FEE_DESTINATION output has to be inside the PSBT the user
                    // approves and the tamper check verifies.
                    payFeeInNativeCoin: nativeFee.flag,
                }),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId, chainId, from, params: betParams(), prebuiltPsbt,
                    payFeeInNativeCoin: nativeFee.flag,
                }),
            });
            setResult(res);
            setPassword('');
            setAmount('');
            setOutcome(null);
            // Re-read so the pool split reflects the bet that was just placed.
            reload();
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.name === 'NativeFeeForfeitError'
                ? nativeFeeErrorMessage(err, { coinTicker, mandatory: nativeFee.mandatory })
                : err?.message || 'Bet failed.');
        }
    }

    const header = <PageHeader onBack={onBack} title="Market" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    // The confirm page, rendered in place of the market while the single-encode
    // pipeline is live. Without this branch `actionConfirm.run` opens a confirm
    // phase nothing draws, so the bet never reaches Approve AND the confirm
    // singleton stays held, which makes every other form's confirm reject as
    // busy until this screen unmounts.
    //
    // The intent is decoded from the params the HOST composed, never from the
    // form state: a place-bet and a resolve differ on the wire only by AMOUNT.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={chainRegistry.get(chainId)?.displayName || chainId}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                // (c): the composed bytes carry the outcome as an INDEX,
                // so the host's decode can only say "outcome 0". These labels
                // are the market's own, and they annotate that index without
                // replacing it, so the screen that verifies intent names the
                // side being backed.
                outcomeLabels={outcomeLabels}
            />
        );
    }

    if (error) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{error}</div>
            </>,
        );
    }
    if (!feed) return wrap(<p>Loading market…</p>);

    const outcomes = outcomeLabels;
    const live = isLiveFeedStatus(feed.feed_status);
    const livePools = Array.isArray(feed.pools) ? feed.pools : [];
    // On a settled market the rebuilt split is the one that describes what
    // happened; the live rows are empty there by construction.
    const pools = live ? livePools : (settledSplit || livePools);
    const byOutcome = {};
    for (const p of pools) byOutcome[Number(p.outcome)] = p;
    const total = pools.reduce((a, p) => a + Number(p.pool || 0), 0);
    const timeline = Array.isArray(feed.timeline) ? feed.timeline : [];

    return wrap(
        <>
            <h3 style={{ marginBottom: '0.25rem' }}>{feed.label || '(untitled market)'}</h3>
            <p className={styles.hint}>
                #{String(feed.action_index)} · {feed.tick || 'n/a'} · {statusLabel(feed.feed_status)}
            </p>

            <div className={styles.card}>
                <div><strong>Betting closes</strong>: {fmtTime(feed.deadline)}</div>
                <div><strong>Refunds if unresolved by</strong>: {fmtTime(feed.expire_at)}</div>
                <div><strong>Oracle fee</strong>: {feed.fee ?? '0'}% of the pot</div>
                {feed.min_amount ? <div><strong>Minimum bet</strong>: {String(feed.min_amount)}</div> : null}
                {feed.source ? (
                    <div>
                        <strong>Run by</strong>:{' '}
                        {onOpenOracle
                            ? <a href="#" onClick={(e) => { e.preventDefault(); onOpenOracle(chainId, feed.source); }}>{feed.source}</a>
                            : feed.source}
                    </div>
                ) : null}
                {(feed.allow_list || feed.block_list) ? (
                    <div className={styles.hint}>
                        This market is restricted to a list of addresses. If you are blocked, your bet is
                        rejected and nothing is taken from your balance.
                    </div>
                ) : null}
            </div>

            <h4>{live ? 'Current split' : 'Final split'}</h4>
            {outcomes.length === 0 ? <p className={styles.hint}>No outcomes recorded.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {outcomes.map((label, i) => {
                        const p = byOutcome[i] || { pool: 0, bet_count: 0 };
                        // "no bets yet" only reads as true while betting can
                        // still happen; on a market that is over it asserts
                        // that nobody ever bet, which may be false and is
                        // never something this screen can promise.
                        const share = total > 0
                            ? ((Number(p.pool || 0) / total) * 100).toFixed(1) + '%'
                            : (live ? 'no bets yet' : 'no bets');
                        // (a): the pool is a DECIMAL(65,18) SUM, so it
                        // arrives with an 18-place tail whatever the token's
                        // own decimals are. A market denominated in a
                        // 0-decimal token read "300.000000000000000000".
                        const pool = trimAmountTail(p.pool ?? 0) || '0';
                        const bets = Number(p.bet_count || 0);
                        return (
                            <div key={i} className={styles.card} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                                <span>{i}: {label}</span>
                                <span>{pool} ({share}, {bets} bet{bets === 1 ? '' : 's'})</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* The three things that actually surprise people, stated plainly.
                Past tense once the market is over: "every later bet changes it"
                is advice for a decision nobody can still make, on a split that
                can no longer move. */}
            <p className={styles.hint}>
                {live ? (
                    <>
                        This is a parimutuel market: everyone backing the winning outcome shares the whole
                        pot, so the split above is only how things stand right now and every later bet
                        changes it. Bets are final once placed, and payouts round down, so a very small
                        stake can win and still pay nothing.
                    </>
                ) : (
                    <>
                        This was a parimutuel market: everyone backing the winning outcome shared the whole
                        pot. The split above is final, and payouts rounded down, so a very small stake could
                        win and still pay nothing.
                    </>
                )}
            </p>

            {/* Place-bet flow. Hidden outright when it could only produce a rejected
                transaction: a closed market takes no bets, and the feed's own source
                may not bet on its own market (§6 format 2). Showing a doomed form and
                letting the chain refuse it would cost the user a fee for nothing. */}
            {feed.feed_status === 'open' && !isWatcherMode ? (
                fromAddress && feed.source === fromAddress.address ? (
                    <p className={styles.hint}>
                        You run this market, so you cannot bet on it. That rule exists because an oracle
                        who could bet on its own result would decide the result.
                    </p>
                ) : (
                    <>
                        <h4>Place a bet</h4>
                        <div className={styles.card}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
                                {outcomes.map((label, i) => (
                                    <Button
                                        key={i}
                                        variant={outcome === i ? 'primary' : 'ghost'}
                                        onClick={() => setOutcome(i)}
                                    >
                                        {label}
                                    </Button>
                                ))}
                            </div>
                            <Input
                                label={`Stake${feed.tick ? ` (${feed.tick})` : ''}`}
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                inputMode="decimal"
                                placeholder={feed.min_amount ? `min ${feed.min_amount}` : '0.0'}
                            />
                            {/* The one number the decision turns on. A parimutuel stake has no
                                price the user can reason about on their own: it buys a share of a
                                pot that every later bet re-divides, so the pool split above is not
                                an answer to "what would I win". Payout, profit and odds all come
                                back from the same SDK call that settlement's arithmetic follows.
                                Zero is called out in words because it is the case the abstract
                                rounding warning below is really about . */}
                            {projected ? (
                                <div className={styles.hint} data-testid="bet-projection">
                                    {Number(projected.payout) > 0 ? (
                                        <p>
                                            If <strong>{outcomes[outcome] ?? `outcome ${outcome}`}</strong> wins, this
                                            stake pays about{' '}
                                            <strong>{projected.payout}{feed.tick ? ` ${feed.tick}` : ''}</strong>
                                            {projected.profit !== undefined ? (
                                                Number(projected.profit) < 0
                                                    ? <>, which is {trimZeros(projected.profit).replace('-', '')} less than you staked</>
                                                    : <>, a profit of {trimZeros(projected.profit)}</>
                                            ) : null}
                                            {projected.impliedOdds !== undefined
                                                ? <> ({trimZeros(projected.impliedOdds)}x your stake)</>
                                                : null}.
                                        </p>
                                    ) : (
                                        <p>
                                            At the current split this stake would win and still pay{' '}
                                            <strong>nothing</strong>, because payouts round down. Stake more, or
                                            wait for the pot to move.
                                        </p>
                                    )}
                                    <p>
                                        That is the split as it stands right now, not a locked-in price: every
                                        later bet moves it, in either direction.
                                    </p>
                                </div>
                            ) : null}
                            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />
                            {!isHwSource && !signerReady ? (
                                <Input
                                    label="Password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            ) : null}
                            {formError ? <div role="alert" className={styles.error}>{formError}</div> : null}
                            {result ? <p className={styles.hint}>Bet placed.</p> : null}
                            <div className={styles.actions}>
                                <Button
                                    variant="primary"
                                    disabled={outcome === null || !amount}
                                    onClick={placeBet}
                                >
                                    Review bet
                                </Button>
                            </div>
                            <p className={styles.hint}>
                                Once confirmed, a bet cannot be cancelled or moved to another outcome.
                            </p>
                        </div>
                    </>
                )
            ) : null}

            <h4>History</h4>
            {timeline.length === 0 ? <p className={styles.hint}>No history yet.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {timeline.map((t, i) => (
                        <div key={i} className={styles.hint}>
                            {statusLabel(t.status)} · block {String(t.block_index ?? 'n/a')}
                            {/* The close is recorded by the chain rather than caused by anyone's
                                transaction, so it is labelled instead of shown as an action. */}
                            {t.synthetic ? ' (automatic, when the deadline passed)' : ''}
                        </div>
                    ))}
                </div>
            )}

        </>,
    );
}
