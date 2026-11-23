// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isDeviceAddressSource } from '../../schemas/constants.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, Button, EmptyState, Icon, IconSelect, ListPage, PageHeader, Screen, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
// The Wallet Form Standard pieces. Its FormSection is the collapsible one,
// not the settings block of the same name in core/ui.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FormStatusSlot,
    FromSection,
    joinSummary,
    MemoSection,
    useFormSections,
} from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import {
    customFeeEstimate,
    customFeeReviewStop,
    displayRateToSettingsCustom,
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
} from '../../flows/feeEstimate.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
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
    subtractDecimalStrings,
    trimAmountTail,
    sumDecimalStrings,
} from '../utils/amountFormat.js';
import { outcomeLabelsOf, outcomePhrase, safeOutcomeLabel } from '../utils/betOutcomeLabels.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import { tickAmountOf } from '../utils/walletBalanceShape.js';
import styles from './IssueTokenForm.module.css';
import local from './BetFeedDetail.module.css';
// The blue market hero and the page under it: the outcome page layout the
// poll page shares, so the two cannot drift.
import { BetMarketHero } from './BetMarketHero.jsx';
import {
    OutcomeActivity,
    OutcomeDetailLayout,
    OutcomeFacts,
    OutcomeOwnerActions,
    OutcomeResult,
} from '../components/outcomeDetail/OutcomeDetailLayout.jsx';
// The oracle's own actions (Post result, Cancel and refund, Edit lists) and
// the rules for when the chain accepts each, shared with the oracle console.
import { oracleActionLegality, oracleTimingText, useOracleMarketActions } from './OracleConsole.jsx';
import { OUTCOME_COLORS } from '../components/outcomeDetail/outcomeColors.js';
// The Bet tab's outcome list and the outcome marks Activity leads with.
import { OutcomeList, OutcomeMark, outcomeMarkOf } from './OutcomeList.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
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

// Explorer bet lists serve at most this many rows per page. The detail read
// walks the keyset pages and reports when the paging cap still leaves rows out.
const BET_PAGE_ROWS = 100;

function betReadStatus(resp, rows) {
    const hasTotal = !Array.isArray(resp) && resp && typeof resp === 'object'
        && resp.total !== null && resp.total !== undefined && resp.total !== '';
    const rawTotal = hasTotal
        ? Number(resp.total)
        : NaN;
    const total = Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : null;
    return {
        total,
        partial: resp?.truncated === true || (total !== null
            ? total > rows.length
            : rows.length >= BET_PAGE_ROWS),
    };
}

function statusLabel(status) {
    if (status === 'open') return 'Positions available';
    if (status === 'closed') return 'Purchases closed, waiting on the result';
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

// Settlement floors both the oracle fee and each payout at the asset's
// precision. The decimal helpers keep the arithmetic exact; this final slice
// applies the protocol's floor instead of display rounding.
function floorAmount(value, places) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? ''));
    const precision = Number(places);
    if (!match || !Number.isInteger(precision) || precision < 0 || precision > 18) return null;
    if (precision === 0) return match[1];
    const fraction = (match[2] || '').slice(0, precision).replace(/0+$/, '');
    return fraction ? `${match[1]}.${fraction}` : match[1];
}

function potentialPayout({ held, total, outcomePool, feePct, divisibility }) {
    if (compareDecimalStrings(total, '0') !== 1 || compareDecimalStrings(outcomePool, '0') !== 1) return null;
    const precision = Number(divisibility);
    if (!Number.isInteger(precision) || precision < 0 || precision > 18) return null;
    const workPrecision = Math.min(100, precision + 24);
    const feeRaw = divideDecimalStrings(multiplyDecimalStrings(total, String(feePct || 0)), '100', workPrecision);
    const fee = floorAmount(feeRaw, precision);
    const pot = fee === null ? null : subtractDecimalStrings(total, fee);
    const payoutRaw = pot === null
        ? null
        : divideDecimalStrings(multiplyDecimalStrings(held, pot), outcomePool, workPrecision);
    return floorAmount(payoutRaw, precision);
}

