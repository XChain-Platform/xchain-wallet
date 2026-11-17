// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { Children, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, FieldIconButton, Icon, InfoTip, Input, ListPage, ListRow, OptionalPill, PageHeader, Screen, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
// Open a Market uses the shared Quick | Full standard (one form state, two views).
import { useGiveGetView } from '../components/giveGet/index.js';
// The Wallet Form Standard frame: From first, sections, one Network fee row, one action.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    MemoSection,
} from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import bet from './CreateBetFeedForm.module.css';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen, ActionWarningsCard } from '../components/ActionConfirmScreen.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ListField } from '../components/ListField.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { pickedListText } from '../utils/listLabel.js';
import { useBetChainIds } from './BetFeedsList.jsx';
import styles from './IssueTokenForm.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/betCreate.js';
import '../../i18n/locales/en/components.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import {
    formatWithThousands,
    normalizeLocalizedDecimal,
} from '../utils/amountFormat.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';

const chainRegistry = registryLib.defaultRegistry();

// Mirrors the SDK's BET_LIMITS for form-level pre-checks only. The SDK builder
// is the authoritative validator (it runs host-side inside composeForConfirm);
// these exist so a user is told about a too-long label before a compose round
// trip, not so the wallet can decide what the protocol accepts.
const MAX_LABEL = 250;
const MAX_OUTCOMES = 16;
const MAX_OUTCOME_LABEL = 64;
const MAX_FEE_PCT = 10;
const MIN_REFUND_WINDOW = 3600;
const MAX_REFUND_WINDOW = 31536000;
const MAX_DEADLINE_HORIZON = 31536000;
const MAX_DESCRIPTION = 2000;
const MAX_RESOLUTION_CRITERIA = 1000;
const MAX_SOURCE = 500;
const MAX_CATEGORY = 64;

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
// Seconds for a custom publish window typed in days. Plain decimal text only:
// Number() also reads "0x10" as 16 days and "1e1" as 10.
export function customWindowSeconds(daysText) {
    const text = String(daysText ?? '').trim();
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
    const days = Number(text);
    if (!Number.isFinite(days) || days <= 0) return null;
    return Math.round(days * 86400);
}

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
const OUTCOME_BAD_CHARS = /[,|;]|[\u0000-\u001f\u007f]/;

// Which Full section holds each validated field. An error on a field Quick
// hides switches to Full with that section open, so Open Market never fails
// on a field nobody can see; From and Memo open in place in both views.
const FIELD_SECTION = {
    from: 'from',
    label: 'question',
    description: 'question',
    category: 'question',
    outcomes: 'outcomes',
    notes: 'outcomes',
    deadline: 'timing',
    refund: 'timing',
    tick: 'money',
    fee: 'money',
    min: 'money',
    criteria: 'oracle',
    source: 'oracle',
    lists: 'oracle',
    memo: 'memo',
};
const QUICK_FIELDS = new Set(['label', 'outcomes', 'deadline', 'tick']);
const BOTH_VIEW_SECTIONS = new Set(['from', 'memo']);

// Outcome dots on the form (light and dark surfaces); the preview card uses
// the same order.
const OUTCOME_DOTS = ['#16A34A', '#DC2626', '#9333EA', '#0891B2', '#D97706', '#DB2777', '#4F46E5', '#65A30D'];

