// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AddressField, Button, EmptyState, FormPage, Icon, InfoTip, Input, ListPage, PageHeader, Screen, SectionHeader, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { FeesCard } from '../components/FeesCard.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { humanizeError } from '../utils/humanizeError.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { preferredSourceId } from '../addressSelection.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import {
    compareDecimalStrings,
    divideDecimalStrings,
    formatWithThousands,
    multiplyDecimalStrings,
    roundDecimalString,
    trimAmountTail,
    sumDecimalStrings,
} from '../utils/amountFormat.js';
import { outcomeLabelsOf, outcomePhrase, safeOutcomeLabel } from '../utils/betOutcomeLabels.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import styles from './IssueTokenForm.module.css';
import local from './BetFeedDetail.module.css';
// The blue market card (Home's card layout) and the icon tab labels.
import { BetMarketHero, OUTCOME_COLORS } from './BetMarketHero.jsx';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

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

/**
 * Did the chain accept this bet at all?
 *
 * A rejected BET still has a row - it was a real transaction that paid real
 * fees - but it staked nothing, joined no pool and settles to nobody. Counting
 * one produced a market reading "Void, everyone refunded" directly above
 * "0: Yes 100 (100.0%, 1 bet)", which is a contradiction rather than a rounding
 * quibble: the split is where a bettor reads what the market actually did.
 *
 * Written so a row with no status at all still counts. An older explorer that
 * omits the field must not silently empty every split.
 */
function isAcceptedBet(b) {
    if (b?.bet_status === 'invalid') return false;
    if (typeof b?.status === 'string' && /^invalid/i.test(b.status)) return false;
    return true;
}

// Rebuild the per-outcome split from the bets themselves, in the shape the
// explorer's `pools` rows use, so the renderer needs no second code path.
export function splitFromBets(rows, outcomeCount) {
    const byOutcome = new Map();
    const declared = Number(outcomeCount);
    const limit = Number.isInteger(declared) && declared > 0 && declared <= 16 ? declared : 16;
    for (const b of (Array.isArray(rows) ? rows : []).filter(isAcceptedBet)) {
        // `Number(null)` is 0, so a row with no outcome would otherwise be
        // silently counted as a bet on outcome 0 - a wrong pool, not a
        // missing one.
        if (b?.outcome === null || b?.outcome === undefined || b?.outcome === '') continue;
        const outcome = Number(b.outcome);
        if (!Number.isInteger(outcome) || outcome < 0 || outcome >= limit) continue;
        const amount = String(b?.amount ?? '').trim();
        if (!/^\d{1,47}(\.\d{1,18})?$/.test(amount) || compareDecimalStrings(amount, '0') !== 1) continue;
        const cur = byOutcome.get(outcome) || { outcome, amounts: [], bet_count: 0 };
        cur.amounts.push(amount);
        cur.bet_count += 1;
        byOutcome.set(outcome, cur);
    }
    return [...byOutcome.values()].map(({ outcome, amounts, bet_count }) => ({
        outcome, bet_count, pool: sumDecimalStrings(amounts),
    }));
}

/** Keep only pool aggregates that can belong to the displayed market. */
export function poolRowsForOutcomes(rows, outcomeCount) {
    const count = Number(outcomeCount);
    if (!Number.isInteger(count) || count < 1 || count > 16) return [];
    const seen = new Set();
    const valid = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const outcome = Number(row?.outcome);
        const pool = String(row?.pool ?? '').trim();
        if (!Number.isInteger(outcome) || outcome < 0 || outcome >= count || seen.has(outcome)) continue;
        if (!/^\d{1,47}(\.\d{1,18})?$/.test(pool)) continue;
        const betCount = Number(row?.bet_count);
        seen.add(outcome);
        valid.push({
            ...row,
            outcome,
            pool,
            bet_count: Number.isInteger(betCount) && betCount >= 0 ? betCount : 0,
        });
    }
    return valid;
}

// The compatibility reconstruction is bounded, and the screen says so out
// loud when an empty terminal aggregate requires more rows than this read.
const SETTLED_BET_LIMIT = 500;

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

function betAmountError(value, minimum) {
    const stake = String(value ?? '').trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(stake);
    if (!match) {
        return 'Enter a positive bet amount using digits and an optional decimal point.';
    }
    if ((match[2] || '').length > 18) return 'A bet amount can have at most 18 decimal places.';
    const wholeDigits = match[1].replace(/^0+/, '').length || 1;
    if (wholeDigits > 47) return 'This bet amount is too large.';
    if (!/[1-9]/.test(`${match[1]}${match[2] || ''}`)) {
        return 'Enter a positive bet amount using digits and an optional decimal point.';
    }
    const min = String(minimum ?? '').trim();
    if (min) {
        const minimumMatch = /^(\d+)(?:\.(\d+))?$/.exec(min);
        const minimumWholeDigits = minimumMatch
            ? (minimumMatch[1].replace(/^0+/, '').length || 1)
            : 0;
        if (!minimumMatch || (minimumMatch[2] || '').length > 18 || minimumWholeDigits > 47
            || !/[1-9]/.test(`${minimumMatch[1]}${minimumMatch[2] || ''}`)) {
            return 'This market reports an invalid minimum bet amount.';
        }
    }
    if (min && compareDecimalStrings(stake, min) === -1) {
        return `This market requires a minimum bet of ${min}.`;
    }
    return null;
}

function fmtTime(unix) {
    return formatLocalDateTime(unix) || 'n/a';
}