function betAmountError(value, minimum) {
    const stake = String(value ?? '').trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(stake);
    if (!match) {
        return 'Enter a positive position amount using digits and an optional decimal point.';
    }
    if ((match[2] || '').length > 18) return 'A position amount can have at most 18 decimal places.';
    const wholeDigits = match[1].replace(/^0+/, '').length || 1;
    if (wholeDigits > 47) return 'This position amount is too large.';
    if (!/[1-9]/.test(`${match[1]}${match[2] || ''}`)) {
        return 'Enter a positive position amount using digits and an optional decimal point.';
    }
    const min = String(minimum ?? '').trim();
    if (min) {
        const minimumMatch = /^(\d+)(?:\.(\d+))?$/.exec(min);
        const minimumWholeDigits = minimumMatch
            ? (minimumMatch[1].replace(/^0+/, '').length || 1)
            : 0;
        if (!minimumMatch || (minimumMatch[2] || '').length > 18 || minimumWholeDigits > 47
            || !/[1-9]/.test(`${minimumMatch[1]}${minimumMatch[2] || ''}`)) {
            return 'This market reports an invalid minimum purchase amount.';
        }
    }
    if (min && compareDecimalStrings(stake, min) === -1) {
        return `This market requires a minimum purchase of ${min}.`;
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
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onDuplicate]  the owner's
 *   "Copy to a new market" (a new market pre-filled from this one's terms)
 * @param {() => void} props.onBack
 * @param {boolean} [props.embedded] drawn inside Bet Markets' wide detail panel
 * @param {(el: HTMLElement | null) => void} [props.measureRef] standalone route width measurement
 */
export function BetFeedDetail({
    walletId,
    chainId,
    feedIndex,
    onOpenOracle,
    onDuplicate,
    onBack,
    embedded = false,
    measureRef,
}) {
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
    const formErrors = useFormErrors();
    const [result, setResult] = useState(/** @type {any} */ (null));
    const [submitting, setSubmitting] = useState(false);
    const submitLockRef = useRef(false);
    const [settledSplit, setSettledSplit] = useState(/** @type {any[] | null} */ (null));
    const [settledPartial, setSettledPartial] = useState(false);
    // The market's bet rows, read once for the hero's chart, the Activity
    // tab, this wallet's own lines and a terminal split rebuild.
    const [feedBets, setFeedBets] = useState(/** @type {any[] | null} */ (null));
    const [feedBetsFailed, setFeedBetsFailed] = useState(false);
    const [feedBetsPartial, setFeedBetsPartial] = useState(false);
    const [feedBetsTotal, setFeedBetsTotal] = useState(/** @type {number | null} */ (null));
    // The tab strip under the hero. Null until the user picks a tab, so the
    // first tab opens: Actions for the market's own oracle (G102), else Bet,
    // or Result once the market stops taking bets. Ownership arrives with the
    // address read, so the first tab can change once before any pick.
    const [tab, setTab] = useState(/** @type {string | null} */ (null));
    // view: the market page; place: the Place Bet form, its own step in this
    // route. Back from Place Bet returns to the market with the outcome kept.
    const [stage, setStage] = useState(/** @type {'view' | 'place'} */ ('view'));
    const [memo, setMemo] = useState('');
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    // Open state of the Place Bet sections, held above the early returns (the
    // From picker page) so it survives them. The bet is the form's main
    // section and starts open; From, Memo and Network fee start closed.
    const sections = useFormSections({
        bet: true, from: false, memo: false, fee: false,
    });
    // Counts Place Bet presses, so the section holding the error reopens on each.
    const [validationAttempt, setValidationAttempt] = useState(0);

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
    // The same read serves every market, because the hero's chart, Activity
    // and this wallet's own lines all draw from the market's bet rows.
    useEffect(() => {
        let cancelled = false;
        setSettledSplit(null);
        setSettledPartial(false);
        setFeedBets(null);
        setFeedBetsFailed(false);
        setFeedBetsPartial(false);
        setFeedBetsTotal(null);
        if (!feed) return undefined;
        const explorerPools = Array.isArray(feed.pools) ? feed.pools : [];
        const terminal = !isLiveFeedStatus(feed.feed_status);
        if (terminal && explorerPools.length > 0) setSettledSplit(explorerPools);
        const rebuildSplit = terminal && explorerPools.length === 0;
        if (typeof messaging.bets !== 'function') { setFeedBets([]); return undefined; }
        messaging.bets({
            chainId,
            query: String(feedIndex),
            type: 'feed',
            opts: { limit: BET_PAGE_ROWS },
            allPages: true,
        })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
                const read = betReadStatus(resp, rows);
                setFeedBets(rows);
                setFeedBetsPartial(read.partial);
                setFeedBetsTotal(read.total);
                if (!rebuildSplit) return;
                setSettledPartial(read.partial);
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
                setStakeBalance(tickAmountOf({ balances: sdkShape }, balance));
                setStakeBalanceDivisibility(
                    Number.isInteger(divisibility) && divisibility >= 0 ? divisibility : null,
                );
            })
            .catch(() => { /* Max stays disabled when this address's balance cannot be read. */ });
        return () => { cancelled = true; };
    }, [chainId, feed?.tick, fromAddress?.address, messaging]);
    const stakeDivisibility = stakeTokenInfo?.divisibility ?? stakeBalanceDivisibility;
    const rawProjectionDecimals = typeof stakeDivisibility === 'string'
        ? stakeDivisibility.trim() : stakeDivisibility;
    const numericProjectionDecimals = rawProjectionDecimals === ''
        || rawProjectionDecimals === null || rawProjectionDecimals === undefined
        ? null : Number(rawProjectionDecimals);
    const projectionDecimals = Number.isSafeInteger(numericProjectionDecimals)
        && numericProjectionDecimals >= 0 ? numericProjectionDecimals : null;
    const isHwSource = isDeviceAddressSource(fromAddress?.source);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // Placing a bet is fee-bearing (BET v2 pre-funds one payout credit),
    // so it carries the same fee lane as every other fee-bearing action. On
    // LTC/DOGE the hook forces it on: there is no XCHAIN fee lane on those
    // chains, so a bet placed without the native output is broadcast, costs a
    // miner fee, and never joins the pool.
    const coinTicker = protocolCoinTickerFor(chainId);
    const nativeFee = useNativeFee(chainId);
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers?.[feePick.mode] || estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate?.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

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
    // The market's own oracle acts from the owner Actions tab, signing from
    // the address that runs the market (never the Bet tab's From address).
    // An action sent re-reads the market, so the tabs follow its new status.
    const oracle = useOracleMarketActions({ walletId, demoGuard, onDone: reload });

    // Wire order of the market's outcomes. Derived up here rather than at render
    // because the projection needs the COUNT: the explorer's pools only carry
    // outcomes that already have a bet, so the count is the only thing that tells
    // the payout math an unbacked outcome exists at all.
    const outcomeLabels = useMemo(() => outcomeLabelsOf(feed), [feed]);

    // Projected payout comes from the SDK's own settlement-order math over the
    // host, never a local approximation. It waits for the wager token's actual
    // precision because the SDK fallback would mis-round other token formats.
    //
    // Failures stay silent on purpose: a stake half-typed ("0.", "") is not an
    // error the user needs told about, it just has no projection yet.
    useEffect(() => {
        let cancelled = false;
        setProjected(null);
        if (!feed || outcome === null || betAmountError(amount, feed.min_amount)) return undefined;
        if (projectionDecimals === null) return undefined;
        if (typeof messaging.betProjectPayout !== 'function') return undefined;
        messaging.betProjectPayout({
            chainId,
            pools: feed.pools || [],
            outcomeCount: outcomeLabels.length,
            outcome,
            stake: amount,
            feePct: feed.fee || 0,
            decimals: projectionDecimals,
        })
            .then((v) => { if (!cancelled) setProjected(v && typeof v === 'object' ? v : null); })
            .catch(() => { if (!cancelled) setProjected(null); });
        return () => { cancelled = true; };
    }, [feed, outcome, amount, chainId, messaging, outcomeLabels, projectionDecimals]);

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
            ...(memo.trim() && { memo: memo.trim() }),
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
                memo: memo.trim(),
            },
        };
    }, [amount, feed, feedIndex, fromAddress, memo, outcome, outcomeLabels.length]);
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
        return `This market no longer accepts purchases (${statusLabel(fresh.feed_status).toLowerCase()}). Nothing was sent.`;
    }

    // Compose through the SDK's own placeBetParams builder, host-side. A
    // client-side wire mirror would be SIGNED rather than caught, and for BET the
    // stakes are literal: a place-bet and a resolve differ on the wire only by
    // AMOUNT (that rule, sharper here).
    async function placeBet() {
        const amountProblem = betAmountError(amount, feed?.min_amount);
        const memoError = memoLengthError(memo.trim());
        if (!formErrors.validate({
            'bet-from-address': !fromAddress ? 'No address on this network to buy from.' : null,
            'bet-outcome': outcome === null ? 'Choose an outcome.' : null,
            'bet-stake': amountPrecisionError || amountProblem,
            'bet-memo': memoError,
        })) return;
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) {
            sections.setOpen('fee', true);
            setFormError(feeStop.formError);
            return;
        }
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
                    ...(feePerKb != null ? { feePerKb } : {}),
                });
                setResult(res);
                return;
            }
            const params = betParams();
            const res = await actionConfirm.run({
                chainId,
                from,
                compose: () => messaging.composeBetForConfirm(withAdvancedOptions({
                    walletId, chainId, from, builder: 'placeBetParams', params,
                    // The fee mode must reach COMPOSE, not just submit: the
                    // FEE_DESTINATION output has to be inside the PSBT the user
                    // approves and the tamper check verifies.
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                })),
                // The market can close while the review is on screen, and a
                // bet is judged by the block it lands in: signing then pays
                // both fees for a bet that joins no pool. Approve reads the
                // market once more and stops before the signature.
                recheckBeforeSign: closedMarketRefusal,
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId, chainId, from, params, prebuiltPsbt,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                }),
            });
            setResult(res);
            setPassword('');
            setAmount('');
            setOutcome(null);
            setMemo('');
            // The market page returns, its receipt leading the page.
            setStage('view');
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
                fallback: err?.message || 'Purchase failed.',
            }));
        } finally {
            submitLockRef.current = false;
            setSubmitting(false);
        }
    }

    // Place Bet's submit: the press counts, so the section holding an error
    // reopens, then the bet runs its checks and composes.
    function handlePlaceBet(event) {
        event.preventDefault();
        setValidationAttempt((n) => n + 1);
        placeBet();
    }

    // The market page's outcome buttons: the tapped outcome opens Place Bet
    // with it chosen.
    function openPlaceBet(index) {
        setOutcome(index);
        setFormError(null);
        setStage('place');
    }

    // Back from Place Bet: the market page, the outcome kept as it stands.
    function backToMarket() {
        setFormError(null);
        setStage('view');
    }

    // A market that stops taking bets under Place Bet (the fresh read before
    // compose, or Approve's) takes the form away: the market page returns,
    // its refusal first.
    const marketClosedUnderPlace = stage === 'place' && Boolean(feed) && feed.feed_status !== 'open';
    useEffect(() => {
        if (marketClosedUnderPlace) setStage('view');
    }, [marketClosedUnderPlace]);
    const showPlace = stage === 'place' && !marketClosedUnderPlace;

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

    // This wallet's own rows from the market's bet read: the held line under
    // Bet and the "You bet" lines on Result.
    const myBets = useMemo(() => {
        const mine = new Set((addressesByChain?.[chainId] || []).map((a) => String(a.address)));
        return (Array.isArray(feedBets) ? feedBets : [])
            .filter((b) => mine.has(String(b?.source)))
            .sort((a, b) => Number(b?.action_index || 0) - Number(a?.action_index || 0));
    }, [feedBets, addressesByChain, chainId]);

    const header = (
        <PageHeader
            nested={showPlace}
            onBack={showPlace ? backToMarket : onBack}
            backDisabled={showPlace && submitting}
            title={showPlace ? 'Buy a Position' : 'Market'}
        />
    );
    const standalone = (page) => (
        <Screen variant={variant} header={header}>
            {measureRef ? <div ref={measureRef} data-list-detail="page">{page}</div> : page}
        </Screen>
    );
    const wrap = (children, notices) => {
        const page = <ListPage notices={notices}>{children}</ListPage>;
        return embedded ? page : standalone(page);
    };

    // The confirm page, rendered in place of the market while the single-encode
    // pipeline is live. Without this branch `actionConfirm.run` opens a confirm
    // phase nothing draws, so the bet never reaches Approve AND the confirm
    // singleton stays held, which makes every other form's confirm reject as
    // busy until this screen unmounts.
    //
    // The intent is decoded from the params the HOST composed, never from the
    // form state: a place-bet and a resolve differ on the wire only by AMOUNT.
    // The owner's own actions draw their confirm page the same way.
    if (oracle.confirmScreen) return oracle.confirmScreen;
    if (actionConfirm.open) {
        // The stake leaves the signer on the chosen outcome.
        const betTick = String(feed?.tick || '').trim().toUpperCase();
        const betSummary = {
            verb: t('components.confirmSummary.verbPlaceBet'),
            ...(betTick ? { ticker: betTick } : {}),
            direction: 'out',
            chainId,
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={betSummary}
                screenVariant={variant}
                feeEstimate={feeEstimate}
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
                    ? 'This address runs this market, so it cannot buy a position in it.'
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
    if (oracle.unsigned) {
        return wrap(
            <ResultScreen
                state="unsigned"
                result={oracle.result}
                onBuildAnother={oracle.reset}
                onDone={onBack}
            />,
        );
    }
    if (result?.psbtHex && !(result?.txid || result?.tx_hash)) {
        return wrap(
            <ResultScreen
                state="unsigned"
                result={result}
                onBuildAnother={() => { setResult(null); setStage('view'); }}
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
    const hasWinningOutcome = feed.winning_outcome !== undefined
        && feed.winning_outcome !== null
        && feed.winning_outcome !== '';
    const winningOutcome = hasWinningOutcome ? Number(feed.winning_outcome) : null;
    const winningLabel = Number.isInteger(winningOutcome)
        ? outcomePhrase(outcomes, winningOutcome)
        : null;
    // The wallet address that runs this market, if any: the owner Actions
    // tab signs from it, and the legality rules read it as the row's owner.
    const ownerAddress = (addressesByChain?.[chainId] || [])
        .find((address) => String(address.address) === String(feed.source)) || null;
    const ownsMarket = Boolean(ownerAddress);
    const ownerFeed = ownerAddress ? { ...feed, chainId, owner: ownerAddress } : null;
    const legality = ownerFeed
        ? oracleActionLegality(ownerFeed, oracle.nowSec)
        : { canResolve: false, canCancel: false, canEdit: false };
    const showsActions = Boolean(ownerFeed)
        && (legality.canResolve || legality.canCancel || legality.canEdit || Boolean(onDuplicate));
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
                    ? 'Signed, but your purchase could not reach the network just now. It is waiting in '
                      + 'the queued-transactions banner and only goes out when you broadcast it from '
                      + 'there; the wallet reminds you when the network is back. Do not buy it again.'
                    : feed.feed_status === 'open'
                        ? 'Position bought.'
                        : 'Purchase sent, but purchases closed while you were confirming it. A purchase is judged '
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

    // The Bet tab's own error (no outcome chosen) sits in its status slot just
    // above Bet; any other error, such as the refusal of a market that
    // closed under Place Bet, leads the page. A demo wallet is never warned
    // here; Place Bet refuses its submit instead.
    const pageError = formError && !showsBetForm ? formError : null;
    // The owner's receipt (a result, cancel or list edit sent) leads the
    // page too: the re-read after it can take the action's tab away.
    const pageNotices = pageError || resultCard || oracle.receipt ? (
        <>
            {pageError ?<StatusMessage variant="error">{pageError}</StatusMessage> : null}
            {resultCard}
            {oracle.receipt}
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
            help="The address that buys this position and receives any payout. It must hold the purchase amount in this market's token, and it cannot be the address that runs the market."
        />
    ) : null;

    // 25, 50 and 75 percent of the source address's stake balance,
    // rounded down to the token's decimals; Max is the whole balance.
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
        if (value === null) {
            formErrors.validate({ 'bet-stake': 'Wait for this address\'s stake balance to load.' });
            return;
        }
        setAmount(value);
        formErrors.clear('bet-stake');
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

    // The shared tab strip: Actions first for the market's own oracle (G102),
    // then Bet while the market takes bets or Result once it stops, then
    // Activity and Details. Everyone else opens on Bet or Result.
    const takingBets = feed.feed_status === 'open';
    const tabItems = [
        // Only the market's own oracle sees its actions (G13: Actions is Zap).
        ...(showsActions ? [{ id: 'actions', label: 'Actions', icon: <Icon.ZapIcon /> }] : []),
        takingBets
            ? { id: 'bet', label: 'Buy', icon: <Icon.ZapIcon /> }
            : { id: 'result', label: 'Result', icon: <Icon.VerifyIcon /> },
        { id: 'activity', label: 'Activity', icon: <Icon.HistoryIcon /> },
        { id: 'details', label: 'Details', icon: <Icon.InfoIcon /> },
    ];

    // One bet per row in Activity; this wallet's own bets are marked.
    const ownAddresses = new Set((addressesByChain?.[chainId] || []).map((a) => String(a.address)));
    const betActivityRow = (b) => {
        const i = Number(b?.outcome);
        const label = Number.isInteger(i) ? (safeOutcomeLabel(outcomes[i]) || `Outcome ${i}`) : 'Unknown outcome';
        const rejected = !isAcceptedBet(b);
        const status = rejected ? 'Rejected' : (b?.bet_status ? String(b.bet_status).replace(/_/g, ' ') : '');
        // A thumb for a Yes or No bet, else the outcome's letter on its colour.
        const mark = outcomeMarkOf(outcomes, i);
        return {
            key: String(b?.action_index ?? b?.tx_hash),
            title: label,
            amount: withTick(b?.amount),
            icon: <OutcomeMark tone={mark.tone} letter={mark.letter} shape="round" />,
            meta: [
                ...(b?.source ? [{ key: 'source', text: String(b.source) }] : []),
                ...(ownAddresses.has(String(b?.source)) ? [{ key: 'mine', text: 'You', tone: 'mine' }] : []),
                { key: 'when', text: b?.timestamp ? fmtTime(b.timestamp) : `block ${String(b?.block_index ?? 'n/a')}` },
                ...(status ? [{ key: 'status', text: status, tone: rejected ? 'danger' : undefined }] : []),
            ],
        };
    };
    const recentBets = (Array.isArray(feedBets) ? feedBets : [])
        .slice()
        .sort((a, b) => Number(b?.action_index || 0) - Number(a?.action_index || 0));
    const betsPartialNote = feedBetsPartial ? (
        <p className={styles.hint}>
            {feedBetsTotal === null
                ? 'Not every position in this market could be read.'
                : `Only the most recent ${feedBets.length} of ${feedBetsTotal} positions could be read.`}
        </p>
    ) : null;
    // What this wallet currently holds on each outcome.
    const heldByOutcome = new Map();
    for (const b of myBets) {
        if (!isAcceptedBet(b) || (b?.bet_status && b.bet_status !== 'open')) continue;
        const i = Number(b?.outcome);
        const amountText = String(b?.amount ?? '').trim();
        if (!Number.isInteger(i) || !/^\d{1,47}(\.\d{1,18})?$/.test(amountText)) continue;
        heldByOutcome.set(i, sumDecimalStrings([heldByOutcome.get(i) || '0', amountText]));
    }
    const canBuyPositions = takingBets && outcomes.length > 0 && (addressesByChain?.[chainId] || [])
        .some((address) => String(address.address) !== String(feed.source));
    const positionPanel = (
        <section className={local.positionPanel} aria-label="Your position" data-testid="market-position-panel">
            <h2 className={local.positionTitle}>Your position</h2>
            {feedBets === null ? (
                <p className={local.positionQuiet}>Loading your position…</p>
            ) : feedBetsFailed ? (
                <p className={local.positionQuiet}>Your position could not be loaded.</p>
            ) : heldByOutcome.size > 0 ? (
                <ul className={local.positionList}>
                    {[...heldByOutcome.entries()].map(([i, held]) => {
                        const name = safeOutcomeLabel(outcomes[i]) || `Outcome ${i}`;
                        const currentShare = shareOf(i);
                        const payout = potentialPayout({
                            held,
                            total,
                            outcomePool: byOutcome[i]?.pool || '0',
                            feePct: feed.fee,
                            divisibility: stakeDivisibility,
                        });
                        return (
                            <li key={i} className={local.positionRow}>
                                <div className={local.positionValues}>
                                    <strong className={local.positionAmount}>{withTick(held)}</strong>
                                    <span className={local.positionOutcome}>{name}</span>
                                    {currentShare ? <span>Current share {currentShare}</span> : null}
                                    {payout !== null ? <span>Potential payout {withTick(payout)}</span> : null}
                                </div>
                                {canBuyPositions ? (
                                    <Button type="button" size="sm" variant="secondary" icon={<Icon.MarketIcon />} onClick={() => openPlaceBet(i)}>
                                        Buy More
                                    </Button>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <div className={local.positionEmpty}>
                    <p className={local.positionQuiet}>You have no position in this market</p>
                    {canBuyPositions ? (
                        <Button type="button" size="sm" variant="secondary" icon={<Icon.MarketIcon />} onClick={() => setTab('bet')}>
                            Buy
                        </Button>
                    ) : null}
                </div>
            )}
            {feedBetsPartial ? (
                <p className={local.positionQuiet}>Your position may be incomplete because not every market position could be read.</p>
            ) : null}
        </section>
    );

    // Details: the market's terms and facts, one per row, then its rules
    // stated plainly.
    const detailsPanel = (
        <>
            <OutcomeFacts
                label="Market details"
                rows={[
                    { key: 'closes', label: 'Purchases close', value: fmtTime(feed.deadline) },
                    { key: 'source', label: 'Resolution source', value: 'Reported by the market oracle' },
                    ...(feed.source ? [{
                        key: 'runBy',
                        label: 'Run by',
                        value: onOpenOracle ? (
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
                        ) : <span className={local.factAddress}>{feed.source}</span>,
                    }] : []),
                    { key: 'pool', label: 'Pool', value: withTick(total) },
                    { key: 'bets', label: 'Positions', value: String(betCount) },
                    ...(feed.min_amount ? [{ key: 'min', label: 'Minimum purchase', value: withTick(String(feed.min_amount)) }] : []),
                    { key: 'fee', label: 'Oracle fee', value: `${feed.fee ?? '0'}% of the pot` },
                    { key: 'refund', label: 'Refunds if unresolved by', value: fmtTime(feed.expire_at) },
                    { key: 'market', label: 'Market', value: `#${String(feed.action_index)}` },
                ]}
            />
            {/* The notes under the facts sit in the wallet's one notice card
                (G90: the license screen's padded card of plain lines), 8px
                under the details card. The three things that actually
                surprise people are stated plainly. Once the market is over
                the past-tense note sits under the final split on Result
                instead: "every later bet changes it" is advice for a decision
                nobody can still make. */}
            {(feed.allow_list || feed.block_list) || live ? (
                <WarningCard data-bet-details-note="">
                    {(feed.allow_list || feed.block_list) ? (
                        <WarningLine>
                            This market is restricted to a list of addresses. If you are blocked, your purchase is
                            rejected and nothing is taken from your balance.
                        </WarningLine>
                    ) : null}
                    {live ? (
                        <WarningLine data-bet-parimutuel-note="">
                            This is a parimutuel market: everyone backing the winning outcome shares the whole
                            pot, so the split is only how things stand right now and every later purchase
                            changes it. Purchases are final once confirmed, and payouts round down, so a very small
                            stake can win and still pay nothing.
                        </WarningLine>
                    ) : null}
                </WarningCard>
            ) : null}
        </>
    );

    // Result, once the market stops taking bets: what happened to it, the
    // split (final once settled, the winner marked), and what this wallet bet.
    let verdict = null;
    if (feed.feed_status === 'closed') {
        verdict = {
            title: 'Pending resolution',
            tone: 'info',
            testId: 'bet-settlement',
            body: resolveWindowOpen
                ? 'The market oracle must publish the winning outcome before the refund window ends. Payouts settle automatically when the result is recorded; participants do not submit a claim.'
                : 'The resolution window has ended. The protocol refunds every position automatically when the network records the expiry; participants do not submit a claim.',
            // The owner settles from this page's own Actions tab.
            action: resolveWindowOpen && ownsMarket && showsActions ? (
                <Button variant="primary" icon={<Icon.CheckIcon />} onClick={() => setTab('actions')}>Settle This Market</Button>
            ) : null,
        };
    } else if (feed.feed_status === 'resolved') {
        verdict = {
            title: `Winning outcome: ${winningLabel || 'recorded by the oracle'}`,
            tone: 'success',
            testId: 'bet-settlement',
            body: 'Winning positions settled as won and losing positions lost their purchase amounts. The protocol credited any payout automatically; participants have nothing to claim.',
        };
    } else if (feed.feed_status === 'resolved_void') {
        verdict = {
            title: `Market voided${winningLabel ? `: ${winningLabel} had no positions` : ''}`,
            tone: 'info',
            testId: 'bet-settlement',
            body: 'Every position was refunded automatically because nobody backed the reported winner. Participants have nothing to claim.',
        };
    } else if (feed.feed_status === 'cancelled' || feed.feed_status === 'expired') {
        verdict = {
            title: feed.feed_status === 'cancelled' ? 'All positions refunded' : 'Expired without a result',
            tone: 'info',
            testId: 'bet-settlement',
            body: 'The protocol refunded every position automatically. Participants have nothing to claim.',
        };
    }
    const splitRows = outcomes.map((label, i) => {
        const p = byOutcome[i] || { pool: 0, bet_count: 0 };
        const hasPot = compareDecimalStrings(total, '0') === 1;
        const percentText = hasPot
            ? roundDecimalString(divideDecimalStrings(multiplyDecimalStrings(p.pool || '0', '100'), total, 1), 1)
            : null;
        // (a): the pool is a DECIMAL(65,18) SUM, so it arrives with an
        // 18-place tail whatever the token's own decimals are. A market
        // denominated in a 0-decimal token read "300.000000000000000000".
        const bets = Number(p.bet_count || 0);
        return {
            key: i,
            label: `${i}: ${safeOutcomeLabel(label) || `Outcome ${i}`}`,
            sub: `Total in ${safeOutcomeLabel(label) || `Outcome ${i}`}: ${withTick(p.pool ?? 0)}, ${bets} position${bets === 1 ? '' : 's'}`,
            percent: percentText === null ? null : Number(percentText),
            // "no bets yet" only reads as true while betting can still
            // happen; on a market that is over it asserts that nobody ever
            // bet, which may be false and is never something this screen
            // can promise.
            value: percentText === null ? (live ? 'no positions yet' : 'no positions') : `${percentText}%`,
            winner: feed.feed_status === 'resolved' && winningOutcome === i,
        };
    });
    // "You bet ..." lines: this wallet's accepted bets on each side.
    const betByOutcome = new Map();
    for (const b of myBets) {
        if (!isAcceptedBet(b)) continue;
        const i = Number(b?.outcome);
        const amountText = String(b?.amount ?? '').trim();
        if (!Number.isInteger(i) || !/^\d{1,47}(\.\d{1,18})?$/.test(amountText)) continue;
        betByOutcome.set(i, sumDecimalStrings([betByOutcome.get(i) || '0', amountText]));
    }
    const youBet = feedBets === null ? (
        <p className={styles.hint}>Loading your positions…</p>
    ) : feedBetsFailed ? (
        <p className={styles.hint}>Your positions in this market could not be loaded.</p>
    ) : betByOutcome.size ? (
        [...betByOutcome.entries()].map(([i, staked]) => (
            <p key={i} className={local.heldLine} data-bet-you-bet="">
                <span className={local.heldIcon} aria-hidden="true"><Icon.CheckIcon /></span>
                <span>Your position: <strong>{withTick(staked)}</strong> on {safeOutcomeLabel(outcomes[i]) || `Outcome ${i}`}</span>
            </p>
        ))
    ) : (
        <p className={styles.hint}>No positions from this wallet.</p>
    );
    const resultPanel = (
        <OutcomeResult
            verdict={verdict}
            icon={<Icon.VerifyIcon />}
            title={live ? 'Current split' : 'Final split'}
            aside={t('components.outcomeDetailLayout.positionCount', { count: betCount })}
            rows={splitRows}
            winnerLabel="Winner"
            empty={<EmptyState title="No outcomes recorded" body="Settled market outcomes appear here." titleAs="p" />}
            footer={(
                <>
                    {youBet}
                    {!live && settledPartial ? (
                        <p className={styles.hint}>
                            {feedBetsTotal === null
                                ? 'The split above is incomplete because not every position could be read.'
                                : `The split above covers the most recent ${feedBets.length} of ${feedBetsTotal} positions rather than all of them.`}
                        </p>
                    ) : null}
                    {!live ? (
                        <p className={styles.hint}>
                            This was a parimutuel market: everyone backing the winning outcome shared the whole
                            pot. The split above is final, and payouts rounded down, so a very small stake could
                            win and still pay nothing.
                        </p>
                    ) : null}
                </>
            )}
        />
    );

    // The outcome choice, drawn once: the Bet tab and Place Bet's Bet section
    // both show it, and only one of them is on screen at a time.
    const outcomeControl = (
        <>
                    {/* The themed dropdown with an icon per option (G119), never a
                        segmented control: it reads the same for two outcomes or
                        ten. The tapped outcome arrives already chosen. */}
                    <IconSelect
                        id="bet-outcome"
                        label="Outcome"
                        help="Pick the result you think will happen. Everyone backing the winning outcome splits the whole pot, minus the oracle's fee."
                        value={outcome === null ? '' : String(outcome)}
                        disabled={submitting || actionConfirm.composing}
                        onChange={(next) => { setOutcome(Number(next)); setFormError(null); }}
                        options={outcomes.map((label, i) => ({
                            value: String(i),
                            label: safeOutcomeLabel(label) || `Outcome ${i}`,
                            icon: iconFor(label, i),
                            sub: shareOf(i) ? `${shareOf(i)} of the pool` : undefined,
                        }))}
                    />
        </>
    );

    // Stake, the quick amounts and the projected payout: Place Bet's Bet
    // section, under the outcome.
    const stakeFields = (
        <>
                    <AmountField
                        id="bet-stake"
                        label="Amount"
                        help="How much of this outcome to buy. The amount buys a share of the pot that every later purchase re-divides, and payouts round down. Once confirmed, a position cannot be cancelled or moved to another outcome."
                        amount={amount}
                        disabled={submitting || actionConfirm.composing}
                        tick={feed.tick || ''}
                        divisibility={stakeDivisibility}
                        onAmountFieldChange={(rawValue) => {
                            setAmount(String(rawValue).replace(/,/g, ''));
                            setFormError(null);
                        }}
                        onValidationError={(fieldError) => {
                            setAmountPrecisionError(fieldError?.startsWith('Enter a valid decimal amount')
                                ? 'Enter a positive position amount using digits and an optional decimal point.'
                                : fieldError);
                        }}
                        onMax={stakeBalance !== null
                            ? () => {
                                setAmount(stakeBalance);
                                setFormError(null);
                                formErrors.clear('bet-stake');
                            }
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
                                    disabled={submitting || actionConfirm.composing}
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
                                later purchase moves it, in either direction.
                            </p>
                        </div>
                    ) : null}
        </>
    );

    // What this wallet holds on each side, under the outcome list.
    const heldLine = heldByOutcome.size > 0 ? (
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
    ) : null;

    // The Bet tab. Hidden outright when it could only produce a rejected
    // transaction: a closed market takes no bets, and the feed's own source
    // may not bet on its own market (§6 format 2). Showing a doomed form and
    // letting the chain refuse it would cost the user a fee for nothing.
    // Otherwise it holds one list card with every outcome as a row (its mark,
    // name, amount staked, chance and a fill for its share of the pool);
    // tapping a row opens the Place Bet step with that outcome carried
    // (operator rulings 2026-11-13: no pick list, no separate Bet button, and
    // the outcomes as one list for any number of them). A market that stops
    // taking bets swaps this tab for Result, so a closed market never offers it.
    //
    // Each row's chance is a whole percent and its fill the exact share; a
    // market with nothing staked yet shows no chance at all.
    const hasPool = compareDecimalStrings(total, '0') === 1;
    const outcomeOptions = outcomes.map((label, i) => {
        const name = safeOutcomeLabel(label) || `Outcome ${i}`;
        const staked = `${withTick(byOutcome[i]?.pool || '0')} total`;
        const exact = hasPool
            ? Number(divideDecimalStrings(multiplyDecimalStrings(byOutcome[i]?.pool || '0', '100'), total, 4))
            : null;
        const percent = exact !== null && Number.isFinite(exact) ? exact : null;
        const whole = percent === null ? null : Math.round(percent);
        return {
            key: i,
            label: name,
            mark: outcomeMarkOf(outcomes, i),
            staked,
            chance: whole === null ? null : `${whole}%`,
            percent,
            name: whole === null ? `Buy ${name}, ${staked}` : `Buy ${name}, ${whole} percent, ${staked}`,
            disabled: !fromAddress,
            onSelect: () => openPlaceBet(i),
        };
    });
    const betPanel = fromAddress && feed.source === fromAddress.address ? (
        <>
            {/* The From field stays here, so a wallet can switch to an
                address that does not run this market. */}
            {fromField}
            <p className={styles.hint}>
                You run this market, so you cannot buy a position in it. That rule exists because an oracle
                who could buy its own outcome would decide the result.
            </p>
        </>
    ) : (
        <div className={local.betPanel} data-bet-panel="">
            <OutcomeList label="Outcome to back" options={outcomeOptions} />
            {outcomes.length === 0 ? (
                <p className={styles.hint} data-bet-no-outcomes="">This market lists no outcomes, so there is nothing to buy.</p>
            ) : addressesByChain && !fromAddress ? (
                // The outcome rows stay disabled with no address here, so the page says why.
                <p className={styles.hint} data-bet-no-address="">No address on this network. Use Receive to generate one, then buy a position.</p>
            ) : null}
            {/* No tap hint under the rows: the chevron rows say it. Carried over
                from the operator's ruling on the poll Vote tab (2026-11-15);
                the bet page itself is awaiting the operator's look. */}
            <FormStatusSlot status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null} />
            {heldLine}
        </div>
    );

    // The owner Actions tab (operator ruling 2026-11-13, moved here from My
    // markets): the timing line, then one action list (G101): Post result
    // first while the result window is open, then Cancel and refund (danger),
    // Edit lists and Copy to a new market, each only where the chain accepts
    // it. A row opens the same inline form the console uses.
    let actionsPanel = null;
    if (showsActions) {
        const timing = oracleTimingText(ownerFeed, oracle.nowSec, { waiting: true });
        const openMode = oracle.active && String(oracle.active.action_index) === String(feed.action_index)
            ? oracle.active.mode
            : null;
        actionsPanel = (
            <OutcomeOwnerActions
                label="Market actions"
                notes={timing ? (
                    <WarningCard data-bet-owner-timing="">
                        <WarningLine>{timing}</WarningLine>
                    </WarningCard>
                ) : null}
                // A demo wallet's press answers with the refusal here (it is
                // null until an action is pressed), beside any action error.
                status={oracle.formError || demoGuard.note ? (
                    <>
                        {demoGuard.note}
                        {oracle.formError ? <StatusMessage variant="error">{oracle.formError}</StatusMessage> : null}
                    </>
                ) : null}
                items={[
                    // The owner's main job leads the list; it opens a form.
                    ...(legality.canResolve ? [{
                        id: 'resolve',
                        title: 'Post result',
                        description: 'Publish the winning outcome so the market pays out',
                        icon: <Icon.CheckIcon />,
                        open: openMode === 'resolve',
                        onClick: () => oracle.begin(ownerFeed, 'resolve'),
                    }] : []),
                    ...(legality.canCancel ? [{
                        id: 'cancel',
                        title: 'Cancel and refund',
                        description: 'End the market and refund every position',
                        icon: <Icon.XIcon />,
                        tone: 'danger',
                        open: openMode === 'cancel',
                        onClick: () => oracle.begin(ownerFeed, 'cancel'),
                    }] : []),
                    ...(legality.canEdit ? [{
                        id: 'edit',
                        title: 'Edit lists',
                        description: 'Change the allow and block lists for participants',
                        icon: <Icon.PencilIcon />,
                        open: openMode === 'edit',
                        onClick: () => oracle.begin(ownerFeed, 'edit'),
                    }] : []),
                    // Terms stay immutable; this copies them into a new market.
                    ...(onDuplicate ? [{
                        id: 'copy',
                        title: 'Copy to a new market',
                        description: 'Start a new market from these terms',
                        icon: <Icon.CopyIcon />,
                        onClick: () => onDuplicate(chainId, feed.action_index),
                    }] : []),
                ]}
            >
                {oracle.renderForm(ownerFeed)}
            </OutcomeOwnerActions>
        );
    }

    // Activity is only the market's bet rows, newest first: no title, summary
    // or status-history footer (operator ruling 2026-11-13). The loading,
    // error and empty states and the truncated-read note stay, since they say
    // what the list is missing.
    const activityPanel = (
        <>
            {feedBets === null ? <p className={styles.hint}>Loading positions…</p> : null}
            {feedBetsFailed ? <StatusMessage variant="error">Could not load this market's positions.</StatusMessage> : null}
            {feedBets !== null && !feedBetsFailed && recentBets.length === 0 ? (
                betCount > 0 ? (
                    // The pools count bets the bet read did not list, so the
                    // empty list says that instead of claiming none exist.
                    <EmptyState title="No position rows returned" body={`The market counts ${betCount} position${betCount === 1 ? '' : 's'}, but the explorer listed none of them.`} titleAs="p" />
                ) : (
                    <EmptyState title={live ? 'No positions yet' : 'No positions'} body="Positions in this market appear here as they are bought." titleAs="p" />
                )
            ) : null}
            {recentBets.length > 0 ? <OutcomeActivity rows={recentBets.map(betActivityRow)} /> : null}
            {betsPartialNote}
        </>
    );

    // The section each Place Bet error belongs to, so it reopens on each press.
    const errorSection = (() => {
        if (!formError) return null;
        if (/address/i.test(formError)) return 'from';
        if (/^Memo/i.test(formError)) return 'memo';
        return 'bet';
    })();
    const sectionErrorKey = (id) => (errorSection && (errorSection === id || id === 'bet') ? validationAttempt + 1 : 0);

    // Place Bet, its own step: the Form Standard form (From, the bet, Memo,
    // Network fee, Place Bet) that leads to the shared confirm screen.
    if (showPlace && showsBetForm) {
        const chosenOutcome = outcome === null ? null : (safeOutcomeLabel(outcomes[outcome]) || `Outcome ${outcome}`);
        const stakeText = String(amount).trim() ? `${formatWithThousands(String(amount).trim())}${tick ? ` ${tick}` : ''}` : null;
        const placeForm = (
            <FormFrame
                    demoGuard={demoGuard}
                    label="Buy a position"
                    onSubmit={handlePlaceBet}
                    errors={formErrors}
                    status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
                    action={(
                        // Full width, a bolt icon, no ticker in the label.
                        <FormAction
                            icon={isWatcherMode ? <Icon.PlusIcon /> : <Icon.ZapIcon />}
                            loading={submitting || actionConfirm.composing}
                        >
                            {actionConfirm.composing
                                ? 'Preparing Review…'
                                : isWatcherMode ? 'Create Unsigned Transaction' : chosenOutcome ? `Buy ${chosenOutcome}` : 'Buy'}
                        </FormAction>
                    )}
                    from={(
                        <FromSection
                            {...sections.bind('from')}
                            chainId={chainId}
                            chainRegistry={chainRegistry}
                            lockNetwork
                            networkHelp="The market fixes the network: positions are bought with its token on this chain."
                            address={fromAddress?.address || null}
                            addressId="bet-from-address"
                            formErrorKey="bet-from-address"
                            onOpenPicker={() => setSourcePickerOpen(true)}
                            pickerLabel="Choose source address"
                            addressHelp="The address that buys this position and receives any payout. It must hold the purchase amount in this market's token, and it cannot be the address that runs the market."
                            missing={addressesByChain ? (
                                <p className={styles.hint}>No address on this network. Use Receive to generate one, then buy a position.</p>
                            ) : null}
                            revealKey={sectionErrorKey('from')}
                        />
                    )}
                    fee={(
                        <FeeSection
                            {...sections.bind('fee')}
                            chainId={chainId}
                            coinTicker={coinTicker}
                            tiers={feeTiers}
                            value={feePick}
                            onChange={(next) => { setFeePick(next); setFormError(null); }}
                            customEstimate={feeCustomEstimate}
                            fees={{
                                quote: protocolFeeQuote,
                                pending: protocolFeePending,
                                nativeFeeProps: nativeFee.toggleProps,
                            }}
                            revealKey={sectionErrorKey('fee')}
                        />
                    )}
                >
                    {/* The bet: the market's question, the outcome (changeable
                        here), then the stake. */}
                    <FormSection
                        id="bet"
                        title="Buy"
                        icon={Icon.ZapIcon}
                        {...sections.bind('bet')}
                        revealKey={sectionErrorKey('bet')}
                        summary={joinSummary(chosenOutcome, stakeText) || null}
                    >
                        <p className={styles.hint}>{neutralizeControlText(feed.label, { maxLength: 250 }) || '(untitled market)'}</p>
                        {outcomeControl}
                        {stakeFields}
                    </FormSection>
                    {/* An optional section holding only the memo: its title
                        names the field and carries its count. */}
                    <MemoSection
                        inputId="bet-memo"
                        {...sections.bind('memo')}
                        revealKey={sectionErrorKey('memo')}
                        maxLength={MAX_MEMO_LENGTH}
                        value={memo}
                        disabled={submitting || actionConfirm.composing}
                        onChange={(e) => setMemo(e.target.value)}
                    />
            </FormFrame>
        );
        return embedded ? placeForm : standalone(placeForm);
    }

    // The shared outcome page: the blue hero, the tab strip, the chosen tab.
    return wrap(
        <>
            <OutcomeDetailLayout
                hero={(
                    <>
                        <BetMarketHero
                            feed={feed}
                            outcomes={outcomes}
                            pools={pools}
                            total={total}
                            betCount={betCount}
                            bets={feedBets}
                            live={live}
                        />
                        {positionPanel}
                    </>
                )}
                tabs={tabItems}
                tab={tab}
                onTabChange={setTab}
                tabsLabel="Market sections"
                panels={{
                    bet: takingBets ? betPanel : null,
                    result: takingBets ? null : resultPanel,
                    actions: actionsPanel,
                    activity: activityPanel,
                    details: detailsPanel,
                }}
            />
            {demoGuard.dialog}
        </>,
        pageNotices,
    );
}