// Short date ("Dec 31") for the preview card and the Default Terms chips.
function shortDate(unix) {
    if (!unix) return '';
    try {
        return new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

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
    const demoGuard = useDemoGuard(walletId, { onBack });
    const betChainIds = useBetChainIds();
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

    // The description and who-can-bet toggles are Full sections.
    const [description, setDescription] = useState('');
    const [resolutionCriteria, setResolutionCriteria] = useState('');
    const [source, setSource] = useState('');
    const [category, setCategory] = useState('');
    const [outcomeNotes, setOutcomeNotes] = useState(['', '']);

    const [allowList, setAllowList] = useState('');
    const [blockList, setBlockList] = useState('');
    // The list pickers (G114): which one is open and the names picked.
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    const [allowPick, setAllowPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [blockPick, setBlockPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [memo, setMemo] = useState('');

    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any} */ (null));
    const [submitting, setSubmitting] = useState(false);
    const submitLockRef = useRef(false);
    const [duplicated, setDuplicated] = useState(false);
    // View and section open state live above every early return, so a picker
    // page or the confirm screen never resets them. Only the main section
    // starts open (Market in Quick, "question" in Full); the rest start closed.
    const betView = useGiveGetView('betCreate', {
        sections: {
            from: false, market: true, question: true, outcomes: false, timing: false, money: false,
            oracle: false, memo: false, preview: false, fee: false, terms: false,
        },
        // Quick's Default Terms section holds these sections' fields, so an
        // error on one of them opens that section in place in Quick.
        quickTerms: { key: 'terms', sections: ['timing', 'money', 'oracle'] },
    });

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
                if (!sourceId) { setLoadError('No address on this network. Use Receive to generate one first.'); return; }
                setLoadError(null);
                setFromAddressId(sourceId);
            })
            .catch((err) => { if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.')); });
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

    // Opening a market is fee-bearing (BET v0 is duration-priced over the
    // market's full life), so it needs the same fee lane every other fee-bearing
    // form has. On LTC/DOGE the hook forces it on, because a native-coin output
    // is the only way to pay a protocol fee there: without it the create is
    // broadcast, the miner fee is spent, and the market never exists.
    const coinTicker = protocolCoinTickerFor(descriptor || chainId);
    const nativeFee = useNativeFee(chainId);
    const feeEstimate = useMemo(
        () => estimateNativeSendFee({ chainId, chainRegistry, speed: 'normal' }),
        [chainId],
    );

    const cleanOutcomes = useMemo(
        () => outcomes.map((o) => o.trim()).filter((o) => o.length > 0),
        [outcomes],
    );
    const deadlineUnix = useMemo(() => localInputToUnix(deadlineInput), [deadlineInput]);
    const refundSeconds = useMemo(() => {
        if (windowPreset !== 'custom') return Number(windowPreset);
        return customWindowSeconds(windowCustomDays);
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
    // Only whether the quote failed: the host's error text names SDK calls,
    // which never reach the screen.
    const [quoteFailed, setQuoteFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setQuote(null);
        setQuoteFailed(false);
        if (!deadlineUnix || !refundSeconds) return undefined;
        if (typeof messaging.betProjectFeedCreateFee !== 'function') return undefined;
        messaging.betProjectFeedCreateFee({
            chainId, deadline: deadlineUnix, refundWindow: refundSeconds, blockTime: nowSec,
        })
            .then((q) => { if (!cancelled) setQuote(q || null); })
            .catch(() => { if (!cancelled) setQuoteFailed(true); });
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
    // Each failure also names its field, so submit can bring a field the
    // current view hides into sight.
    function validate() {
        const fail = (message, field) => ({ message, field });
        if (!fromAddress) return fail('No address on this network to create a market from.', 'from');
        if (!label.trim()) return fail('Give the market a question or title.', 'label');
        const safety = [
            [actionTextSafetyError(label, 'Title'), 'label'],
            [cleanOutcomes.map((outcome) => actionTextSafetyError(outcome, 'Outcome')).find(Boolean), 'outcomes'],
            [actionTextSafetyError(description, 'Description'), 'description'],
            [actionTextSafetyError(resolutionCriteria, 'Settlement rule'), 'criteria'],
            [actionTextSafetyError(source, 'Result source'), 'source'],
            [actionTextSafetyError(category, 'Category'), 'category'],
            [outcomeNotes.map((note) => actionTextSafetyError(note, 'Outcome note')).find(Boolean), 'notes'],
            [memoLengthError(memo.trim()), 'memo'],
        ].find(([message]) => Boolean(message));
        if (safety) return fail(safety[0], safety[1]);
        if (label.trim().length > MAX_LABEL) return fail(`The title is ${label.trim().length} characters; the limit is ${MAX_LABEL}.`, 'label');
        if (!tick.trim()) return fail('Choose the token bets are placed in. Betting is token-only: the network coin cannot be wagered.', 'tick');
        if (cleanOutcomes.length !== outcomes.length) return fail('Fill in every outcome, or remove the empty one.', 'outcomes');
        if (cleanOutcomes.length < 2) return fail('A market needs at least two outcomes.', 'outcomes');
        if (cleanOutcomes.length > MAX_OUTCOMES) return fail(`A market can have at most ${MAX_OUTCOMES} outcomes.`, 'outcomes');
        if (cleanOutcomes.some((o) => o.length > MAX_OUTCOME_LABEL)) return fail(`Each outcome label must be ${MAX_OUTCOME_LABEL} characters or fewer.`, 'outcomes');
        if (cleanOutcomes.some((o) => OUTCOME_BAD_CHARS.test(o))) return fail('Outcome labels cannot contain a comma, a semicolon or a vertical bar.', 'outcomes');
        if (new Set(cleanOutcomes).size !== cleanOutcomes.length) return fail('Two outcomes have the same label. Each one must be distinct.', 'outcomes');
        if (!deadlineUnix) return fail('Pick when betting closes.', 'deadline');
        if (deadlineUnix <= nowSec) return fail('Betting must close in the future.', 'deadline');
        if (deadlineUnix - nowSec > MAX_DEADLINE_HORIZON) return fail('Betting must close within one year.', 'deadline');
        if (!refundSeconds) return fail('Set how long you have to publish the result.', 'refund');
        if (refundSeconds < MIN_REFUND_WINDOW || refundSeconds > MAX_REFUND_WINDOW) {
            return fail('Time to publish the result must be between one hour and one year.', 'refund');
        }
        if (feePct.trim()) {
            if (!/^\d+(\.\d{1,2})?$/.test(feePct.trim())) return fail('Your fee must be a number with at most two decimal places, as a percent of the pot.', 'fee');
            if (Number(feePct.trim()) > MAX_FEE_PCT) return fail(`Your fee cannot exceed ${MAX_FEE_PCT}% of the pot.`, 'fee');
        }
        if (minAmount.trim()) {
            const min = /^(\d+)(?:\.(\d+))?$/.exec(minAmount.trim());
            if (!min) return fail('The minimum bet must be a positive amount.', 'min');
            if ((min[2] || '').length > 18) return fail('The minimum bet can have at most 18 decimal places.', 'min');
            if ((min[1].replace(/^0+/, '').length || 1) > 47) return fail('The minimum bet is too large.', 'min');
            if (!/[1-9]/.test(`${min[1]}${min[2] || ''}`)) return fail('The minimum bet must be a positive amount.', 'min');
        }
        if (allowList.trim() && !/^\d+$/.test(allowList.trim())) return fail('The allowed-addresses list must be a list number.', 'lists');
        if (blockList.trim() && !/^\d+$/.test(blockList.trim())) return fail('The blocked-addresses list must be a list number.', 'lists');
        if (allowList.trim() && allowList.trim() === blockList.trim()) {
            return fail('The same list is set as both allowed and blocked, so nobody could ever bet. Pick one.', 'lists');
        }
        if (description.trim().length > MAX_DESCRIPTION) return fail(`The description must be ${MAX_DESCRIPTION} characters or fewer.`, 'description');
        if (resolutionCriteria.trim().length > MAX_RESOLUTION_CRITERIA) return fail(`The settlement rule must be ${MAX_RESOLUTION_CRITERIA} characters or fewer.`, 'criteria');
        if (source.trim().length > MAX_SOURCE) return fail(`The result source must be ${MAX_SOURCE} characters or fewer.`, 'source');
        if (category.trim().length > MAX_CATEGORY) return fail(`The category must be ${MAX_CATEGORY} characters or fewer.`, 'category');
        return null;
    }

    // An error on a field the open view hides switches to Full with
    // that field's section open; a field already in sight is left alone.
    function revealField(field) {
        const section = FIELD_SECTION[field];
        if (!section) return;
        if (BOTH_VIEW_SECTIONS.has(section)) { betView.setSectionOpen(section, true); return; }
        if (betView.view === 'quick' && QUICK_FIELDS.has(field)) { betView.setSectionOpen('market', true); return; }
        betView.openOptions(section);
    }

    // Composes through the SDK's own createMarketParams builder HOST-side. A
    // client-side wire mirror would be SIGNED rather than caught: BET's four
    // formats differ by one field, and a create with DETAILS is the longest of
    // them, so the mirror is where drift would hide.
    async function submit(event) {
        event?.preventDefault?.();
        const problem = validate();
        if (problem) { setFormError(problem.message); revealField(problem.field); return; }
        if (submitLockRef.current) return;
        submitLockRef.current = true;
        setSubmitting(true);
        setFormError(null);
        const from = sourceDescriptor();
        try {
            if (isWatcherMode) {
                const res = await messaging.buildBetActionPsbtRequest({
                    chainId,
                    from,
                    builder: 'createMarketParams',
                    params: marketParams,
                    payFeeInNativeCoin: nativeFee.flag,
                });
                setResult(res);
                return;
            }
            const res = await actionConfirm.run({
                chainId,
                from,
                compose: () => messaging.composeBetForConfirm(withAdvancedOptions({
                    walletId, chainId, from, builder: 'createMarketParams', params: marketParams,
                    // The fee mode must reach COMPOSE, not just submit: the
                    // FEE_DESTINATION output has to be inside the PSBT the user
                    // approves and the tamper check verifies.
                    payFeeInNativeCoin: nativeFee.flag,
                })),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId, chainId, from, params: marketParams, prebuiltPsbt,
                    payFeeInNativeCoin: nativeFee.flag,
                }),
            });
            setResult(res);
            setPassword('');
        } catch (err) {
            if (isUserRejection(err)) return;
            // Through the shared mapper: this form's own validation
            // catches a blank label or tick, but the SDK builder is the last
            // word on the wire rules, and its refusals reached the user as log
            // lines - "betting.createBetFeedParams: ..." (D-118).
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Creating the market failed.',
            }));
        } finally {
            submitLockRef.current = false;
            setSubmitting(false);
        }
    }

    const header = <PageHeader onBack={onBack} title="Open a Market" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (actionConfirm.open) {
        const openMarketSummary = {
            verb: t('components.confirmSummary.verbOpenMarket'),
            ...(label.trim() ? { target: label.trim() } : {}),
            direction: 'none',
            chainId,
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={openMarketSummary}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
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
                title="Oracle Address"
                walletId={walletId}
                chainId={chainId}
                // Once an asset is picked it decides the network, so the oracle
                // address picker stays on it.
                lockNetwork={Boolean(tick.trim())}
                onChainChange={tick.trim() ? undefined : (cid) => { setChainId(cid); setFromAddressId(null); }}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
                filterType="2"
                walletId={walletId}
                title={listPickerFor === 'allow' ? 'Choose Allow-List' : 'Choose Block-List'}
                onSelect={(row) => {
                    const pick = { index: String(row.actionIndex), name: row.name };
                    if (listPickerFor === 'allow') { setAllowList(String(row.actionIndex)); setAllowPick(pick); }
                    else { setBlockList(String(row.actionIndex)); setBlockPick(pick); }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select Token"
                // No network pre-filter: the asset sets the network (the From
                // section follows it), so the page lists every network.
                // BET escrows a TOKEN. The native coin is not a legal
                // wager (the indexer answers `invalid: TICK (unknown)`), so
                // offering it walked a wallet holding only BTC into composing a
                // whole market that could never index. Proven on the regtest
                // venue in wallet E2E session 20, then re-run with XCHAIN,
                // which produced market #1160.
                kindFilter="tokens"
                kindLocked
                onSelect={(sel) => {
                    // Picking an asset on another network moves the form there;
                    // a network with no betting markets is refused instead of
                    // half-switched.
                    if (sel.chainId && sel.chainId !== chainId) {
                        if (betChainIds.length > 0 && !betChainIds.includes(sel.chainId)) {
                            setFormError('Betting markets are not open on that network yet. Pick a token on another network.');
                            setTokenPickerOpen(false);
                            return;
                        }
                        // The old Network field offered only networks with an
                        // address; a pick elsewhere would replace the form
                        // with the no-address page, so it is refused here.
                        if (!(addressesByChain?.[sel.chainId] || []).length) {
                            setFormError('This wallet has no address on that network to open a market from. Use Receive to create one first.');
                            setTokenPickerOpen(false);
                            return;
                        }
                        setChainId(sel.chainId);
                        setFromAddressId(null);
                    }
                    setTick(String(sel.tick || '').toUpperCase());
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // The load error, the loading line and every result lay out through
    // ListPage, the template for read-only states, so no state draws
    // straight into the Screen box beside a form stage that uses FormPage.
    if (loadError) {
        return wrap(<ListPage notices={<StatusMessage variant="error">{loadError}</StatusMessage>} />);
    }
    if (!addressesByChain) return wrap(<ListPage><p className={styles.hint}>Loading addresses…</p></ListPage>);

    if (result) {
        const txid = result?.txid || result?.tx_hash;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ListPage>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={() => setResult(null)}
                        onDone={onBack}
                    />
                </ListPage>,
            );
        }
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(
                <ListPage>
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} />
                </ListPage>,
            );
        }
        // The shared result screen: the notice, the transaction id as a
        // label-left value-right fact row, the permanence note in a
        // WarningCard (never a loose paragraph), and the green Done with its icon.
        return wrap(
            <ListPage>
                <ResultScreen
                    state="success"
                    title="Market submitted."
                    message={`Once the network records it, anyone holding ${tick} can bet on it, and it is yours to resolve after betting closes.`}
                    onDone={onCreated || onBack}
                >
                    <ul className={bet.resultFacts}>
                        <li>
                            <ListRow
                                title="Transaction ID"
                                trailing={<span className={bet.resultValue}>{String(txid || 'n/a')}</span>}
                            />
                        </li>
                    </ul>
                    <WarningCard data-bet-create-permanent="">
                        <WarningLine>
                            The terms you just set are permanent: a market cannot be edited. If something is
                            wrong, cancel it (everyone is refunded) and open a new one.
                        </WarningLine>
                    </WarningCard>
                </ResultScreen>
            </ListPage>,
        );
    }

    const quoteBlock = (() => {
        if (quoteFailed) return <p className={styles.hint}>{t('betCreate.costUnavailable')}</p>;
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

    // The Quick and Full views below render the same field state.
    // Each field is built once and placed in whichever view is open.
    const { view, setView, sections } = betView;
    const tickUpper = tick.trim().toUpperCase();
    const refundUnix = deadlineUnix && refundSeconds ? deadlineUnix + refundSeconds : null;
    const windowText = windowPreset === 'custom'
        ? `${windowCustomDays || '?'} days`
        : (WINDOW_PRESETS.find((p) => p.value === windowPreset)?.label || '').replace(' (default)', '');
    const outcomeHelp = 'One possible result per row. Exactly one outcome can win: whoever backed it splits the whole pot, and if nobody backed it, everyone is refunded and you earn nothing.';
    const changeChain = (cid) => { setChainId(cid); setFromAddressId(null); };

    const questionField = (
        <Input
            label="Question"
            help="The question bettors back an outcome of, such as who wins a match."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
        />
    );

    const outcomesGroup = (withLabel) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-form-gap)' }}>
            {withLabel ? (
                <span className={bet.groupLabel}>
                    <span>Outcomes</span>
                    <InfoTip label={outcomeHelp} aria="About Outcomes" />
                </span>
            ) : null}
            {outcomes.map((o, i) => (
                <div key={i} className={bet.outcomeRow}>
                    <div className={bet.outcomeField} data-testid="outcome-field">
                        <span
                            className={bet.outcomeDot}
                            style={{ '--outcome-dot': OUTCOME_DOTS[i % OUTCOME_DOTS.length] }}
                            data-testid="outcome-dot"
                            aria-hidden="true"
                        />
                        <Input
                            className={bet.outcomeInput}
                            aria-label={`Outcome ${i + 1}`}
                            placeholder={`Outcome ${i + 1}`}
                            value={o}
                            onChange={(e) => setOutcomeAt(i, e.target.value)}
                            autoComplete="off"
                            fieldAction={outcomes.length > 2 ? (
                                <FieldIconButton
                                    icon={<Icon.XIcon />}
                                    label={`Remove outcome ${i + 1}`}
                                    onClick={() => removeOutcome(i)}
                                />
                            ) : null}
                        />
                    </div>
                </div>
            ))}
            {outcomes.length < MAX_OUTCOMES ? (
                <Button type="button" variant="ghost" className={bet.addOutcome} icon={<Icon.PlusIcon />} onClick={addOutcome}>
                    Add Outcome
                </Button>
            ) : null}
            {withLabel ? null : <p className={bet.groupHint}>{outcomeHelp}</p>}
        </div>
    );

    const deadlineField = (fieldLabel) => (
        <Input
            label={fieldLabel}
            help="Bets are taken until this time. After it, you publish the winning outcome."
            type="datetime-local"
            value={deadlineInput}
            onChange={(e) => setDeadlineInput(e.target.value)}
        />
    );

    const assetField = (
        <TokenField
            // Token, not Asset: the network coin cannot be wagered.
            label="Token"
            help="The token bettors stake on this market. Every bet and every payout is in this token. Betting is token-only: the network coin cannot be wagered."
            value={tick && chainId ? { chainId, tick } : null}
            onOpenPicker={() => setTokenPickerOpen(true)}
        />
    );

    // One chip per defaulted or set term, read from live state.
    const termChips = [
        refundUnix ? `Refund by ${shortDate(refundUnix)}` : `${windowText} to publish`,
        feePct.trim() ? `Oracle fee ${feePct.trim()}%` : 'No oracle fee',
        minAmount.trim() ? `Min bet ${formatWithThousands(minAmount.trim())}${tickUpper ? ` ${tickUpper}` : ''}` : 'No minimum bet',
        'You are the oracle',
        // No network chip; the network shows only in the From section.
    ];
    if (description.trim() || resolutionCriteria.trim() || source.trim() || category.trim()) termChips.push('Details added');
    if (outcomeNotes.some((n) => String(n || '').trim())) termChips.push('Outcome notes');
    if (allowList.trim()) termChips.push(`Allow-list #${allowList.trim()}`);
    if (blockList.trim()) termChips.push(`Block-list #${blockList.trim()}`);
    // The Quick Default Terms section expands in place and reuses the Full
    // sections' own fields, minus the two Quick already shows above it
    // (Betting Closes leads Timing, the asset leads Money).
    const QUICK_TERMS_PARTS = [['timing', 1], ['money', 1], ['oracle', 0]];
    // Section open state comes from the same Give/Get view state; `main`
    // flags the main section (Market in Quick, Question in Full).
    const bind = (id) => ({ open: Boolean(sections[id]), onOpenChange: (open) => betView.setSectionOpen(id, open), main: id === 'market' || id === 'question' });
    // A note is a WarningCard, never a loose paragraph.
    const duplicatedNote = duplicated ? (
        <WarningCard className={bet.duplicatedNote} data-bet-duplicated-note="">
            <WarningLine>
                Copied from market #{String(duplicateFeedIndex)}. Pick new dates, then check the terms:
                the copy is a brand new market, and opening it pays the cost below again. Cancelling a
                market does not refund what it cost to open.
            </WarningLine>
        </WarningCard>
    ) : null;
    const marketSummary = joinSummary(
        label.trim() || null,
        `${outcomes.length} outcomes`,
        deadlineUnix ? `closes ${shortDate(deadlineUnix)}` : null,
        tickUpper || null,
    );
    const quickTermsFields = () => QUICK_TERMS_PARTS.map(([id, skip]) => {
        const section = Children.toArray(fullView.props.children).find((c) => c?.props?.id === id);
        return <Fragment key={id}>{Children.toArray(section?.props.children).slice(skip)}</Fragment>;
    });

    // Built on demand, after fullView, so the terms can reuse its fields.
    const quickView = () => (
        <>
            {/* The main section, open: the market itself. */}
            <FormSection id="market" title="Market" icon={Icon.MarketIcon} {...bind('market')} summary={marketSummary}>
                {duplicatedNote}
                {questionField}
                {outcomesGroup(true)}
                {deadlineField('Closes')}
                {assetField}
            </FormSection>
            <FormSection
                id="terms"
                title="Default Terms"
                icon={Icon.FilterIcon}
                summary={termChips.join(' · ')}
                {...bind('terms')}
            >
                {quickTermsFields()}
            </FormSection>
        </>
    );

    const fullView = (
        <>
            {/* The main section of Full, open; the rest start closed. */}
            <FormSection
                id="question"
                title="Market"
                icon={Icon.MarketIcon}
                summary={label.trim() || 'Required'}
                {...bind('question')}
            >
                {duplicatedNote}
                {questionField}
                <Textarea
                    label="Description"
                    optional
                    help="This rides on the chain with the market, so bettors and every explorer see the same text. Write the settlement rule you will actually follow: it is what people will hold you to, and you cannot change it later."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                />
                <Input
                    label="Category"
                    optional
                    help="E.g. sports, politics, weather. Used for browsing."
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    autoComplete="off"
                />
            </FormSection>
            <FormSection
                id="outcomes"
                title="Outcomes"
                icon={Icon.TokenListIcon}
                summary={`${outcomes.length} outcomes`}
                {...bind('outcomes')}
            >
                {outcomesGroup(false)}
                {cleanOutcomes.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-form-gap)' }}>
                        <span className={styles.fromLabel}>Notes per outcome <OptionalPill /></span>
                        {cleanOutcomes.map((o, i) => (
                            <Input
                                key={i}
                                label={o}
                                help="A note bettors see beside this outcome, such as what counts as this result."
                                value={outcomeNotes[i] || ''}
                                onChange={(e) => setOutcomeNoteAt(i, e.target.value)}
                                autoComplete="off"
                            />
                        ))}
                    </div>
                ) : null}
            </FormSection>
            <FormSection
                id="timing"
                title="Timing"
                icon={Icon.ClockIcon}
                summary={deadlineUnix ? `Closes ${shortDate(deadlineUnix)}` : 'Not set'}
                {...bind('timing')}
            >
                {deadlineField('Betting Closes')}
                <Select
                    label="Time to Publish the Result"
                    help="How long after betting closes you have to publish the winning outcome. If you publish nothing in this window, everyone is refunded. A longer window costs more, because the cost is measured to this deadline."
                    hint={refundUnix ? `Past this window everyone is refunded. Refund by ${shortDate(refundUnix)}.` : undefined}
                    value={windowPreset}
                    onChange={(e) => setWindowPreset(e.target.value)}
                >
                    {WINDOW_PRESETS.map((p) => <Select.Option key={p.value} value={p.value} icon={p.value === 'custom' ? <Icon.PencilIcon /> : <Icon.ClockIcon />}>{p.label}</Select.Option>)}
                </Select>
                {windowPreset === 'custom' ? (
                    <Input
                        label="Days to Publish the Result"
                        help="The number of days after betting closes that you have to publish the winning outcome."
                        value={windowCustomDays}
                        onChange={(e) => setWindowCustomDays(e.target.value)}
                        inputMode="decimal"
                        autoComplete="off"
                    />
                ) : null}
            </FormSection>
            <FormSection
                id="money"
                title="Money"
                icon={Icon.CoinsIcon}
                summary={tickUpper || 'No token yet'}
                {...bind('money')}
            >
                {assetField}
                <Input
                    label="Smallest Bet Allowed"
                    optional
                    help="Leave empty for no minimum. Useful because payouts round down: a tiny stake can win and still pay nothing."
                    value={formatWithThousands(minAmount)}
                    onChange={(e) => {
                        const raw = e.target.value;
                        setMinAmount(normalizeLocalizedDecimal(raw) ?? raw);
                    }}
                    inputMode="decimal"
                    autoComplete="off"
                />
                <Input
                    label="Your Fee"
                    optional
                    help={`Your share of the pot, such as 1.5 for 1.5%, up to ${MAX_FEE_PCT}%. Paid only when you publish a result; cancelled, void, and expired markets pay nothing.`}
                    value={formatWithThousands(feePct)}
                    onChange={(e) => {
                        const raw = e.target.value;
                        setFeePct(normalizeLocalizedDecimal(raw) ?? raw);
                    }}
                    inputMode="decimal"
                    autoComplete="off"
                />
            </FormSection>
            <FormSection
                id="oracle"
                title="Oracle"
                icon={Icon.VerifyIcon}
                summary="You"
                {...bind('oracle')}
            >
                {/* The oracle address is the From address; it lives in the standard
                    From section above, with this help. */}
                <Input
                    label="Where the Result Comes From"
                    optional
                    help="A name or address people can check. Nothing here is fetched automatically; it is a note to bettors, not a data feed."
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    autoComplete="off"
                />
                <Textarea
                    label="How the Result Will Be Decided"
                    optional
                    help="The rule you follow, including what happens in an edge case such as a postponement or a tie."
                    value={resolutionCriteria}
                    onChange={(e) => setResolutionCriteria(e.target.value)}
                    rows={3}
                />
                <ListField
                    label="Only These Addresses May Bet"
                    optional
                    help="An address list you published in My Lists. Membership is checked when each bet is placed, so later removals do not cancel existing bets."
                    placeholder="None set"
                    valueText={pickedListText(allowList, allowPick)}
                    onOpenPicker={() => setListPickerFor('allow')}
                    onClear={() => { setAllowList(''); setAllowPick(null); }}
                    clearLabel="Clear allow list"
                />
                <ListField
                    label="These Addresses May Not Bet"
                    optional
                    help="An address list you published in My Lists. If an address is on both lists, it is blocked."
                    placeholder="None set"
                    valueText={pickedListText(blockList, blockPick)}
                    onOpenPicker={() => setListPickerFor('block')}
                    onClear={() => { setBlockList(''); setBlockPick(null); }}
                    clearLabel="Clear block list"
                />
            </FormSection>
            {/* Network and the From (oracle) address live in the standard From
                section; Memo is its own closed section in both views. */}
        </>
    );

    // How the market will look once open, in the bet market's blue.
    // No bets exist yet, so every outcome shows an even split.
    const previewLabels = outcomes.map((o, i) => o.trim() || `Outcome ${i + 1}`);
    const evenPct = Math.round(100 / Math.max(1, previewLabels.length));
    // The preview is a closed standard section like every other group.
    const previewCard = (
        <FormSection id="preview" title="Preview" icon={Icon.EyeIcon} summary="How it looks once open" {...bind('preview')}>
            <div className={bet.previewBody}>
                <div className={bet.preview}>
                    <p className={bet.previewQuestion}>
                        {label.trim() || <span className={bet.previewPlaceholder}>Your question shows here</span>}
                    </p>
                    <div className={bet.previewMeta}>
                        <span className={bet.previewMetaItem}>
                            <Icon.ClockIcon aria-hidden="true" />
                            {deadlineUnix ? `Closes ${shortDate(deadlineUnix)}` : 'Closing date not set'}
                        </span>
                        {refundUnix ? <span>Refund by {shortDate(refundUnix)}</span> : null}
                    </div>
                    <ul className={bet.previewOutcomes} aria-label="Outcomes in the preview">
                        {previewLabels.map((o, i) => (
                            <li key={i} className={bet.previewOutcome}>
                                <span className={bet.previewOutcomeLabel} title={o}>{o}</span>
                                <span className={bet.previewOutcomePct}>{evenPct}%</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </FormSection>
    );

    const betChainsWithAddresses = (addressesByChain ? Object.keys(addressesByChain) : [chainId])
        .filter((cid) => betChainIds.length === 0 || betChainIds.includes(cid));

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Open a market"
            onSubmit={submit}
            // The Quick | Full switch leads the form, 8px above From.
            view={view}
            onViewChange={setView}
            viewLabel="Open a Market form view"
            // That market terms are permanent is the confirm screen's warnings
            // card; a watcher build has no confirm screen, so it shows here.
            status={[
                formError ? <StatusMessage key="error" variant="error">{formError}</StatusMessage> : null,
                isWatcherMode ? <ActionWarningsCard key="warnings" ids={['MARKET_CREATE']} /> : null,
            ]}
            action={(
                <FormAction
                    icon={isWatcherMode ? <Icon.PlusIcon /> : <Icon.MarketIcon />}
                    loading={submitting || actionConfirm.composing}
                    disabled={submitting || actionConfirm.composing}
                >
                    {actionConfirm.composing
                        ? 'Preparing Review…'
                        : isWatcherMode ? 'Create Unsigned Transaction' : 'Open Market'}
                </FormAction>
            )}
            from={(
                // The standard From section, first in both views. The From
                // address is the oracle address; once an asset is picked it
                // decides the network, so the field locks until the picker moves it.
                <FromSection
                    {...bind('from')}
                    chainId={chainId}
                    chainIds={betChainsWithAddresses}
                    chainRegistry={chainRegistry}
                    onNetworkChange={changeChain}
                    lockNetwork={Boolean(tick.trim())}
                    networkHelp="The chain the market is created on. It follows the asset bets are placed in; your oracle address and the fees are on this network."
                    address={fromAddress?.address}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose oracle address"
                    addressHelp="This address is the market: it is the only one that can publish the result or cancel, it collects your fee, and its record as an oracle is public. It cannot bet on its own market, because an oracle who could bet on the result would decide the result."
                />
            )}
            fee={(
                /* This form is the one that already quotes its own fee, so
                   the row states the real answer instead of the chain's rule. Most
                   markets are free (the first 90 days cost nothing), and on LTC the
                   row used to promise a coin payment for every one of them. */
                /* FeeSection's fixed-fee mode: the form composes at the
                   normal rate, so no speed picker; the Fees section shows the
                   network fee figure and the open cost as the protocol fee. */
                <FeeSection
                    {...bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    fixedFee={feeEstimate?.coinAmount || null}
                    fees={{
                        quote,
                        pending: !quote && !quoteFailed,
                        nativeFeeProps: nativeFee.toggleProps,
                    }}
                >
                    {quoteBlock}
                </FeeSection>
            )}
        >
            {view === 'quick' ? quickView() : fullView}

            {/* Memo holds only the memo: the section title names the field
                and carries its count. */}
            <MemoSection
                {...bind('memo')}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />

            {previewCard}

            {/* No password on the form: the shared confirm screen
                (ActionConfirmScreen) asks for it whenever the wallet is locked. */}
        </FormFrame>,
    );
}