// Why not err.message on the two market loads below: betFeed forwards the SDK
// explorer's own wording, which is written for a log and names the HTTP status
// and the request URL ("Explorer returned HTTP 502 for /RBTC/api/..."), and
// that string went straight into the error banner. humanizeError routes an
// explorer failure through explorerReadFailure, which is the READ voice: it
// says which service is not answering and whether waiting helps, and it leaves
// out the "nothing was signed or sent" line that belongs to a submit the user
// never started.
const loadFailed = (err) => humanizeError(err, 'load this market').message;

/**
 * One betting market: its terms, the current pool split, and its status history.
 *
 * The pool figures come from the explorer's accepted-bet sum. While the market is
 * open, the split is not a locked-in price: this is a parimutuel market, so every
 * later bet moves everyone's share.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string | number} props.feedIndex
 * @param {(chainId: string, address: string) => void} [props.onOpenOracle]
 * @param {() => void} [props.onSettleMarket]
 * @param {() => void} props.onBack
 */
export function BetFeedDetail({ walletId, chainId, feedIndex, onOpenOracle, onSettleMarket, onBack }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);
    const signerReady = useSignerReady(walletId);
    const { isWatcherMode } = useWalletMode();

    const [feed, setFeed] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [outcome, setOutcome] = useState(/** @type {number | null} */ (null));
    const [amount, setAmount] = useState('');
    const [amountPrecisionError, setAmountPrecisionError] = useState(/** @type {string | null} */ (null));
    const [stakeBalance, setStakeBalance] = useState(/** @type {string | null} */ (null));
    const [stakeBalanceDivisibility, setStakeBalanceDivisibility] = useState(/** @type {number | null} */ (null));
    const [password, setPassword] = useState('');
    const [projected, setProjected] = useState(/** @type {any} */ (null));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any} */ (null));
    const [submitting, setSubmitting] = useState(false);
    const submitLockRef = useRef(false);
    const [settledSplit, setSettledSplit] = useState(/** @type {any[] | null} */ (null));
    const [settledPartial, setSettledPartial] = useState(false);
    // The market's bet rows, read once for the card's chart, the
    // Activity and My Bets tabs and a terminal split rebuild.
    const [feedBets, setFeedBets] = useState(/** @type {any[] | null} */ (null));
    const [feedBetsFailed, setFeedBetsFailed] = useState(false);
    // Icon tabs under the card; Details opens first.
    const [tab, setTab] = useState('details');
    const tabsId = useId();

    const reload = useCallback(() => {
        setFeed(null);
        setError(null);
        messaging.betFeed({ chainId, feedIndex })
            .then((resp) => setFeed(unwrap(resp)))
            .catch((err) => setError(loadFailed(err)));
    }, [chainId, feedIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        setFeed(null);
        setError(null);
        messaging.betFeed({ chainId, feedIndex })
            .then((resp) => { if (!cancelled) setFeed(unwrap(resp)); })
            .catch((err) => { if (!cancelled) setError(loadFailed(err)); });
        return () => { cancelled = true; };
    }, [chainId, feedIndex, messaging]);

    // Current explorers preserve accepted-bet pools after settlement. An older
    // or incomplete explorer can return an empty terminal split, so rebuild that
    // one case from its bet rows. A non-empty aggregate stays authoritative and
    // avoids replacing a complete total with the bounded compatibility read.
    //
    // The same read serves every market, because the card's chart, Activity
    // and My Bets all draw from the market's bet rows.
    useEffect(() => {
        let cancelled = false;
        setSettledSplit(null);
        setSettledPartial(false);
        setFeedBets(null);
        setFeedBetsFailed(false);
        if (!feed) return undefined;
        const explorerPools = Array.isArray(feed.pools) ? feed.pools : [];
        const terminal = !isLiveFeedStatus(feed.feed_status);
        if (terminal && explorerPools.length > 0) setSettledSplit(explorerPools);
        const rebuildSplit = terminal && explorerPools.length === 0;
        if (typeof messaging.bets !== 'function') { setFeedBets([]); return undefined; }
        messaging.bets({ chainId, query: String(feedIndex), type: 'feed', opts: { limit: SETTLED_BET_LIMIT } })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp : (resp?.data || []);
                setFeedBets(rows);
                if (!rebuildSplit) return;
                // A page-sized answer means there may be more, and a total that
                // silently omits bets is worse than one that admits its bound:
                // this screen is where someone checks what a market did.
                setSettledPartial(rows.length >= SETTLED_BET_LIMIT);
                setSettledSplit(splitFromBets(rows, outcomeLabelsOf(feed).length));
            })
            // Falling back to the explorer rows keeps the screen readable; an
            // empty aggregate shows zeros rather than a guessed total.
            .catch(() => {
                if (cancelled) return;
                setFeedBets([]);
                setFeedBetsFailed(true);
                if (rebuildSplit) setSettledSplit(null);
            });
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
    const stakeTokenInfo = useTokenInfo({
        chainId,
        tick: feed?.tick,
        skip: !feed?.tick,
    });
    useEffect(() => {
        let cancelled = false;
        setStakeBalance(null);
        setStakeBalanceDivisibility(null);
        const tick = String(feed?.tick || '').trim().toUpperCase();
        if (!fromAddress?.address || !tick || typeof messaging.getAddressBalances !== 'function') {
            return undefined;
        }
        messaging.getAddressBalances(chainId, fromAddress.address)
            .then((sdkShape) => {
                if (cancelled || !sdkShape || typeof sdkShape !== 'object'
                    || (!sdkShape.native && !Array.isArray(sdkShape.tokens))) return;
                const balance = (decoderLib.balancesFromSdk(sdkShape) || [])
                    .find((entry) => String(entry?.tick || '').trim().toUpperCase() === tick);
                const rawAsset = String(sdkShape.native?.tick || '').trim().toUpperCase() === tick
                    ? sdkShape.native
                    : (sdkShape.tokens || []).find(
                        (entry) => String(entry?.tick || '').trim().toUpperCase() === tick,
                    );
                const divisibility = Number(rawAsset?.divisibility);
                setStakeBalance(balance?.unknown ? null : String(balance?.amount ?? '0'));
                setStakeBalanceDivisibility(
                    Number.isInteger(divisibility) && divisibility >= 0 ? divisibility : null,
                );
            })
            .catch(() => { /* Max stays disabled when this address's balance cannot be read. */ });
        return () => { cancelled = true; };
    }, [chainId, feed?.tick, fromAddress?.address, messaging]);
    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // Placing a bet is fee-bearing (BET v2 pre-funds one payout credit),
    // so it carries the same fee lane as every other fee-bearing action. On
    // LTC/DOGE the hook forces it on: there is no XCHAIN fee lane on those
    // chains, so a bet placed without the native output is broadcast, costs a
    // miner fee, and never joins the pool.
    const coinTicker = protocolCoinTickerFor(chainId);
    const nativeFee = useNativeFee(chainId);
    const feeEstimate = useMemo(
        () => estimateNativeSendFee({ chainId, chainRegistry }),
        [chainId],
    );

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
        if (!feed || outcome === null || betAmountError(amount, feed.min_amount)) return undefined;
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
        return {
            feedActionIndex: feedIndex,
            outcome,
            amount: String(amount).trim(),
            // The SDK uses the market definition to range-check the selected
            // index before compose. Without it, a malformed explorer response
            // can turn an out-of-range choice into a signed, fee-burning bet.
            outcomes: outcomeLabels,
        };
    }

    // The host's placeBetParams builder produces this validated BET v2 map.
    // It is used only for the display quote; compose and submit continue to use
    // the host builder above as the signing authority.
    const quoteActionData = useMemo(() => {
        if (!fromAddress || !feed || outcome === null
            || outcome < 0 || outcome >= outcomeLabels.length
            || betAmountError(amount, feed.min_amount)) return null;
        return {
            action: 'BET',
            params: {
                version: 2,
                feedActionIndex: String(feedIndex).trim(),
                outcome: String(outcome),
                amount: String(amount).trim(),
                memo: '',
            },
        };
    }, [amount, feed, feedIndex, fromAddress, outcome, outcomeLabels.length]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });

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

    // The page keeps the market it loaded and reads it once. A market that
    // closed, settled or was cancelled since still composes and signs, and with
    // pre-flight off or local nothing warns: the bet pays the miner fee and the
    // protocol fee and joins no pool. So the bet reads the market again before
    // it composes. A failed read is unknown, never a refusal.
    async function closedMarketRefusal() {
        let fresh;
        try {
            fresh = unwrap(await messaging.betFeed({ chainId, feedIndex }));
        } catch {
            return null;
        }
        if (!fresh || String(fresh.action_index) !== String(feedIndex)) return null;
        if (!fresh.feed_status || fresh.feed_status === 'open') return null;
        setFeed(fresh);
        return `This market no longer takes bets (${statusLabel(fresh.feed_status).toLowerCase()}). Nothing was sent.`;
    }

    // Compose through the SDK's own placeBetParams builder, host-side. A
    // client-side wire mirror would be SIGNED rather than caught, and for BET the
    // stakes are literal: a place-bet and a resolve differ on the wire only by
    // AMOUNT (that rule, sharper here).
    async function placeBet() {
        if (!fromAddress) { setFormError('No address on this network to bet from.'); return; }
        if (outcome === null) { setFormError('Choose an outcome.'); return; }
        if (amountPrecisionError) { setFormError(amountPrecisionError); return; }
        const amountProblem = betAmountError(amount, feed?.min_amount);
        if (amountProblem) { setFormError(amountProblem); return; }
        if (submitLockRef.current) return;
        submitLockRef.current = true;
        setSubmitting(true);
        setFormError(null);
        const from = sourceDescriptor();
        try {
            const closed = await closedMarketRefusal();
            if (closed) { setFormError(closed); return; }
            if (isWatcherMode) {
                const res = await messaging.buildBetActionPsbtRequest({
                    chainId,
                    from,
                    builder: 'placeBetParams',
                    params: betParams(),
                    payFeeInNativeCoin: nativeFee.flag,
                });
                setResult(res);
                return;
            }
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
                // The market can close while the review is on screen, and a
                // bet is judged by the block it lands in: signing then pays
                // both fees for a bet that joins no pool. Approve reads the
                // market once more and stops before the signature.
                recheckBeforeSign: closedMarketRefusal,
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
            // Through the shared mapper, not a hand-rolled ternary:
            // the native-fee branch was the only one this form translated, so
            // an SDK params-builder refusal reached the user as the builder's
            // own log line - "betting.placeBetParams: amount must be a positive
            // stake" for a zero stake, measured on regtest (D-118).
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory,
                // The raw message stays the fallback (the in-repo convention): a node
                // rejection reason is worth showing verbatim when nothing recognises it.
                fallback: err?.message || 'Bet failed.',
            }));
        } finally {
            submitLockRef.current = false;
            setSubmitting(false);
        }
    }

    // The error leads the page, above the market's terms, so a phone that tapped
    // Place bet from the bottom of the form is taken to it.
    useEffect(() => {
        if (!formError) return;
        document.querySelector('main [role="alert"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [formError]);

    // The bet's receipt leads the page (above the card), so a phone
    // that placed the bet from the foot of the Bet tab is taken to it.
    useEffect(() => {
        if (!result) return;
        document.querySelector('[data-testid="bet-result"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [result]);

    // My Bets is this wallet's own rows from the market's bet read.
    const myBets = useMemo(() => {
        const mine = new Set((addressesByChain?.[chainId] || []).map((a) => String(a.address)));
        return (Array.isArray(feedBets) ? feedBets : [])
            .filter((b) => mine.has(String(b?.source)))
            .sort((a, b) => Number(b?.action_index || 0) - Number(a?.action_index || 0));
    }, [feedBets, addressesByChain, chainId]);

    const header = <PageHeader onBack={onBack} title="Market" />;
    const wrap = (children, notices) => (
        <Screen variant={variant} header={header}>
            <ListPage notices={notices}>{children}</ListPage>
        </Screen>
    );

    // The confirm page, rendered in place of the market while the single-encode
    // pipeline is live. Without this branch `actionConfirm.run` opens a confirm
    // phase nothing draws, so the bet never reaches Approve AND the confirm
    // singleton stays held, which makes every other form's confirm reject as
    // busy until this screen unmounts.
    //
    // The intent is decoded from the params the HOST composed, never from the
    // form state: a place-bet and a resolve differ on the wire only by AMOUNT.
    if (actionConfirm.open) {
        // The stake leaves the signer on the chosen outcome.
        const betTick = String(feed?.tick || '').trim().toUpperCase();
        const betAmount = String(amount).trim();
        const betOutcome = Array.isArray(outcomeLabels) && outcome != null ? outcomeLabels[Number(outcome)] : null;
        const betSummary = {
            verb: t('components.confirmSummary.verbPlaceBet'),
            ...(betTick && betAmount ? { amount: betAmount, ticker: betTick } : {}),
            ...(betOutcome ? { target: neutralizeControlText(betOutcome, { maxLength: 80 }) } : {}),
            direction: 'out',
            chainId,
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={betSummary}
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

    // The market fixes the network, so the picker stays on this chain. The
    // market's own oracle address cannot bet on it, so that row is disabled.
    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                unavailableReason={(a) => (feed && String(a.address) === String(feed.source)
                    ? 'This address runs this market, so it cannot bet on it.'
                    : null)}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (error) {
        return wrap(
            <>
                <StatusMessage variant="error">{error}</StatusMessage>
            </>,
        );
    }
    if (!feed) return wrap(<p>Loading market…</p>);
    if (result?.psbtHex && !(result?.txid || result?.tx_hash)) {
        return wrap(
            <ResultScreen
                state="unsigned"
                result={result}
                onBuildAnother={() => setResult(null)}
                onDone={onBack}
            />,
        );
    }

    const outcomes = outcomeLabels;
    const live = isLiveFeedStatus(feed.feed_status);
    const livePools = poolRowsForOutcomes(feed.pools, outcomes.length);
    // A terminal market uses the explorer aggregate when present, or the
    // compatibility reconstruction when the aggregate is empty.
    const pools = live ? livePools : poolRowsForOutcomes(settledSplit || livePools, outcomes.length);
    const byOutcome = {};
    for (const p of pools) byOutcome[Number(p.outcome)] = p;
    const total = sumDecimalStrings(pools.map((pool) => pool.pool || '0'));
    const betCount = pools.reduce((n, p) => n + Number(p.bet_count || 0), 0);
    const timeline = Array.isArray(feed.timeline) ? feed.timeline : [];
    const hasWinningOutcome = feed.winning_outcome !== undefined
        && feed.winning_outcome !== null
        && feed.winning_outcome !== '';
    const winningOutcome = hasWinningOutcome ? Number(feed.winning_outcome) : null;
    const winningLabel = Number.isInteger(winningOutcome)
        ? outcomePhrase(outcomes, winningOutcome)
        : null;
    const ownsMarket = (addressesByChain?.[chainId] || [])
        .some((address) => String(address.address) === String(feed.source));
    const resolveWindowOpen = feed.feed_status === 'closed'
        && Number(feed.expire_at) > Math.floor(Date.now() / 1000);
    const tick = feed.tick ? String(feed.tick).toUpperCase() : '';
    const withTick = (value) => `${formatWithThousands(trimAmountTail(value ?? 0) || '0')}${tick ? ` ${tick}` : ''}`;
    const shareOf = (i) => {
        const p = byOutcome[i];
        if (!p || compareDecimalStrings(total, '0') !== 1) return null;
        return `${roundDecimalString(divideDecimalStrings(multiplyDecimalStrings(p.pool || '0', '100'), total, 1), 1)}%`;
    };

    // The place-bet form is only on the page for an open market this wallet does
    // not run. Its demo note and its error lead the page content: the form sits
    // below the market's terms, and a notice there is easy to miss.
    const showsBetForm = feed.feed_status === 'open'
        && !(fromAddress && feed.source === fromAddress.address);

    // The outcome of a bet OUTLIVES the form that started it, so it is
    // reported apart from the form. A submit ends with reload(), and a market
    // that closed while the user sat on the confirm screen comes back
    // `closed` - which unmounts the place-bet form and, when the receipt lived
    // inside it, took both the txid and the error line with it. The user was
    // left on a market page that said nothing at all, unable to tell a wallet
    // that refused from a bet that was broadcast and paid for. By this point
    // the money is spent either way, so the txid is owed whatever the market's
    // status has become. It leads the page with the other notices, so
    // it stays on screen whichever tab is open.
    const resultCard = result ? (
        <div className={styles.listCard} data-testid="bet-result">
            <p className={styles.summary}>
                {/* leg (a): a queued result is SIGNED and not broadcast, so
                    "Bet placed" would claim the one thing that has not happened. */}
                {result?.queued
                    ? 'Signed, but your bet could not reach the network just now. It is waiting in '
                      + 'the queued-transactions banner and only goes out when you broadcast it from '
                      + 'there; the wallet reminds you when the network is back. Do not place it again.'
                    : feed.feed_status === 'open'
                        ? 'Bet placed.'
                        : 'Bet sent, but betting closed while you were confirming it. A bet is judged '
                          + 'by the block it lands in, so the network will most likely reject this one. '
                          + 'The network fee and the protocol fee are spent either way.'}
            </p>
            {result?.queued ? null : (
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(result?.txid || result?.tx_hash || 'n/a')}</dd>
                </dl>
            )}
        </div>
    ) : null;

    const pageNotices = (showsBetForm && demoGuard.blocked) || formError || resultCard ? (
        <>
            {showsBetForm ? demoGuard.note : null}
            {formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            {resultCard}
        </>
    ) : null;

    const fromField = fromAddress ? (
        <AddressField
            label="From"
            icon="addresses"
            value={fromAddress.address}
            readOnly
            onChange={() => {}}
            onIconClick={() => setSourcePickerOpen(true)}
            iconLabel="Choose source address"
            help="The address that places this bet and receives any payout. It must hold the stake in this market's token, and it cannot be the address that runs the market."
        />
    ) : null;

    // 25, 50 and 75 percent of the source address's stake balance,
    // rounded down to the token's decimals; Max is the whole balance.
    const stakeDivisibility = stakeTokenInfo?.divisibility ?? stakeBalanceDivisibility;
    const portionOf = (percent) => {
        if (stakeBalance === null) return null;
        if (percent === 100) return stakeBalance;
        const raw = multiplyDecimalStrings(stakeBalance, String(percent / 100));
        if (raw === null) return null;
        const places = stakeDivisibility !== null && stakeDivisibility !== undefined && Number.isInteger(Number(stakeDivisibility))
            ? Number(stakeDivisibility)
            : 8;
        const [whole, frac = ''] = String(raw).split('.');
        return trimAmountTail(places > 0 ? `${whole}.${frac.slice(0, places).padEnd(places, '0')}` : whole) || '0';
    };
    const pickPortion = (percent) => {
        const value = portionOf(percent);
        if (value === null) return;
        setAmount(value);
        setFormError(null);
    };

    const iconFor = (label, i) => {
        if (/^yes$/i.test(String(label))) return <Icon.CheckIcon />;
        if (/^no$/i.test(String(label))) return <Icon.XIcon />;
        return (
            <svg className={local.outcomeSwatch} viewBox="0 0 12 12" aria-hidden="true">
                <circle cx="6" cy="6" r="5" fill={OUTCOME_COLORS[i % OUTCOME_COLORS.length] === '#FFFFFF' ? 'currentColor' : OUTCOME_COLORS[i % OUTCOME_COLORS.length]} />
            </svg>
        );
    };

    // The four section tabs, each an icon and a short word, so no
    // label wraps at 360px.
    const tabLabel = (IconGlyph, text) => (
        <span className={homeTabsStyles.tabWithIcon}>
            <span className={homeTabsStyles.tabIcon} aria-hidden="true"><IconGlyph /></span>
            {text}
        </span>
    );
    const tabItems = [
        { id: 'bet', label: tabLabel(Icon.ZapIcon, 'Bet') },
        { id: 'details', label: tabLabel(Icon.InfoIcon, 'Details') },
        { id: 'activity', label: tabLabel(Icon.HistoryIcon, 'Activity') },
        { id: 'mine', label: tabLabel(Icon.UserIcon, 'My Bets') },
    ];

    // One bet per row in Activity and My Bets.
    const betRow = (b, { showSource }) => {
        const i = Number(b?.outcome);
        const label = Number.isInteger(i) ? (safeOutcomeLabel(outcomes[i]) || `Outcome ${i}`) : 'Unknown outcome';
        const rejected = !isAcceptedBet(b);
        const status = rejected ? 'Rejected' : (b?.bet_status ? String(b.bet_status).replace(/_/g, ' ') : '');
        return (
            <li key={String(b?.action_index ?? b?.tx_hash)} className={local.betRow}>
                <span className={local.betRowMain}>
                    <span className={local.betRowOutcome}>{label}</span>
                    <span className={local.betRowAmount}>{withTick(b?.amount)}</span>
                </span>
                <span className={local.betRowMeta}>
                    {showSource && b?.source ? <span className={local.betRowSource}>{String(b.source)}</span> : null}
                    <span>{b?.timestamp ? fmtTime(b.timestamp) : `block ${String(b?.block_index ?? 'n/a')}`}</span>
                    {status ? <span className={rejected ? local.betRowRejected : undefined}>{status}</span> : null}
                </span>
            </li>
        );
    };
    const recentBets = (Array.isArray(feedBets) ? feedBets : [])
        .slice()
        .sort((a, b) => Number(b?.action_index || 0) - Number(a?.action_index || 0));
    const betsPartialNote = Array.isArray(feedBets) && feedBets.length >= SETTLED_BET_LIMIT ? (
        <p className={styles.hint}>
            This market took more than {SETTLED_BET_LIMIT} bets; only {SETTLED_BET_LIMIT} were read.
        </p>
    ) : null;
    // What this wallet holds on each side, under the Place bet button.
    const heldByOutcome = new Map();
    for (const b of myBets) {
        if (!isAcceptedBet(b) || (b?.bet_status && b.bet_status !== 'open')) continue;
        const i = Number(b?.outcome);
        const amountText = String(b?.amount ?? '').trim();
        if (!Number.isInteger(i) || !/^\d{1,47}(\.\d{1,18})?$/.test(amountText)) continue;
        heldByOutcome.set(i, sumDecimalStrings([heldByOutcome.get(i) || '0', amountText]));
    }

    // Details lists the market facts one per row (label, value).
    const factRow = (label, value) => (
        <div className={local.factRow}>
            <dt className={local.factLabel}>{label}</dt>
            <dd className={local.factValue}>{value}</dd>
        </div>
    );

    const detailsPanel = (
        <>
            <dl className={local.facts}>
                {factRow('Betting closes', fmtTime(feed.deadline))}
                {factRow('Resolution source', 'Reported by the market oracle')}
                {feed.source ? factRow('Run by', onOpenOracle ? (
                    <Button
                        type="button"
                        variant="link"
                        size="sm"
                        icon={<Icon.AddressIcon />}
                        className={local.factLink}
                        onClick={() => onOpenOracle(chainId, feed.source)}
                    >
                        {feed.source}
                    </Button>
                ) : <span className={local.factAddress}>{feed.source}</span>) : null}
                {factRow('Pool', withTick(total))}
                {factRow('Bets placed', String(betCount))}
                {feed.min_amount ? factRow('Minimum bet', withTick(String(feed.min_amount))) : null}
                {factRow('Oracle fee', `${feed.fee ?? '0'}% of the pot`)}
                {factRow('Refunds if unresolved by', fmtTime(feed.expire_at))}
                {factRow('Market', `#${String(feed.action_index)}`)}
            </dl>
            {(feed.allow_list || feed.block_list) ? (
                <p className={styles.hint}>
                    This market is restricted to a list of addresses. If you are blocked, your bet is
                    rejected and nothing is taken from your balance.
                </p>
            ) : null}

            {feed.feed_status === 'closed' ? (
                <div className={styles.listCard} data-testid="bet-settlement">
                    <strong>Pending resolution</strong>
                    <p className={styles.hint}>
                        {resolveWindowOpen
                            ? 'The market oracle must publish the winning outcome before the refund window ends. Payouts settle automatically when the result is recorded; bettors do not submit a claim.'
                            : 'The resolution window has ended. The protocol refunds every bet automatically when the network records the expiry; bettors do not submit a claim.'}
                    </p>
                    {resolveWindowOpen && ownsMarket && onSettleMarket ? (
                        <Button variant="primary" icon={<Icon.CheckIcon />} onClick={onSettleMarket}>Settle This Market</Button>
                    ) : null}
                </div>
            ) : null}

            {feed.feed_status === 'resolved' ? (
                <div className={styles.listCard} data-testid="bet-settlement">
                    <strong>Winning outcome: {winningLabel || 'recorded by the oracle'}</strong>
                    <p className={styles.hint}>
                        Winning bets settled as won and losing bets lost their stakes. The protocol credited
                        any payout automatically; bettors have nothing to claim.
                    </p>
                </div>
            ) : null}

            {feed.feed_status === 'resolved_void' ? (
                <div className={styles.listCard} data-testid="bet-settlement">
                    <strong>Market voided{winningLabel ? `: ${winningLabel} had no bets` : ''}</strong>
                    <p className={styles.hint}>
                        Every bet was refunded automatically because no bet backed the reported winner.
                        Bettors have nothing to claim.
                    </p>
                </div>
            ) : null}

            {feed.feed_status === 'cancelled' || feed.feed_status === 'expired' ? (
                <div className={styles.listCard} data-testid="bet-settlement">
                    <strong>{feed.feed_status === 'cancelled' ? 'All bets refunded' : 'Expired without a result'}</strong>
                    <p className={styles.hint}>
                        The protocol refunded every bet automatically. Bettors have nothing to claim.
                    </p>
                </div>
            ) : null}

            <SectionHeader as="h3" title={live ? 'Current split' : 'Final split'} />
            {outcomes.length === 0 ? <EmptyState title="No outcomes recorded" body="Settled market outcomes appear here." titleAs="p" /> : (
                <div className={local.splitList} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {outcomes.map((label, i) => {
                        const p = byOutcome[i] || { pool: 0, bet_count: 0 };
                        // "no bets yet" only reads as true while betting can
                        // still happen; on a market that is over it asserts
                        // that nobody ever bet, which may be false and is
                        // never something this screen can promise.
                        const share = compareDecimalStrings(total, '0') === 1
                            ? `${roundDecimalString(divideDecimalStrings(
                                multiplyDecimalStrings(p.pool || '0', '100'),
                                total,
                                1,
                            ), 1)}%`
                            : (live ? 'no bets yet' : 'no bets');
                        // (a): the pool is a DECIMAL(65,18) SUM, so it
                        // arrives with an 18-place tail whatever the token's
                        // own decimals are. A market denominated in a
                        // 0-decimal token read "300.000000000000000000".
                        const pool = trimAmountTail(p.pool ?? 0) || '0';
                        const bets = Number(p.bet_count || 0);
                        return (
                            <div
                                key={i}
                                className={`${styles.listCard} ${styles.betOddsRow}`}
                                style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}
                            >
                                <span className={styles.splitValue}>{i}: {safeOutcomeLabel(label) || `Outcome ${i}`}</span>
                                <span className={styles.splitValue}>{pool} ({share}, {bets} bet{bets === 1 ? '' : 's'})</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {!live && settledPartial ? (
                <p className={styles.hint}>
                    This market took more than {SETTLED_BET_LIMIT} bets, so the split above covers the
                    most recent {SETTLED_BET_LIMIT} rather than all of them.
                </p>
            ) : null}

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
        </>
    );

    // Place-bet flow. Hidden outright when it could only produce a rejected
    // transaction: a closed market takes no bets, and the feed's own source
    // may not bet on its own market (§6 format 2). Showing a doomed form and
    // letting the chain refuse it would cost the user a fee for nothing.
    const betPanel = feed.feed_status === 'open' ? (
        fromAddress && feed.source === fromAddress.address ? (
            <>
                {fromField}
                <p className={styles.hint}>
                    You run this market, so you cannot bet on it. That rule exists because an oracle
                    who could bet on its own result would decide the result.
                </p>
            </>
        ) : (
            <>
                <SectionHeader as="h3" title="Place a bet" />
                <FormPage
                    label="Place a bet"
                    onSubmit={(event) => event.preventDefault()}
                    // Full width, a bolt icon, no ticker in the label.
                    actions={(
                        <Button
                            variant="success"
                            block
                            className={local.placeButton}
                            icon={isWatcherMode ? <Icon.PlusIcon /> : <Icon.ZapIcon />}
                            loading={submitting || actionConfirm.composing}
                            disabled={demoGuard.blocked || submitting || actionConfirm.composing}
                            onClick={placeBet}
                        >
                            {actionConfirm.composing
                                ? 'Preparing Review…'
                                : isWatcherMode ? 'Create Unsigned Transaction' : 'Place Bet'}
                        </Button>
                    )}
                >
                    {fromField}
                    {/* aria-pressed, because which outcome is selected decides which
                        side of the bet the money lands on and the only other signal
                        is the button's background colour. A screen reader announced
                        two identical "Yes" / "No" buttons with no selected state.
                        Drawn as one segmented control, each side with its
                        icon and current share, directly above the stake. */}
                    <div id={`bet-outcome-label-${String(feed.action_index)}`} className={local.groupLabel}>
                        Outcome to back
                        <InfoTip aria="About Outcome to back" label="Pick the result you think will happen. Everyone backing the winning outcome splits the whole pot, minus the oracle's fee." />
                    </div>
                    <div role="group" aria-label="Outcome to back" aria-describedby={`bet-outcome-label-${String(feed.action_index)}`} className={local.outcomeSegments}>
                        {outcomes.map((label, i) => {
                            const outcomeText = safeOutcomeLabel(label) || `Outcome ${i}`;
                            const share = shareOf(i);
                            return (
                                <Button
                                    key={i}
                                    type="button"
                                    variant="ghost"
                                    className={`${local.outcomeSegment} ${outcome === i ? local.outcomeSegmentActive : ''} ${/^yes$/i.test(String(label)) ? local.outcomeYes : /^no$/i.test(String(label)) ? local.outcomeNo : ''}`}
                                    icon={iconFor(label, i)}
                                    aria-label={outcomeText}
                                    aria-pressed={outcome === i}
                                    onClick={() => setOutcome(i)}
                                >
                                    {/* The share is drawn from a data attribute so the
                                        button's text stays the outcome's own label. */}
                                    <span className={local.outcomeText}>
                                        <span className={local.outcomeName}>{outcomeText}</span>
                                        {share ? <span className={local.outcomeShare} data-share={share} aria-hidden="true" /> : null}
                                    </span>
                                </Button>
                            );
                        })}
                    </div>
                    <AmountField
                        label="Stake"
                        help="How much to bet. A stake buys a share of the pot that every later bet re-divides, and payouts round down. Once confirmed, a bet cannot be cancelled or moved to another outcome."
                        amount={amount}
                        tick={feed.tick || ''}
                        divisibility={stakeDivisibility}
                        onAmountFieldChange={(rawValue) => {
                            setAmount(String(rawValue).replace(/,/g, ''));
                            setFormError(null);
                        }}
                        onValidationError={(fieldError) => {
                            setAmountPrecisionError(fieldError?.startsWith('Enter a valid decimal amount')
                                ? 'Enter a positive bet amount using digits and an optional decimal point.'
                                : fieldError);
                        }}
                        onMax={stakeBalance !== null
                            ? () => { setAmount(stakeBalance); setFormError(null); }
                            : undefined}
                        maxDisabled={stakeBalance === null}
                        balanceText={stakeBalance !== null && feed.tick
                            ? `${formatWithThousands(stakeBalance)} ${String(feed.tick).toUpperCase()} available`
                            : null}
                    />
                    <div className={local.portions} role="group" aria-label="Quick amounts">
                        {[25, 50, 75, 100].map((percent) => {
                            const value = portionOf(percent);
                            const active = value !== null && amount !== '' && compareDecimalStrings(String(amount), value) === 0;
                            return (
                                <Button
                                    key={percent}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={`${local.portion} ${active ? local.portionActive : ''}`}
                                    aria-pressed={active}
                                    disabled={value === null}
                                    onClick={() => pickPortion(percent)}
                                >
                                    {percent === 100 ? 'Max' : `${percent}%`}
                                </Button>
                            );
                        })}
                    </div>
                    {/* The one number the decision turns on. A parimutuel stake has no
                        price the user can reason about on their own: it buys a share of a
                        pot that every later bet re-divides, so the pool split above is not
                        an answer to "what would I win". Payout, profit and odds all come
                        back from the same SDK call that settlement's arithmetic follows.
                        Zero is called out in words because it is the case the abstract
                        rounding warning below is really about. */}
                    {projected ? (
                        <div className={local.payout} data-testid="bet-projection">
                            {compareDecimalStrings(projected.payout, '0') === 1 ? (
                                <dl className={local.payoutList}>
                                    <div className={local.payoutRow}>
                                        <dt>Potential payout</dt>
                                        <dd className={local.payoutValue}>{trimAmountTail(projected.payout)}{feed.tick ? ` ${feed.tick}` : ''}</dd>
                                    </div>
                                    <div className={local.payoutRow}>
                                        <dt>If <strong>{safeOutcomeLabel(outcomes[outcome]) || `outcome ${outcome}`}</strong> wins</dt>
                                        <dd>
                                            {projected.impliedOdds !== undefined
                                                ? `${trimZeros(projected.impliedOdds)}x your stake`
                                                : 'pays out'}
                                        </dd>
                                    </div>
                                    {projected.profit !== undefined ? (
                                        <div className={local.payoutRow}>
                                            <dt>Profit</dt>
                                            <dd>
                                                {compareDecimalStrings(projected.profit, '0') === -1
                                                    ? `${trimZeros(projected.profit).replace('-', '')} less than you staked`
                                                    : `a profit of ${trimZeros(projected.profit)}`}
                                            </dd>
                                        </div>
                                    ) : null}
                                    <div className={local.payoutRow}>
                                        <dt>Oracle fee</dt>
                                        <dd>{feed.fee ?? '0'}% of the pot</dd>
                                    </div>
                                </dl>
                            ) : (
                                <p>
                                    At the current split this stake would win and still pay{' '}
                                    <strong>nothing</strong>, because payouts round down. Stake more, or
                                    wait for the pot to move.
                                </p>
                            )}
                            <p className={styles.hint}>
                                That is the split as it stands right now, not a locked-in price: every
                                later bet moves it, in either direction.
                            </p>
                        </div>
                    ) : null}
                    <FeesCard
                        chainId={chainId}
                        quote={protocolFeeQuote}
                        pending={protocolFeePending}
                        feeSelector={null}
                        tiers={feeEstimate ? { normal: feeEstimate } : undefined}
                        value={{ mode: 'normal' }}
                        coinTicker={coinTicker}
                    >
                        <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />
                    </FeesCard>
                    {!isWatcherMode && !isHwSource && !signerReady ? (
                        <Input
                            label="Password"
                            help="Your wallet password, used to sign this bet. It never leaves this device."
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    ) : null}
                </FormPage>
                {heldByOutcome.size > 0 ? (
                    <p className={local.heldLine}>
                        <span className={local.heldIcon} aria-hidden="true"><Icon.TokenIcon /></span>
                        <span>
                            You hold{' '}
                            {[...heldByOutcome.entries()].map(([i, held], n) => (
                                <span key={i}>
                                    {n > 0 ? ', ' : ''}
                                    <strong>{withTick(held)}</strong> on {safeOutcomeLabel(outcomes[i]) || `Outcome ${i}`}
                                </span>
                            ))}
                        </span>
                    </p>
                ) : null}
            </>
        )
    ) : (
        <EmptyState
            title="Betting is closed"
            body={`This market no longer takes bets (${statusLabel(feed.feed_status).toLowerCase()}).`}
            titleAs="p"
        />
    );

    // Activity is the market's recent bets, then its status history.
    const activityPanel = (
        <>
            <SectionHeader as="h3" title="Recent bets" />
            {feedBets === null ? <p className={styles.hint}>Loading bets…</p> : null}
            {feedBetsFailed ? <StatusMessage variant="error">Could not load this market's bets.</StatusMessage> : null}
            {feedBets !== null && !feedBetsFailed && recentBets.length === 0 ? (
                betCount > 0 ? (
                    // The pools count bets the bet read did not list, so the
                    // empty list says that instead of claiming none exist.
                    <EmptyState title="No bet rows returned" body={`The market counts ${betCount} bet${betCount === 1 ? '' : 's'}, but the explorer listed none of them.`} titleAs="p" />
                ) : (
                    <EmptyState title={live ? 'No bets yet' : 'No bets'} body="Bets on this market appear here as they are placed." titleAs="p" />
                )
            ) : null}
            {recentBets.length > 0 ? (
                <ul className={local.betList}>{recentBets.map((b) => betRow(b, { showSource: true }))}</ul>
            ) : null}
            {betsPartialNote}
            <SectionHeader as="h3" title="History" />
            {timeline.length === 0 ? <EmptyState title="No history yet" body="Market updates appear here as they happen." titleAs="p" /> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {timeline.map((t, i) => (
                        <div key={i} className={styles.hint}>
                            {statusLabel(t.status)} · block {String(t.block_index ?? 'n/a')}
                            {t.status === 'resolved' && winningLabel ? ` · winner ${winningLabel}` : ''}
                            {/* The close is recorded by the chain rather than caused by anyone's
                                transaction, so it is labelled instead of shown as an action. */}
                            {t.synthetic ? ' (automatic, when the deadline passed)' : ''}
                        </div>
                    ))}
                </div>
            )}
        </>
    );

    // My Bets is this wallet's rows from the same bet read.
    const myBetsPanel = (
        <>
            {feedBets === null ? <p className={styles.hint}>Loading your bets…</p> : null}
            {feedBetsFailed ? <StatusMessage variant="error">Could not load your bets on this market.</StatusMessage> : null}
            {feedBets !== null && !feedBetsFailed && myBets.length === 0 ? (
                <EmptyState title="No bets from this wallet" body="Bets you place on this market from this wallet's addresses appear here." titleAs="p" />
            ) : null}
            {myBets.length > 0 ? (
                <ul className={local.betList}>{myBets.map((b) => betRow(b, { showSource: false }))}</ul>
            ) : null}
            {betsPartialNote}
        </>
    );

    // The blue card, then the tabs; only the chosen tab's panel shows.
    return wrap(
        <>
            <BetMarketHero
                feed={feed}
                outcomes={outcomes}
                pools={pools}
                total={total}
                betCount={betCount}
                bets={feedBets}
                statusText={statusLabel(feed.feed_status)}
                live={live}
            />

            <Tabs
                id={tabsId}
                items={tabItems}
                value={tab}
                onChange={setTab}
                panelId={`${tabsId}-panel`}
                aria-label="Market sections"
                className={local.sectionTabs}
            />
            <div
                id={`${tabsId}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${tab}`}
                className={local.panel}
            >
                {tab === 'bet' ? betPanel : null}
                {tab === 'details' ? detailsPanel : null}
                {tab === 'activity' ? activityPanel : null}
                {tab === 'mine' ? myBetsPanel : null}
            </div>

            {demoGuard.dialog}
        </>,
        pageNotices,
    );
}
