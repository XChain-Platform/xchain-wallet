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
import { AddressField, Button, Input, NetworkField, PageHeader, Screen, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { BET_CHAIN_IDS } from './BetFeedsList.jsx';
import styles from './IssueTokenForm.module.css';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

// Mirrors the SDK's BET_LIMITS for form-level pre-checks only. The SDK builder
// is the authoritative validator (it runs host-side inside composeForConfirm);
// these exist so a user is told about a too-long label before a compose round
// trip, not so the wallet can decide what the protocol accepts.
const MAX_LABEL = 250;
const MAX_OUTCOMES = 16;
const MAX_OUTCOME_LABEL = 64;
const MAX_FEE_PCT = 10;

// Refund window presets, in seconds. This is how long after betting closes the
// oracle still has to publish a result; past it, the chain refunds everyone.
// 14 days is the protocol default (Counterparty parity).
const WINDOW_PRESETS = [
    { value: '86400', label: '1 day' },
    { value: '259200', label: '3 days' },
    { value: '604800', label: '7 days' },
    { value: '1209600', label: '14 days (default)' },
    { value: '2592000', label: '30 days' },
    { value: '7776000', label: '90 days' },
    { value: '31536000', label: '1 year' },
    { value: 'custom', label: 'Custom' },
];

// datetime-local string -> Unix seconds. DEADLINE is a wall-clock Unix
// timestamp compared against the block time, not a block height.
function localInputToUnix(localStr) {
    const ms = Date.parse(String(localStr));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

function unwrap(resp) {
    if (!resp) return null;
    if (Array.isArray(resp)) return resp[0] || null;
    if (Array.isArray(resp.data)) return resp.data[0] || null;
    if (resp.data && typeof resp.data === 'object') return resp.data;
    return resp;
}

// Outcome labels ride the wire inside a comma-joined, pipe-delimited field, so
// these three characters would break the encoding. Control characters are
// rejected for the same reason the indexer rejects them: they render as nothing,
// which hides the difference between two labels that look identical.
// eslint-disable-next-line no-control-regex
const OUTCOME_BAD_CHARS = /[,|;]|[\u0000-\u001f]/;

/**
 * BET v0: open a betting market (a "feed") as its oracle.
 *
 * Two things about this form are load-bearing rather than decorative:
 *
 * 1. The market's cost is shown LIVE as the dates move. Creation is
 *    duration-priced over the market's whole pass-eligible life, which ends at
 *    the refund deadline, NOT at the betting deadline. A user reads the refund
 *    window as a safety margin rather than a price, so lengthening only that
 *    field is exactly what can push a free market into a charged one. The quote
 *    comes from the SDK's own arithmetic over the host (half-up day count
 *    included), because a projection that floored would under-quote by a whole
 *    day's fee at every fractional-day boundary.
 * 2. OUTCOMES and the DETAILS description are composed from ONE source, so they
 *    cannot disagree. The indexer rejects a create whose DETAILS `outcomes`
 *    differ from the consensus OUTCOMES field, and a form that let a user edit
 *    them separately would produce rejections nobody could explain.
 *
 * Markets are immutable once created: there is no edit action, by design. The
 * fix path for a mistake caught before anyone bets is cancel and recreate, which
 * `duplicateFeedIndex` pre-populates.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} [props.presetTick]
 * @param {string | number} [props.duplicateFeedIndex]  copy terms from this market (cancel + recreate)
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCreated]
 */
export function CreateBetFeedForm({
    walletId, chainId: initialChainId, presetTick, duplicateFeedIndex, onBack, onCreated,
}) {
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    const [tick, setTick] = useState(presetTick || '');
    const [label, setLabel] = useState('');
    const [outcomes, setOutcomes] = useState(['', '']);
    const [deadlineInput, setDeadlineInput] = useState('');
    const [windowPreset, setWindowPreset] = useState('1209600');
    const [windowCustomDays, setWindowCustomDays] = useState('14');
    const [feePct, setFeePct] = useState('');
    const [minAmount, setMinAmount] = useState('');

    const [showDetails, setShowDetails] = useState(false);
    const [description, setDescription] = useState('');
    const [resolutionCriteria, setResolutionCriteria] = useState('');
    const [source, setSource] = useState('');
    const [category, setCategory] = useState('');
    const [outcomeNotes, setOutcomeNotes] = useState(['', '']);

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [allowList, setAllowList] = useState('');
    const [blockList, setBlockList] = useState('');
    const [memo, setMemo] = useState('');

    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any} */ (null));
    const [duplicated, setDuplicated] = useState(false);

    // A stable "now" for the cost quote. Refreshed slowly on purpose: the quote
    // is day-granular, and a per-second clock would make the figure jitter while
    // the user is reading it.
    const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
    useEffect(() => {
        const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) { setLoadError('No address on this chain. Use Receive to generate one first.'); return; }
                setLoadError(null);
                setFromAddressId(sourceId);
            })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.'); });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    // Cancel + recreate: copy the terms of an existing market, leaving the dates
    // for the user to re-pick (the old deadline is usually in the past, and a
    // silently stale one would just reject).
    useEffect(() => {
        let cancelled = false;
        if (duplicateFeedIndex === undefined || duplicateFeedIndex === null) return undefined;
        if (typeof messaging.betFeed !== 'function') return undefined;
        messaging.betFeed({ chainId, feedIndex: duplicateFeedIndex })
            .then((resp) => {
                const feed = unwrap(resp);
                if (cancelled || !feed) return;
                const labels = Array.isArray(feed.outcome_labels)
                    ? feed.outcome_labels
                    : (typeof feed.outcomes === 'string' ? feed.outcomes.split(',') : []);
                if (feed.label) setLabel(String(feed.label));
                if (feed.tick) setTick(String(feed.tick));
                if (labels.length >= 2) {
                    setOutcomes(labels.map((l) => String(l)));
                    setOutcomeNotes(labels.map(() => ''));
                }
                if (feed.fee !== undefined && feed.fee !== null && String(feed.fee) !== '0') setFeePct(String(feed.fee));
                if (feed.min_amount) setMinAmount(String(feed.min_amount));
                if (feed.allow_list) setAllowList(String(feed.allow_list));
                if (feed.block_list) setBlockList(String(feed.block_list));
                const rw = Number(feed.refund_window);
                if (Number.isFinite(rw) && rw > 0) {
                    if (WINDOW_PRESETS.some((p) => p.value === String(rw))) {
                        setWindowPreset(String(rw));
                    } else {
                        setWindowPreset('custom');
                        setWindowCustomDays(String(rw / 86400));
                    }
                }
                setDuplicated(true);
            })
            .catch(() => { /* best effort: an unreadable source market just means an empty form */ });
        return () => { cancelled = true; };
    }, [duplicateFeedIndex, chainId, messaging]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // : opening a market is fee-bearing (BET v0 is duration-priced over the
    // market's full life), so it needs the same fee lane every other fee-bearing
    // form has. On LTC/DOGE the hook forces it on, because a native-coin output
    // is the only way to pay a protocol fee there: without it the create is
    // broadcast, the miner fee is spent, and the market never exists.
    const coinTicker = protocolCoinTickerFor(descriptor || chainId);
    const nativeFee = useNativeFee(chainId);

    const cleanOutcomes = useMemo(
        () => outcomes.map((o) => o.trim()).filter((o) => o.length > 0),
        [outcomes],
    );
    const deadlineUnix = useMemo(() => localInputToUnix(deadlineInput), [deadlineInput]);
    const refundSeconds = useMemo(() => {
        if (windowPreset !== 'custom') return Number(windowPreset);
        const days = Number(String(windowCustomDays).trim());
        if (!Number.isFinite(days) || days <= 0) return null;
        return Math.round(days * 86400);
    }, [windowPreset, windowCustomDays]);

    function setOutcomeAt(i, value) {
        setOutcomes((prev) => prev.map((o, idx) => (idx === i ? value : o)));
    }
    function setOutcomeNoteAt(i, value) {
        setOutcomeNotes((prev) => {
            const next = prev.slice();
            while (next.length < outcomes.length) next.push('');
            next[i] = value;
            return next;
        });
    }
    function addOutcome() {
        if (outcomes.length >= MAX_OUTCOMES) return;
        setOutcomes((prev) => [...prev, '']);
        setOutcomeNotes((prev) => [...prev, '']);
    }
    function removeOutcome(i) {
        if (outcomes.length <= 2) return;
        setOutcomes((prev) => prev.filter((_o, idx) => idx !== i));
        setOutcomeNotes((prev) => prev.filter((_o, idx) => idx !== i));
    }

    // DETAILS is attached only when it would carry something LABEL does not.
    // A details blob holding nothing but a copy of the label is pure wire weight,
    // and the whole compiled ACTION shares one size ceiling with OUTCOMES.
    const detailsObject = useMemo(() => {
        const notes = outcomeNotes.slice(0, cleanOutcomes.length);
        const hasNotes = notes.some((n) => String(n || '').trim().length > 0);
        const extras = [description, resolutionCriteria, source, category]
            .some((v) => String(v || '').trim().length > 0);
        if (!extras && !hasNotes) return undefined;
        const d = { title: label.trim() };
        if (description.trim()) d.description = description.trim();
        if (resolutionCriteria.trim()) d.resolution_criteria = resolutionCriteria.trim();
        if (source.trim()) d.source = source.trim();
        if (category.trim()) d.category = category.trim();
        // One entry per outcome or none: a short array renders against the wrong
        // outcome, so pad rather than send a mismatched length.
        if (hasNotes) {
            d.outcome_details = cleanOutcomes.map((_o, i) => String(notes[i] || '').trim());
        }
        return d;
    }, [label, description, resolutionCriteria, source, category, outcomeNotes, cleanOutcomes]);

    // The UI-level params for sdk.betting.createMarketParams, derived in ONE
    // place so the object handed to compose is the object handed to submit. Two
    // derivations could diverge, and the divergence would be signed rather than
    // caught (the tamper check verifies the PSBT against the params the encoder
    // was handed, not against the form).
    const marketParams = useMemo(() => {
        const p = {
            label: label.trim(),
            outcomes: cleanOutcomes,
            tick: tick.trim(),
        };
        if (deadlineUnix) p.deadline = deadlineUnix;
        if (refundSeconds) p.refundWindow = refundSeconds;
        if (feePct.trim()) p.fee = feePct.trim();
        if (minAmount.trim()) p.minAmount = minAmount.trim();
        if (allowList.trim()) p.allowList = allowList.trim();
        if (blockList.trim()) p.blockList = blockList.trim();
        if (memo.trim()) p.memo = memo.trim();
        if (detailsObject) p.details = detailsObject;
        return p;
    }, [label, cleanOutcomes, tick, deadlineUnix, refundSeconds, feePct, minAmount, allowList, blockList, memo, detailsObject]);

    // Live cost quote. Keyed on the REFUND deadline, which is what the protocol
    // charges for, so the figure moves when the refund window moves.
    const [quote, setQuote] = useState(/** @type {any} */ (null));
    const [quoteError, setQuoteError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        setQuote(null);
        setQuoteError(null);
        if (!deadlineUnix || !refundSeconds) return undefined;
        if (typeof messaging.betProjectFeedCreateFee !== 'function') return undefined;
        messaging.betProjectFeedCreateFee({
            chainId, deadline: deadlineUnix, refundWindow: refundSeconds, blockTime: nowSec,
        })
            .then((q) => { if (!cancelled) setQuote(q || null); })
            .catch((err) => { if (!cancelled) setQuoteError(err?.message || 'Cost unavailable.'); });
        return () => { cancelled = true; };
    }, [chainId, deadlineUnix, refundSeconds, nowSec, messaging]);

    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // A real ref, not `{ current: password }`: Approve runs from the closure
    // captured when the confirm page OPENED, which is before the password on that
    // page has been typed. A fresh object per render leaves that closure holding
    // the empty string, so the submit fails as a wrong password.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'createMarketAction',
        hardware: 'createMarketActionHw',
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

    // Cheap pre-checks only, phrased for a person. The SDK builder repeats all of
    // them host-side and is the authority; this just avoids a compose round trip
    // to learn that an outcome label has a comma in it.
    function validate() {
        if (!fromAddress) return 'No address on this chain to create a market from.';
        if (!label.trim()) return 'Give the market a question or title.';
        if (label.trim().length > MAX_LABEL) return `The title is ${label.trim().length} characters; the limit is ${MAX_LABEL}.`;
        if (!tick.trim()) return 'Choose the token bets are placed in. Betting is token-only: the chain coin cannot be wagered.';
        if (cleanOutcomes.length < 2) return 'A market needs at least two outcomes.';
        if (cleanOutcomes.length > MAX_OUTCOMES) return `A market can have at most ${MAX_OUTCOMES} outcomes.`;
        if (cleanOutcomes.some((o) => o.length > MAX_OUTCOME_LABEL)) return `Each outcome label must be ${MAX_OUTCOME_LABEL} characters or fewer.`;
        if (cleanOutcomes.some((o) => OUTCOME_BAD_CHARS.test(o))) return 'Outcome labels cannot contain a comma, a semicolon or a vertical bar.';
        if (new Set(cleanOutcomes).size !== cleanOutcomes.length) return 'Two outcomes have the same label. Each one must be distinct.';
        if (!deadlineUnix) return 'Pick when betting closes.';
        if (deadlineUnix <= nowSec) return 'Betting must close in the future.';
        if (!refundSeconds) return 'Set how long you have to publish the result.';
        if (feePct.trim()) {
            if (!/^\d+(\.\d{1,2})?$/.test(feePct.trim())) return 'Your fee must be a number with at most two decimal places, as a percent of the pot.';
            if (Number(feePct.trim()) > MAX_FEE_PCT) return `Your fee cannot exceed ${MAX_FEE_PCT}% of the pot.`;
        }
        if (minAmount.trim() && !(/^\d+(\.\d+)?$/.test(minAmount.trim()) && Number(minAmount.trim()) > 0)) {
            return 'The minimum bet must be a positive amount.';
        }
        if (allowList.trim() && !/^\d+$/.test(allowList.trim())) return 'The allowed-addresses list must be a list number.';
        if (blockList.trim() && !/^\d+$/.test(blockList.trim())) return 'The blocked-addresses list must be a list number.';
        if (allowList.trim() && allowList.trim() === blockList.trim()) {
            return 'The same list is set as both allowed and blocked, so nobody could ever bet. Pick one.';
        }
        return null;
    }

    // Composes through the SDK's own createMarketParams builder HOST-side. A
    // client-side wire mirror would be SIGNED rather than caught: BET's four
    // formats differ by one field, and a create with DETAILS is the longest of
    // them, so the mirror is where drift would hide.
    async function submit(event) {
        event?.preventDefault?.();
        const problem = validate();
        if (problem) { setFormError(problem); return; }
        setFormError(null);
        const from = sourceDescriptor();
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                compose: () => messaging.composeBetForConfirm({
                    walletId, chainId, from, builder: 'createMarketParams', params: marketParams,
                    // The fee mode must reach COMPOSE, not just submit: the
                    // FEE_DESTINATION output has to be inside the PSBT the user
                    // approves and the tamper check verifies.
                    payFeeInNativeCoin: nativeFee.flag,
                }),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId, chainId, from, params: marketParams, prebuiltPsbt,
                    payFeeInNativeCoin: nativeFee.flag,
                }),
            });
            setResult(res);
            setPassword('');
        } catch (err) {
            if (isUserRejection(err)) return;
            // Through the shared mapper : this form's own validation
            // catches a blank label or tick, but the SDK builder is the last
            // word on the wire rules, and its refusals reached the user as log
            // lines - "betting.createBetFeedParams: ..." (D-118).
            setFormError(submitFailureMessage(err, {
                coinTicker, mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Creating the market failed.',
            }));
        }
    }

    const header = <PageHeader onBack={onBack} title="Open a market" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Oracle address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Token bets are placed in"
                networkFilter={coinFromChainId(chainId)}
                // : BET escrows a TOKEN. The native coin is not a legal
                // wager (the indexer answers `invalid: TICK (unknown)`), so
                // offering it walked a wallet holding only BTC into composing a
                // whole market that could never index. Proven on the regtest
                // venue in wallet E2E session 20, then re-run with XCHAIN,
                // which produced market #1160.
                kindFilter="tokens"
                kindLocked
                onSelect={(sel) => { setTick(String(sel.tick || '').toUpperCase()); setTokenPickerOpen(false); }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // Creating a market means signing, so watcher mode has nothing to offer here.
    // Said plainly rather than shown as a form that cannot be submitted.
    if (isWatcherMode) {
        return wrap(
            <>
                <p className={styles.hint}>
                    This wallet is in watcher mode, so it cannot open a market. Opening one commits you
                    to publishing the result, which needs the key that will later resolve it.
                </p>
            </>,
        );
    }

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            </>,
        );
    }
    if (!addressesByChain) return wrap(<p>Loading addresses…</p>);

    if (result) {
        const txid = result?.txid || result?.tx_hash;
        // : a queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<QueuedResultPanel onDone={onBack} />);
        return wrap(
            <>
                <p className={styles.summary}>
                    Market submitted. Once the network records it, anyone holding {tick} can bet on it,
                    and it is yours to resolve after betting closes.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'n/a')}</dd>
                </dl>
                <p className={styles.hint}>
                    The terms you just set are permanent: a market cannot be edited. If something is
                    wrong, cancel it (everyone is refunded) and open a new one.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onCreated || onBack}>Done</Button>
                </div>
            </>,
        );
    }

    const quoteBlock = (() => {
        if (quoteError) return <p className={styles.hint}>Cost estimate unavailable: {quoteError}</p>;
        if (!deadlineUnix || !refundSeconds) {
            return (
                <p className={styles.hint}>
                    Pick a closing time to see what this market costs. Short markets are free.
                </p>
            );
        }
        if (!quote) return <p className={styles.hint}>Working out the cost…</p>;
        const days = Number(quote.days || 0);
        const billableDays = Number(quote.billableDays || 0);
        const freeDays = days - billableDays;
        // (b): a one-day market read "about 1 days". The counts here are
        // computed, so any of them can land on 1.
        const dayWord = (n) => `${n} day${n === 1 ? '' : 's'}`;
        if (quote.free) {
            return (
                <p className={styles.hint}>
                    <strong>Opening this market is free.</strong> It stays on the network for
                    about {dayWord(days)}, and the first {dayWord(freeDays)} of any market cost nothing.
                </p>
            );
        }
        return (
            <p className={styles.hint}>
                <strong>Opening this market costs about {quote.fee} XCHAIN.</strong>
                {/* The schedule prices every chain in XCHAIN; paying in the coin
                    converts that figure at the current rate, so the quote is the
                    same number either way and only the settlement lane differs. */}
                {nativeFee.payFeeInNativeCoin && coinTicker
                    ? ` It is charged as the equivalent in ${coinTicker} at the rate when you submit.`
                    : ''}
                {' '}It stays on the network for
                about {dayWord(days)}: {freeDays} of those {freeDays === 1 ? 'is' : 'are'} free
                and {billableDays} {billableDays === 1 ? 'is' : 'are'} charged.
                {' '}The charge is measured to the refund deadline, not to when betting closes, so a longer
                window to publish the result costs more.
            </p>
        );
    })();

    return wrap(
        <form onSubmit={submit} noValidate>
            {duplicated ? (
                <p className={styles.hint}>
                    Copied from market #{String(duplicateFeedIndex)}. Pick new dates, then check the terms:
                    the copy is a brand new market, and opening it pays the cost below again. Cancelling a
                    market does not refund what it cost to open.
                </p>
            ) : null}

            <NetworkField
                value={chainId}
                onChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
                chainIds={(addressesByChain ? Object.keys(addressesByChain) : [chainId])
                    .filter((cid) => BET_CHAIN_IDS.length === 0 || BET_CHAIN_IDS.includes(cid))}
                chainRegistry={chainRegistry}
            />
            {fromAddress ? (
                <AddressField
                    label="Your oracle address"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose oracle address"
                />
            ) : null}
            <p className={styles.hint}>
                This address IS the market: it is the only one that can publish the result or cancel,
                it collects your fee, and its record as an oracle is public. It also cannot bet on its
                own market, because an oracle who could bet on the result would decide the result.
            </p>

            <TokenField
                label="Token bets are placed in"
                value={tick && chainId ? { chainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />

            <Input
                label="What is being bet on"
                hint="The question in one line, e.g. 'Which team wins the final on 12 August?'"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoComplete="off"
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span className={styles.fromLabel}>Possible outcomes</span>
                {outcomes.map((o, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                            <Input
                                label={`Outcome ${i}`}
                                value={o}
                                onChange={(e) => setOutcomeAt(i, e.target.value)}
                                autoComplete="off"
                            />
                        </div>
                        {outcomes.length > 2 ? (
                            <Button type="button" variant="ghost" onClick={() => removeOutcome(i)}>Remove</Button>
                        ) : null}
                    </div>
                ))}
                {outcomes.length < MAX_OUTCOMES ? (
                    <Button type="button" variant="ghost" onClick={addOutcome}>Add outcome</Button>
                ) : null}
                <span className={styles.hint}>
                    Exactly one of these can win. Whoever backed it splits the whole pot; if nobody backed
                    it, everyone is refunded and you earn nothing.
                </span>
            </div>

            <Input
                label="Betting closes"
                type="datetime-local"
                hint="Set this comfortably BEFORE the event starts. Block timestamps can lag real time by up to about two hours, so a deadline set too close lets late information be bet on."
                value={deadlineInput}
                onChange={(e) => setDeadlineInput(e.target.value)}
            />

            <Select
                label="Time to publish the result"
                value={windowPreset}
                onChange={(e) => setWindowPreset(e.target.value)}
                hint="After betting closes you have this long to publish the winning outcome. Miss it and the network refunds every bet automatically, and you earn nothing."
            >
                {WINDOW_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            {windowPreset === 'custom' ? (
                <Input
                    label="Days to publish the result"
                    hint="At least an hour (0.05 days) and at most a year."
                    value={windowCustomDays}
                    onChange={(e) => setWindowCustomDays(e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                />
            ) : null}

            {quoteBlock}

            {/* : this form is the one that already quotes its own fee, so
                the row states the real answer instead of the chain's rule. Most
                markets are free (the first 90 days cost nothing), and on LTC the
                row used to promise a coin payment for every one of them. */}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} fee={quote} />

            <Input
                label="Your fee (optional)"
                hint={`Your cut of the pot as a percent, e.g. 1.5 for 1.5%. Up to ${MAX_FEE_PCT}%. Taken only when you publish a result; a cancelled, void or expired market pays you nothing.`}
                value={feePct}
                onChange={(e) => setFeePct(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />

            <Input
                label="Smallest bet allowed (optional)"
                hint="Leave empty for no minimum. Useful because payouts round down: a tiny stake can win and still pay nothing."
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />

            <Button type="button" variant="ghost" onClick={() => setShowDetails((v) => !v)}>
                {showDetails ? 'Hide market description' : 'Add a description and settlement rules'}
            </Button>
            {showDetails ? (
                <>
                    <p className={styles.hint}>
                        This rides on the chain with the market, so bettors and every explorer see the same
                        text. Write the settlement rule you will actually follow: it is what people will hold
                        you to, and you cannot change it later.
                    </p>
                    <Textarea
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                    />
                    <Textarea
                        label="How the result will be decided"
                        hint="The rule you follow, including what happens in an edge case such as a postponement or a tie."
                        value={resolutionCriteria}
                        onChange={(e) => setResolutionCriteria(e.target.value)}
                        rows={3}
                    />
                    <Input
                        label="Where the result comes from"
                        hint="A name or address people can check. Nothing here is fetched automatically; it is a note to bettors, not a data feed."
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        autoComplete="off"
                    />
                    <Input
                        label="Category"
                        hint="e.g. sports, politics, weather. Used for browsing."
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        autoComplete="off"
                    />
                    {cleanOutcomes.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <span className={styles.fromLabel}>Notes per outcome (optional)</span>
                            {cleanOutcomes.map((o, i) => (
                                <Input
                                    key={i}
                                    label={o}
                                    value={outcomeNotes[i] || ''}
                                    onChange={(e) => setOutcomeNoteAt(i, e.target.value)}
                                    autoComplete="off"
                                />
                            ))}
                        </div>
                    ) : null}
                </>
            ) : null}

            <Button type="button" variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide who can bet' : 'Restrict who can bet (optional)'}
            </Button>
            {showAdvanced ? (
                <>
                    <Input
                        label="Only these addresses may bet"
                        hint="The number of an on-chain address list. Membership is checked when a bet is placed, so removing someone later does not undo a bet they already made."
                        value={allowList}
                        onChange={(e) => setAllowList(e.target.value)}
                        inputMode="numeric"
                        autoComplete="off"
                    />
                    <Input
                        label="These addresses may not bet"
                        hint="The number of an on-chain address list. If an address is on both lists, it is blocked."
                        value={blockList}
                        onChange={(e) => setBlockList(e.target.value)}
                        inputMode="numeric"
                        autoComplete="off"
                    />
                    <Input
                        label="Memo (optional)"
                        value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        autoComplete="off"
                    />
                </>
            ) : null}

            {!isHwSource && !signerReady ? (
                <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            ) : null}

            {formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || actionConfirm.composing}
                >
                    Review market
                </Button>
            </div>
            <p className={styles.hint}>
                Everything above is permanent once the market is on the chain: there is no edit. Your only
                later choices are publishing the winning outcome or cancelling and refunding everyone.
            </p>
        </form>,
    );
}
