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
import {
    AddressText,
    Button,
    ChainBadge,
    Checkbox,
    EmptyState,
    Icon,
    InfoTip,
    Input,
    ListPage,
    PageHeader,
    Screen,
    StatusMessage,
    useFormErrors,
} from '@xchain-wallet/core/ui';
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
// The page layout the bet market shares (Layout 1, ruled 2026-11-13), so the
// two outcome pages cannot drift apart.
import {
    OutcomeActivity,
    OutcomeDetailLayout,
    OutcomeFacts,
    OutcomeHero,
    OutcomeResult,
} from '../components/outcomeDetail/OutcomeDetailLayout.jsx';
import outcomeStyles from '../components/outcomeDetail/OutcomeDetail.module.css';
import { RANGES as CHART_RANGES, defaultRangeId } from '../components/PortfolioChart.jsx';
// The bet market's outcome list and marks, so the Vote tab reads exactly
// like the Bet tab (operator ruling 2026-11-13).
import { OutcomeList, OutcomeMark, outcomeMarkOf } from './OutcomeList.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
import { targetBlockSecondsForCoin } from '../utils/blockDateEstimate.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/governance.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/tokenDetail.js';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import detailStyles from './PollDetail.module.css';
import { explorerReadFailure } from '../../sdk/explorerErrors.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { compareDecimalStrings, formatWithThousands } from '../utils/amountFormat.js';
import { OFFER_LIFECYCLE_REFUSAL } from '../../flows/marketExpiry.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    blocksDurationText,
    latestBallotRows,
    pollOutcome,
    pollResultSummary,
    pollRowForDisplay,
    pollStatusLabel,
    samePollIndex,
} from './pollDisplay.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();
const POLL_RANGES = CHART_RANGES.filter((range) => range.id !== 'ytd');

/** The poll's ballot read for Activity is one bounded page. */
const POLL_VOTE_LIMIT = 500;

/** A ballot the chain accepted; a rejected one counts for nobody. */
function isAcceptedVote(row) {
    return !(typeof row?.status === 'string' && /^invalid/i.test(row.status));
}

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

function extractPoll(resp) {
    if (!resp) return null;
    if (Array.isArray(resp)) return resp[0] || null;
    if (Array.isArray(resp.data)) return resp.data[0] || null;
    if (resp.data && typeof resp.data === 'object') return resp.data;
    if (resp.row && typeof resp.row === 'object') return resp.row;
    return typeof resp === 'object' ? resp : null;
}

function votePollRef(vote) {
    return vote?.poll_index ?? vote?.poll_action_index ?? vote?.poll_ref;
}

function ballotRowText(row, options, isSplit) {
    const option = Number(row?.choice ?? row?.option_index);
    const label = Number.isInteger(option) ? `${option}: ${options[option] ?? ''}` : 'Unknown option';
    return isSplit ? `${label} (${String(row?.share ?? '0')} share)` : label;
}

/**
 * VOTE poll page, on the outcome page layout the bet market shares: the
 * shared outcome hero on its outlined surface, since ballots keep no history
 * to chart (status and closing chips; the question; the winning or leading
 * option's share, or "Counted at close" while voting is open; the legend and
 * stacked split bar; votes and voters at its foot with the quorum at its
 * end), then a Vote | Activity | Details strip (Result in place of Vote once
 * voting closes). Vote is the bet market's outcome list: one row per choice (its
 * mark, its name and a chevron), and the whole row is the button. Result
 * states the outcome, the final results with the winner marked, and what
 * this wallet voted.
 *
 * A choice row opens the Cast Vote step with that choice made, the way a bet
 * outcome opens Place Bet: the VOTE v1 form on the Form Standard (From, the
 * chosen vote, Memo, Network fee and Sign Vote), then the shared confirm
 * screen like the authoring forms. A poll that takes several choices, or a
 * split of weight, opens the ballot there with the tapped choice in it, so
 * the voter adds the others on Cast Vote, never by a second tap on the poll
 * page. Back from Cast Vote returns to the poll.
 *
 * Weight is frozen into the per-option tally only when the poll finalizes,
 * so an open poll's card says results are counted at close rather than
 * deriving a weighted tally in the wallet.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string | number} props.pollIndex
 * @param {() => void} props.onBack
 * @param {boolean} [props.embedded]
 */
export function PollDetail({ walletId, chainId, pollIndex, onBack, embedded = false }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [poll, setPoll] = useState(/** @type {any | null} */ (null));
    const [results, setResults] = useState(/** @type {any[] | null} */ (null));
    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [walletVotes, setWalletVotes] = useState(/** @type {any[] | null} */ (null));
    const [voteLoadError, setVoteLoadError] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // Ballot editor state. Approval: Set of chosen option indices. Split: map of
    // option index -> share string.
    const [approvalChoices, setApprovalChoices] = useState(/** @type {Set<number>} */ (new Set()));
    const [splitShares, setSplitShares] = useState(/** @type {Record<number, string>} */ ({}));
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    // view: the poll page; cast: the Cast Vote form; review and submitting:
    // the watcher-mode unsigned build; done: the result.
    const [stage, setStage] = useState(/** @type {'view' | 'cast' | 'review' | 'submitting' | 'done'} */ ('view'));
    // The tab strip under the hero. Vote leads on an open poll; a closed poll
    // offers Result in its place, so a held 'vote' reads as Result there.
    const [tab, setTab] = useState(/** @type {'vote' | 'result' | 'activity' | 'details'} */ ('vote'));
    const [rangeId, setRangeId] = useState(defaultRangeId());
    // The poll's own ballots, for the Activity tab and the voter count of an
    // open poll.
    const [pollVotes, setPollVotes] = useState(/** @type {any[] | null} */ (null));
    const [pollVotesFailed, setPollVotesFailed] = useState(false);
    // Cast Vote shows the chosen options with Change; Change (or a ballot
    // error) opens the ballot editor in place.
    const [editingBallot, setEditingBallot] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const formErrors = useFormErrors();
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const validPollIndex = /^[1-9]\d*$/.test(String(pollIndex ?? '').trim());
    // Open state of the Cast Vote sections, held above the early returns (the
    // From picker page) so it survives them. The vote is the form's main
    // section and starts open; From, Memo and Network fee start closed.
    const sections = useFormSections({
        vote: true, from: false, memo: false, fee: false,
    });
    // Counts Sign Vote presses, so the section holding the error reopens on each.
    const [validationAttempt, setValidationAttempt] = useState(0);

    useEffect(() => {
        if (!validPollIndex) {
            setPoll(null);
            setResults(null);
            setCurrentHeight(null);
            setLoadError('Poll number must be a positive whole number.');
            return undefined;
        }
        let cancelled = false;
        let firstLoad = true;
        setPoll(null); setResults(null); setCurrentHeight(null); setLoadError(null);
        async function refreshPoll() {
            try {
                const [p, heightResponse] = await Promise.all([
                    messaging.governancePoll({ chainId, pollIndex }),
                    typeof messaging.getIndexerWatermark === 'function'
                        ? messaging.getIndexerWatermark({ chainId }).catch(() => null)
                        : Promise.resolve(null),
                ]);
                if (cancelled) return;
                const loadedPoll = pollRowForDisplay(extractPoll(p));
                if (!loadedPoll || !samePollIndex(loadedPoll.action_index, pollIndex)) {
                    setPoll(null);
                    setResults(null);
                    setCurrentHeight(null);
                    setLoadError('Poll not found.');
                    return;
                }
                const height = heightResponse?.watermark == null || heightResponse.watermark === ''
                    ? null
                    : Number(heightResponse.watermark);
                const usableHeight = Number.isFinite(height) ? height : null;
                setPoll(loadedPoll);
                setCurrentHeight(usableHeight);
                setLoadError(null);

                const endBlock = loadedPoll.end_block == null || loadedPoll.end_block === ''
                    ? Number.NaN
                    : Number(loadedPoll.end_block);
                const terminal = loadedPoll.poll_status && loadedPoll.poll_status !== 'open';
                const closeReached = Number.isFinite(endBlock) && usableHeight !== null && usableHeight > endBlock;
                if (terminal || closeReached) {
                    const r = await messaging.governancePollResults({ chainId, pollIndex }).catch(() => null);
                    if (!cancelled) {
                        setResults(extractRows(r).filter((row) => (
                            row && typeof row === 'object' && !Array.isArray(row)
                        )));
                    }
                } else {
                    setResults(null);
                }
            } catch (err) {
                if (!cancelled && firstLoad) {
                    setLoadError(
                        explorerReadFailure(err, 'load this poll')?.message
                        || userFacingMessage(err, 'Could not load this poll. Try again.'),
                    );
                }
            } finally {
                firstLoad = false;
            }
        }
        refreshPoll();
        const refreshTimer = setInterval(refreshPoll, 30_000);
        return () => { cancelled = true; clearInterval(refreshTimer); };
    }, [chainId, pollIndex, messaging, validPollIndex]);

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
            .catch(() => { /* address load is best-effort; voting requires it, guarded at submit */ });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (!addressesByChain || !validPollIndex) return undefined;
        let cancelled = false;
        const addresses = addressesByChain[chainId] || [];
        setWalletVotes(null);
        setVoteLoadError(false);
        Promise.all(addresses.map(async ({ address }) => {
            const response = await messaging.governanceVotes({ chainId, query: address, type: 'address' });
            return extractRows(response)
                .filter((row) => String(votePollRef(row)) === String(pollIndex))
                .map((row) => ({ ...row, source: row?.source || address }));
        }))
            .then((rows) => { if (!cancelled) setWalletVotes(rows.flat()); })
            .catch(() => {
                if (!cancelled) {
                    setWalletVotes([]);
                    setVoteLoadError(true);
                }
            });
        return () => { cancelled = true; };
    }, [addressesByChain, chainId, pollIndex, messaging, validPollIndex]);

    // One read of the poll's ballots (newest first) for Activity.
    useEffect(() => {
        if (!validPollIndex) return undefined;
        let cancelled = false;
        setPollVotes(null);
        setPollVotesFailed(false);
        Promise.resolve()
            .then(() => messaging.governanceVotes({ chainId, query: String(pollIndex), type: 'poll', opts: { limit: POLL_VOTE_LIMIT } }))
            .then((response) => {
                if (cancelled) return;
                setPollVotes(extractRows(response)
                    .filter((row) => row && typeof row === 'object' && String(votePollRef(row) ?? pollIndex) === String(pollIndex)));
            })
            .catch(() => {
                if (cancelled) return;
                setPollVotes([]);
                setPollVotesFailed(true);
            });
        return () => { cancelled = true; };
    }, [chainId, pollIndex, messaging, validPollIndex]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);
    const voteBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: poll?.tick || '',
    });

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode(walletId);

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
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
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const options = Array.isArray(poll?.options) ? poll.options : [];
    const isSplit = poll?.tally_mode === 'split';
    const maxSel = Number(poll?.max_selections) || 1;
    const pollReportsOpen = !poll?.poll_status || poll.poll_status === 'open';
    const endBlock = poll?.end_block == null || poll.end_block === '' ? Number.NaN : Number(poll.end_block);
    const hasCountdown = Number.isFinite(endBlock) && currentHeight !== null;
    const blocksRemaining = hasCountdown ? endBlock - currentHeight : null;
    const isOpen = pollReportsOpen && (blocksRemaining === null || blocksRemaining >= 0);
    const walletBallots = useMemo(() => {
        if (!walletVotes || !addressesByChain) return [];
        return (addressesByChain[chainId] || []).map(({ address }) => ({
            address,
            rows: latestBallotRows(walletVotes, address),
        })).filter(({ rows }) => rows.length > 0);
    }, [addressesByChain, chainId, walletVotes]);
    const sourceBallot = useMemo(
        () => (fromAddress && walletVotes ? latestBallotRows(walletVotes, fromAddress.address) : []),
        [fromAddress, walletVotes],
    );
    const ballotLabelId = useId();

    // The ballot is set only by the choice row the voter tapped (and edited
    // on Cast Vote). It is never seeded from an earlier vote: a seed that
    // landed after the tap, when this wallet's votes finish loading or From
    // changes on Cast Vote, would replace the choice the voter just made.

    function toggleApproval(i) {
        formErrors.clear('poll-ballot');
        setApprovalChoices((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else if (next.size < maxSel) next.add(i);
            return next;
        });
    }

    // Build the sdk.voting.castBallotParams `ballot` input from the editor state.
    function buildBallot() {
        if (isSplit) {
            return Object.entries(splitShares)
                .filter(([, share]) => share && Number(share) > 0)
                .map(([option, share]) => ({ option: Number(option), share: String(share).trim() }));
        }
        return Array.from(approvalChoices).sort((a, b) => a - b);
    }
    const watcherWireBallot = isSplit
        ? buildBallot().map((entry) => `${entry.option}:${entry.share}`).join(',')
        : buildBallot().join(',');
    const watcherWireParams = useMemo(() => ({
        VERSION: '1',
        POLL_REF: String(pollIndex),
        BALLOT: watcherWireBallot,
        ...(memo.trim() && { MEMO: memo.trim() }),
    }), [memo, pollIndex, watcherWireBallot]);
    const legacyDecoded = useMemo(() => (
        stage === 'review' || stage === 'submitting'
            ? decoderLib.decodeAction({ action: 'VOTE', params: watcherWireParams, chainId: chainId || undefined, chainRegistry })
            : null
    ), [stage, watcherWireParams, chainId]);
    const legacyComposed = useMemo(() => (legacyDecoded ? {
        action: 'VOTE',
        chainId,
        decoded: legacyDecoded,
        protocolFeeKnownFree: true,
    } : null), [chainId, legacyDecoded]);

    // (§5.6 slice 2, late): casting a ballot was the last signing
    // surface still on the legacy stage machine, where submitWithSigner rebuilds
    // the PSBT on Approve - no output-set tamper check, no action-byte
    // cross-check, no exact fee, no pre-flight panel, no §4.7 reservation. A
    // ballot is token-weighted governance, so it is not a surface to leave
    // unverified. Hardware included; watcher still branches, because it
    // encodes and never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'castBallotAction',
        hardware: 'castBallotActionHw',
    });

    function ballotParams() {
        return { pollRef: pollIndex, ballot: buildBallot(), ...(memo.trim() && { memo: memo.trim() }) };
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

    // The page judges "open" from its last read, and a poll can close while the
    // review sits open: its end block passes or it is finalized. A ballot signed
    // then pays the miner fee and the protocol fee and counts for nothing, and
    // with pre-flight off or local nothing warns. So Approve reads the poll and
    // the height fresh, past read reuse and the HTTP cache, and refuses one that
    // no longer takes votes. A failed read is unknown, never a refusal.
    async function closedPollRefusal() {
        let fresh;
        let heightResponse = null;
        try {
            [fresh, heightResponse] = await Promise.all([
                messaging.governancePoll({ chainId, pollIndex, fresh: true }),
                typeof messaging.getIndexerWatermark === 'function'
                    ? messaging.getIndexerWatermark({ chainId, fresh: true }).catch(() => null)
                    : Promise.resolve(null),
            ]);
        } catch {
            return null;
        }
        const row = pollRowForDisplay(extractPoll(fresh));
        if (!row || !samePollIndex(row.action_index, pollIndex)) return null;
        const height = heightResponse?.watermark == null || heightResponse.watermark === ''
            ? null
            : Number(heightResponse.watermark);
        const usableHeight = Number.isFinite(height) ? height : null;
        const lastBlock = row.end_block == null || row.end_block === '' ? Number.NaN : Number(row.end_block);
        const terminal = Boolean(row.poll_status) && row.poll_status !== 'open';
        const endPassed = Number.isFinite(lastBlock) && usableHeight !== null && usableHeight > lastBlock;
        if (!terminal && !endPassed) return null;
        setPoll(row);
        if (usableHeight !== null) setCurrentHeight(usableHeight);
        const err = new Error('This poll closed while the review was open. Nothing was sent.');
        err.name = OFFER_LIFECYCLE_REFUSAL;
        return err;
    }

    // The wire params come from sdk.voting.castBallotParams, which lives
    // host-side, so compose goes through the VOTE-specific route rather than
    // re-implementing the ballot encoding here. A client-side mirror that
    // drifted would be SIGNED, not caught: the tamper check verifies the PSBT
    // against whatever params the encoder was handed.
    async function openConfirmScreen() {
        const from = sourceDescriptor();
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                compose: () => messaging.composeVoteForConfirm(withAdvancedOptions({
                    walletId,
                    chainId,
                    from,
                    builder: 'castBallotParams',
                    params: ballotParams(),
                    ...(feePerKb != null ? { feePerKb } : {}),
                })),
                onApprove: async (prebuiltPsbt) => {
                    const closed = await closedPollRefusal();
                    if (closed) throw closed;
                    return submitConfirmed({
                        walletId,
                        chainId,
                        from,
                        params: ballotParams(),
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    });
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || 'Vote failed.',
            }));
        }
    }

    // The ballot's own checks, run on Sign Vote, since Cast Vote can change
    // the choice the row tap made.
    function ballotError() {
        if (isSplit) {
            const enteredShares = Object.values(splitShares).filter((share) => String(share).trim() !== '');
            if (enteredShares.some((share) => !/^\d+(?:\.\d+)?$/.test(String(share).trim()) || Number(share) <= 0)) {
                return 'Each split share must be a positive plain number.';
            }
            if (enteredShares.length > maxSel) {
                return `Choose no more than ${maxSel} option${maxSel === 1 ? '' : 's'}.`;
            }
        }
        if (!buildBallot().length) return 'Choose at least one option.';
        return null;
    }

    // A choice row on the poll page: Cast Vote opens with that choice made,
    // as a bet outcome row opens Place Bet. A one-choice poll shows the
    // choice with Change; a poll taking several choices, or a split of
    // weight, opens the ballot with the tapped choice in it (a split gives
    // it the whole weight, share 1) so the voter can add others there.
    function voteFor(index) {
        // A demo wallet's rows stay enabled; the tap answers with the
        // refusal (G92: no standing demo notice, no demo-only disabled row).
        if (demoGuard.blocked) { demoGuard.refuse(); return; }
        if (isSplit) {
            setSplitShares({ [index]: '1' });
            setApprovalChoices(new Set());
        } else {
            setApprovalChoices(new Set([index]));
            setSplitShares({});
        }
        setFormError(null);
        setEditingBallot(isSplit || maxSel > 1);
        setStage('cast');
    }

    // Back from Cast Vote: the poll page; the next row tap sets the choice.
    function backToPoll() {
        setFormError(null);
        setEditingBallot(false);
        setStage('view');
    }

    function handleReview(event) {
        event.preventDefault();
        setValidationAttempt((n) => n + 1); // Reopens the section holding the error.
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        const voteBalanceComparison = compareDecimalStrings(voteBalance, '0');
        const ballotStop = ballotError();
        const memoError = memoLengthError(memo.trim());
        const valid = formErrors.validate({
            'form:poll-fee': feeStop?.formError,
            'poll-from-address': !fromAddress
                ? 'No address on this network to vote from.'
                : (voteBalanceComparison !== null && voteBalanceComparison !== 1
                    ? `This address must hold some ${poll.tick || 'governance token'} to vote.`
                    : null),
            'poll-ballot': options.length === 0 ? 'This poll has no voting options.' : ballotStop,
            'poll-memo': memoError,
        });
        if (!valid || feeStop) {
            if (ballotStop) setEditingBallot(true);
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const params = { pollRef: pollIndex, ballot: buildBallot(), ...(memo.trim() && { memo: memo.trim() }) };
            const from = {
                address: fromAddress.address,
                publicKey: fromAddress.publicKey,
                derivationPath: fromAddress.derivationPath,
                addressId: fromAddress.id,
                source: fromAddress.source,
                signerId: fromAddress.signerId,
            };
            // The air-gapped signer signs and broadcasts what is built here, so
            // the watcher build takes the same fresh read as Approve.
            const closed = await closedPollRefusal();
            if (closed) throw closed;
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId, from,
                    actionData: { action: 'VOTE', params: watcherWireParams },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else {
                const fn = isHwSource ? messaging.castBallotActionHw : messaging.castBallotAction;
                const args = isHwSource
                    ? { walletId, chainId, from, params, signerId: fromAddress.signerId, ...(feePerKb != null ? { feePerKb } : {}) }
                    : { walletId, chainId, from, params, password, ...(feePerKb != null ? { feePerKb } : {}) };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || 'Vote failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    // The ballot error leads the page, above the poll's terms, so a phone that
    // tapped Vote from the bottom of the form is taken to it.
    useEffect(() => {
        if (!formError) return;
        document.querySelector('main [role="alert"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [formError]);

    // A poll that closes under Cast Vote (a refresh, or the fresh read at
    // Approve) takes the form away: the poll page returns, its refusal first.
    const pollClosedUnderCast = stage === 'cast' && Boolean(poll) && !isOpen;
    useEffect(() => {
        if (pollClosedUnderCast) setStage('view');
    }, [pollClosedUnderCast]);
    const showCast = stage === 'cast' && !pollClosedUnderCast;

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting' || showCast}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('cast'); }
                : showCast ? backToPoll : onBack}
            backDisabled={stage === 'submitting'}
            // "Poll", as the bet page reads "Market"; the number is a Details fact.
            title={showCast || stage === 'review' || stage === 'submitting'
                ? t('governance.detail.castVoteTitle')
                : t('governance.detail.pageTitle')}
        />
    );
    const wrap = (children) => (embedded ? children : (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
        </Screen>
    ));

    if (loadError) {
        return wrap(
            <ListPage notices={<StatusMessage variant="error">{loadError}</StatusMessage>} />,
        );
    }
    if (!poll) return wrap(<ListPage><p>Loading poll…</p></ListPage>);

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(address) => {
                    setFromAddressId(address.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        const submittedBallot = buildBallot();
        const submittedChoice = isSplit
            ? submittedBallot.map((entry) => `${entry.option}: ${options[entry.option] ?? ''} (${entry.share} share)`).join(' · ')
            : submittedBallot.map((option) => `${option}: ${options[option] ?? ''}`).join(' · ');
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} />);
        }
        if (result?.psbtHex && !txid) {
            return wrap(<ResultScreen state="unsigned" result={result} onBuildAnother={() => setStage('view')} onDone={onBack} />);
        }
        return wrap(
            <ListPage>
                <p className={styles.summary}>Vote submitted. It counts once the network records it; voting weight is measured at the poll&apos;s close block.</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Your choice</dt>
                    <dd className={styles.detailsValue}>{submittedChoice}</dd>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}><Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button></div>
            </ListPage>,
        );
    }

    const outcome = pollOutcome(poll);
    const tally = pollResultSummary(results, options);
    const awaitingFinal = pollReportsOpen && blocksRemaining !== null && blocksRemaining < 0;
    const optionText = (index) => `${index}: ${options[index] ?? ''}`;
    const blockSeconds = targetBlockSecondsForCoin(descriptor?.coin);
    const timeLeft = blocksDurationText(blocksRemaining, blockSeconds);
    // "Closed 2 days ago" from the blocks since the close, at the chain's
    // target block time; plain "Voting closed" when the height is unknown.
    const closedAgo = !isOpen && blocksRemaining !== null && blocksRemaining < 0
        ? blocksDurationText(-blocksRemaining, blockSeconds)
        : null;
    let whenText = closedAgo ? `Closed ${closedAgo} ago` : t('governance.detail.votingClosed');
    if (isOpen && blocksRemaining === 0) whenText = t('governance.detail.finalBlock');
    else if (isOpen && timeLeft) whenText = t('governance.detail.closesIn', { time: timeLeft });
    else if (isOpen) whenText = t('governance.closesAtBlock', { block: String(poll.end_block ?? t('governance.detail.notAvailable')) });

    // Turnout against the poll's quorum, from the poll row's own counters
    // (written at finalization); a fraction of supply reads as a percentage.
    const percentOf = (fraction) => {
        const n = Number(fraction);
        return Number.isFinite(n) ? `${Number((n * 100).toFixed(4))}%` : String(fraction);
    };
    const flag = (value) => (value === true || String(value) === '1' ? true : value === false || String(value) === '0' ? false : null);
    const hasQuorum = poll.quorum !== null && poll.quorum !== undefined && poll.quorum !== '';
    const quorumMet = flag(poll.quorum_met);
    const turnoutText = joinSummary(
        poll.total_voters !== null && poll.total_voters !== undefined && poll.total_voters !== ''
            ? t('governance.detail.turnoutVoters', { count: formatWithThousands(String(poll.total_voters)) })
            : null,
        hasQuorum ? t(quorumMet === true ? 'governance.detail.quorumMet' : quorumMet === false ? 'governance.detail.quorumNotMet' : 'governance.detail.quorumNeeded', { quorum: percentOf(poll.quorum) }) : null,
    );
    const outcomeText = outcome ? {
        approved: t('governance.detail.outcome.approved'),
        rejected: t('governance.detail.outcome.rejected'),
        no_quorum: t('governance.detail.outcome.noQuorum'),
        decided: t('governance.detail.outcome.decided'),
    }[outcome] : null;
    const winnerKnown = poll.winning_option !== null && poll.winning_option !== undefined && poll.winning_option !== '';

    // Voters: the frozen count once finalized, else the distinct addresses
    // behind the accepted ballots in the poll's own read, but only when that
    // read is complete; a full page may have left voters out.
    const finalVoters = poll.total_voters !== null && poll.total_voters !== undefined && poll.total_voters !== ''
        ? Number(poll.total_voters)
        : null;
    const completeVotes = Array.isArray(pollVotes) && !pollVotesFailed && pollVotes.length < POLL_VOTE_LIMIT
        ? pollVotes.filter(isAcceptedVote)
        : null;
    const liveVoters = completeVotes ? new Set(completeVotes.map((row) => String(row?.source ?? ''))).size : null;
    const voterCount = Number.isFinite(finalVoters) ? finalVoters : liveVoters;
    const votersText = voterCount === null ? null
        : t(voterCount === 1 ? 'governance.detail.voter' : 'governance.detail.voters', { count: formatWithThousands(String(voterCount)) });
    // Votes: the accepted ballots in that same complete read. One ballot is
    // one VOTE action, which an approval or split ballot lists as a row per
    // choice, so rows are counted once per action; a later ballot from the
    // same address is a vote of its own (only the latest counts at the
    // close, which the voter count already reflects).
    const voteCount = completeVotes
        ? new Set(completeVotes.map((row, n) => String(row?.action_index ?? row?.tx_hash ?? `row-${n}`))).size
        : null;

    // Details: one fact list in the bet page's order (when it closes, how it
    // is decided, who runs it, the counts, the terms, the rules, then the
    // item's number last), so the two Details tabs read alike. The poll-only
    // facts (its token, how voting weight is measured, results counted at
    // the close) live here rather than in the hero.
    const weightMode = poll.weight_mode || 'balance';
    const factRows = [
        { key: 'end', label: 'Closes at block', value: String(poll.end_block ?? 'n/a') },
        ...(blocksRemaining !== null ? [{
            key: 'window',
            label: 'Voting window',
            value: blocksRemaining > 0
                ? `${blocksRemaining} block${blocksRemaining === 1 ? '' : 's'} remaining`
                : blocksRemaining === 0 ? 'Final voting block' : 'Voting closed',
        }] : []),
        { key: 'counted', label: t('governance.detail.countedLabel'), value: t('governance.detail.countedValue') },
        ...(poll.source ? [{ key: 'creator', label: t('governance.detail.creator'), value: <AddressText address={String(poll.source)} /> }] : []),
        ...(voteCount !== null ? [{ key: 'votes', label: t('governance.detail.votesCast'), value: formatWithThousands(String(voteCount)) }] : []),
        ...(voterCount !== null ? [{ key: 'voters', label: t('governance.detail.votersLabel'), value: formatWithThousands(String(voterCount)) }] : []),
        { key: 'token', label: t('send.fields.token'), value: poll.tick || t('governance.detail.notAvailable') },
        {
            key: 'weight',
            label: t('governance.detail.weightLabel'),
            value: weightMode === 'balance'
                ? t('governance.detail.weightBalance', { tick: poll.tick || t('send.fields.token') })
                : String(weightMode),
        },
        {
            key: 'ballot',
            label: t('governance.detail.ballotLabel'),
            value: isSplit ? t('governance.detail.ballotSplit')
                : maxSel > 1 ? t('governance.detail.ballotChooseUpTo', { count: String(maxSel) })
                    : t('governance.detail.ballotChooseOne'),
        },
        ...(hasQuorum ? [{ key: 'quorum', label: t('governance.detail.quorum'), value: t('governance.detail.ofSupply', { share: percentOf(poll.quorum) }) }] : []),
        ...(poll.min_voters ? [{ key: 'minVoters', label: t('governance.detail.minVoters'), value: formatWithThousands(String(poll.min_voters)) }] : []),
        ...(poll.min_vote_balance ? [{ key: 'minBalance', label: t('governance.detail.minBalance'), value: `${formatWithThousands(String(poll.min_vote_balance))} ${poll.tick || ''}`.trim() }] : []),
        ...(poll.decide_threshold ? [{ key: 'decide', label: t('governance.detail.earlyDecide'), value: t('governance.detail.ofSupply', { share: percentOf(poll.decide_threshold) }) }] : []),
        ...(poll.poll_status === 'finalized' ? [{
            key: 'winner',
            label: 'Winning option',
            value: poll.winning_option !== null && poll.winning_option !== undefined ? `${poll.winning_option}: ${options[poll.winning_option] ?? ''}` : 'none',
        }] : []),
        ...(descriptor ? [{ key: 'chain', label: t('send.fields.chain'), value: <ChainBadge descriptor={descriptor} size="sm" showName={false} /> }] : []),
        ...(poll.block_index !== null && poll.block_index !== undefined && poll.block_index !== ''
            ? [{ key: 'created', label: t('governance.detail.createdAt'), value: String(poll.block_index) }]
            : []),
        { key: 'number', label: t('governance.detail.pollNumber'), value: `#${String(pollIndex)}` },
    ];

    // What this wallet voted, the last lines of Result: "You voted: ...",
    // one line per voting address, which is named when there are two.
    const voteReceipt = (
        <div className={detailStyles.receipt}>
            {walletVotes === null ? (
                <p className={styles.hint}>Loading your vote…</p>
            ) : walletBallots.length ? (
                walletBallots.map(({ address, rows }) => (
                    <p className={detailStyles.youVoted} key={address} data-poll-you-voted="">
                        <span className={detailStyles.youVotedIcon} aria-hidden="true"><Icon.CheckIcon /></span>
                        <span className={detailStyles.youVotedText}>
                            {t('governance.detail.youVoted', { choice: rows.map((row) => ballotRowText(row, options, isSplit)).join(' · ') })}
                            {walletBallots.length > 1 ? <> · <AddressText address={address} /></> : null}
                        </span>
                    </p>
                ))
            ) : (
                <p className={styles.hint}>{voteLoadError
                    ? 'Your vote could not be loaded.'
                    : 'No direct vote from this wallet.'}</p>
            )}
        </div>
    );

    // Frozen results are unavailable while voting is open (weight is set at
    // the close block) and can be absent briefly after close while the
    // indexer finalizes the poll, so the hero and Result say so instead of
    // showing a tally.
    // A finalized poll names its winner as the indexer decided it (ties
    // included); before that the card names the option with the most weight.
    const winnerEntry = winnerKnown && poll.poll_status === 'finalized'
        ? tally.entries.find((entry) => entry.optionIndex === Number(poll.winning_option)) || null
        : null;
    let leadingText = null;
    if (winnerEntry) {
        leadingText = t('governance.detail.winner', { option: optionText(winnerEntry.optionIndex), share: String(winnerEntry.percent) });
    } else if (tally.leading) {
        leadingText = t('governance.detail.leading', { option: optionText(tally.leading.optionIndex), share: String(tally.leading.percent) });
    } else if (tally.tie) {
        leadingText = t('governance.detail.tied');
    }
    const noTallyText = isOpen
        ? t('governance.detail.countedAtClose')
        : pollReportsOpen ? t('governance.detail.finalizing') : t('governance.detail.noResults');

    // The shared outcome hero, fed as the bet page feeds it (operator ruling
    // 2026-11-13, "polls and bets are one section with one shared layout"):
    // the status and closing chips, the question, the winning or leading
    // option's share (or "Counted at close" while weight is still unset), the
    // legend and stacked split bar, and the standing foot with the votes and
    // voters where the prediction market shows its pool and positions and the
    // quorum where it shows its oracle. The shared fixed 0 to 100 chart draws
    // one line per answer. Governance exposes only the frozen close tally, so
    // those shares are flat and an open poll stays at zero with Counted at
    // close rather than pretending ballot counts are token voting weight.
    const statusText = awaitingFinal ? t('governance.detail.awaitingFinal') : pollStatusLabel(poll.poll_status, outcome);
    const heroChips = [
        {
            key: 'status',
            text: statusText,
            ...(outcome === 'approved' || outcome === 'decided' ? { tone: 'ok', icon: <Icon.VerifyIcon /> }
                : outcome === 'rejected' || outcome === 'no_quorum' ? { tone: 'bad', icon: <Icon.XIcon /> }
                    : { dot: isOpen ? 'open' : 'closed' }),
        },
        { key: 'closes', text: whenText, icon: <Icon.ClockIcon /> },
    ];
    // Turnout against the quorum. The indexer measures turnout as the counted
    // weight over the token's holder supply at the close block, and the poll
    // row carries the counted weight but not that supply, so the page draws
    // no turnout share or bar (today's supply would be a different measure
    // and could contradict the verdict). It states the quorum and the
    // indexer's own met flag.
    const quorumText = hasQuorum
        ? t(quorumMet === true ? 'governance.detail.quorumMet' : quorumMet === false ? 'governance.detail.quorumNotMet' : 'governance.detail.quorumNeeded', { quorum: percentOf(poll.quorum) })
        : null;
    // The counts, as the bet's "Pool 100 EXAMPLE · 2 bets": the figures in
    // bold, a part left out when its read is incomplete.
    const countParts = [
        voteCount === null ? null : (
            <span key="votes"><strong>{formatWithThousands(String(voteCount))}</strong> {voteCount === 1 ? t('governance.detail.voteUnit') : t('governance.detail.votesUnit')}</span>
        ),
        voterCount === null ? null : (
            <span key="voters"><strong>{formatWithThousands(String(voterCount))}</strong> {voterCount === 1 ? t('governance.detail.voterUnit') : t('governance.detail.votersUnit')}</span>
        ),
    ].filter(Boolean);
    // The votes and voters line is read-only, so it carries no help tip; the
    // ballot choice editor holds the delegation help.
    const heroFoot = countParts.length || quorumText ? (
        <p className={outcomeStyles.footLine} data-poll-hero-stats="">
            {countParts.length ? (
                <span data-poll-hero-counts="">
                    {countParts.map((part, n) => (n === 0 ? part : [' · ', part]))}
                </span>
            ) : null}
            {quorumText ? (
                <span className={`${outcomeStyles.footEnd} ${quorumMet === true ? outcomeStyles.footMet : quorumMet === false ? outcomeStyles.footMissed : ''}`}>
                    {quorumMet === true ? <span className={outcomeStyles.footIcon} aria-hidden="true"><Icon.CheckIcon /></span> : null}
                    {quorumText}
                </span>
            ) : null}
        </p>
    ) : null;
    // The lead: a finalized poll's winner as the indexer decided it, marked
    // Final as a settled share is; before that the option with the most
    // weight; a tie or a poll with no tally yet says so in its place.
    const leadEntry = winnerEntry || tally.leading;
    const heroLead = leadEntry ? {
        value: `${leadEntry.percent}%`,
        label: String(options[leadEntry.optionIndex] ?? ''),
        change: winnerEntry ? {
            text: t('governance.detail.final'),
            direction: 'final',
            label: t('governance.detail.finalResult'),
        } : null,
    } : null;
    const heroLeadMessage = tally.tie
        ? t('governance.detail.tied')
        : isOpen ? t('governance.detail.countedAtCloseShort') : noTallyText;
    const hasSplit = tally.entries.length > 0;
    const resultByOption = new Map(tally.entries.map((entry) => [entry.optionIndex, entry.percent]));
    const chartLines = options.map((_, optionIndex) => {
        const share = resultByOption.get(optionIndex) ?? 0;
        return { key: optionIndex, values: [share, share] };
    });
    const hero = (
        <OutcomeHero
            hasChart={true}
            chips={heroChips}
            title={poll.question || t('governance.pollNumber', { id: String(pollIndex) })}
            lead={heroLead}
            leadMessage={heroLeadMessage}
            lines={chartLines}
            chartLabel={hasSplit ? 'Frozen vote share by answer' : 'Vote shares are counted at the close block'}
            chartRegionLabel="Vote shares from 0% to 100%"
            legend={{
                label: t('governance.detail.shareOfEach'),
                items: options.map((option, optionIndex) => ({
                    key: optionIndex,
                    label: String(option),
                    value: `${resultByOption.get(optionIndex) ?? 0}%`,
                })),
            }}
            foot={heroFoot}
            ranges={POLL_RANGES}
            rangeId={rangeId}
            onRangeChange={setRangeId}
        />
    );

    // Result, once voting closes: the outcome, the final results list (the
    // winner marked) and what this wallet voted.
    // The verdict's sentences: the winner (or leader) with its share, then
    // turnout against the quorum.
    const verdictBody = [leadingText, turnoutText].filter(Boolean).join('. ') || null;
    const verdict = outcomeText ? {
        title: outcomeText,
        tone: outcome === 'rejected' || outcome === 'no_quorum' ? 'error' : 'success',
        body: verdictBody,
    } : {
        title: statusText,
        tone: 'info',
        body: tally.entries.length ? verdictBody : noTallyText,
    };
    const resultPanel = (
        <OutcomeResult
            verdict={verdict}
            icon={<Icon.VerifyIcon />}
            title={poll.poll_status === 'finalized' ? 'Final Results' : t('governance.detail.results')}
            aside={votersText || undefined}
            rows={tally.entries.map((entry) => ({
                key: entry.optionIndex,
                label: optionText(entry.optionIndex),
                sub: joinSummary(
                    t('governance.detail.weight', { weight: formatWithThousands(String(entry.weight)) }),
                    t(entry.voters === 1 ? 'governance.detail.voter' : 'governance.detail.voters', { count: formatWithThousands(String(entry.voters)) }),
                ),
                percent: entry.percent,
                value: `${entry.percent}%`,
                winner: Boolean(winnerEntry) && winnerEntry.optionIndex === entry.optionIndex,
            }))}
            winnerLabel="Winner"
            empty={<p className={styles.hint}>{noTallyText}</p>}
            footer={voteReceipt}
        />
    );

    // The confirm page, rendered in place of the poll while the
    // single-encode pipeline is live. The intent is decoded from the params
    // the HOST composed (the SDK's own ballot encoding), never from the
    // editor state, per §1: confirm what will broadcast.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: t('governance.detail.vote'),
                    target: String(poll?.question || '').trim() || t('governance.pollNumber', { id: String(pollIndex) }),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                // Fallback only: the composed PSBT's exact fee wins (§5.2.5).
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const ballot = buildBallot();
        const shown = isSplit
            ? ballot.map((e) => `${e.option}: ${options[e.option] ?? ''} (${e.share})`).join(' · ')
            : ballot.map((i) => `${i}: ${options[i] ?? ''}`).join(' · ');
        return (
            <ConfirmActionModal
                phase={stage === 'submitting' ? 'signing' : 'ready'}
                composed={legacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={stage === 'review'}
                onApprove={() => handleSubmit({ preventDefault() {} })}
                onReject={() => { setSubmitError(null); setStage('cast'); }}
                decoded={legacyDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('governance.detail.vote'),
                    target: String(poll?.question || '').trim() || t('governance.pollNumber', { id: String(pollIndex) }),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: [{ label: 'Your choice', value: shown }],
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // The ballot itself: approval checkboxes up to max_selections, or a share
    // input per option for split weight. The poll page's Vote toggle and
    // Cast Vote's Change both draw it; only one of them shows at a time.
    const ballotEditor = (
        <>
            <div id="poll-ballot" role="group" aria-labelledby={ballotLabelId}>
                <div className={detailStyles.ballotLabelRow}>
                    <span id={ballotLabelId} className={styles.fromLabel}>{isSplit ? 'Split your weight across options' : `Choose up to ${maxSel} option${maxSel > 1 ? 's' : ''}`}</span>
                    <InfoTip aria="About ballot choices"
                        label={`Choose the option or options this address supports. A direct vote overrides any standing ${poll.tick || 'token'} delegation. Delegated weight counts only when the delegate votes, and it does not add another voter.`} />
                </div>
                <div className={detailStyles.ballotOptions}>
                {options.map((label, i) => (
                    isSplit ? (
                        <div key={i} className={detailStyles.splitOptionRow}>
                            <div className={detailStyles.splitOptionInput}>
                                <Input label={`${i}: ${label}`} help="The positive share of this address's voting weight assigned to this option."
                                    value={splitShares[i] || ''} inputMode="numeric"
                                    onChange={(e) => {
                                        formErrors.clear('poll-ballot');
                                        setSplitShares((prev) => ({ ...prev, [i]: e.target.value }));
                                    }}
                                    placeholder="share" autoComplete="off" />
                            </div>
                        </div>
                    ) : (
                        <Checkbox
                            key={i}
                            className={detailStyles.optionRow}
                            label={<span className={detailStyles.optionLabel}>{i}: {label}</span>}
                            checked={approvalChoices.has(i)}
                            disabled={!approvalChoices.has(i) && approvalChoices.size >= maxSel}
                            onChange={() => toggleApproval(i)}
                        />
                    )
                ))}
                </div>
            </div>
            {options.length === 0 ? <p className={styles.hint}>This poll has no voting options.</p> : null}
        </>
    );
    const chosenText = (() => {
        const ballot = buildBallot();
        return isSplit
            ? ballot.map((entry) => `${entry.option}: ${options[entry.option] ?? ''} (${entry.share} share)`)
            : ballot.map((option) => `${option}: ${options[option] ?? ''}`);
    })();

    // The section each Sign Vote error belongs to, so it reopens on each press.
    const feeStopNow = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
    const errorSection = (() => {
        if (!formError) return null;
        if (feeStopNow && formError === feeStopNow.formError) return 'fee';
        if (/address/i.test(formError)) return 'from';
        if (/^Memo/i.test(formError)) return 'memo';
        return 'vote';
    })();
    const sectionErrorKey = (id) => (errorSection && (errorSection === id || id === 'vote') ? validationAttempt + 1 : 0);

    // Cast Vote, its own step: the Form Standard form (From, the vote, Memo,
    // Network fee, Sign Vote) that leads to the shared confirm screen.
    if (showCast) {
        return wrap(
            <FormFrame
                demoGuard={demoGuard}
                className={detailStyles.ballotForm}
                label={t('governance.detail.castVoteTitle')}
                onSubmit={handleReview}
                errors={formErrors}
                status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
                action={(
                    <FormAction
                        icon={<Icon.SignIcon />}
                        loading={actionConfirm.composing}
                    >
                        {t('governance.detail.signVote')}
                    </FormAction>
                )}
                from={(
                    <FromSection
                        {...sections.bind('from')}
                        chainId={chainId}
                        chainRegistry={chainRegistry}
                        lockNetwork
                        networkHelp={t('governance.detail.networkHelp')}
                        address={fromAddress?.address || null}
                        addressId="poll-from-address"
                        formErrorKey="poll-from-address"
                        onOpenPicker={() => setSourcePickerOpen(true)}
                        pickerLabel="Choose voting address"
                        addressHelp="The address casting this ballot. Its governance-token balance determines this vote's weight."
                        missing={addressesByChain ? (
                            <p className={styles.hint}>No address on this network. Use Receive to generate one, then vote.</p>
                        ) : null}
                        revealKey={sectionErrorKey('from')}
                    />
                )}
                fee={feeTiers ? (
                    <FeeSection
                        {...sections.bind('fee')}
                        chainId={chainId}
                        coinTicker={coinTicker}
                        tiers={feeTiers}
                        value={feePick}
                        onChange={setFeePick}
                        customEstimate={feeCustomEstimate}
                        revealKey={sectionErrorKey('fee')}
                    />
                ) : null}
            >
                {/* The vote: the poll's question, then the chosen options with
                    Change, which opens the ballot in place to edit them. */}
                <FormSection
                    id="vote"
                    title={t('governance.detail.vote')}
                    icon={Icon.ThumbsUpIcon}
                    {...sections.bind('vote')}
                    revealKey={sectionErrorKey('vote')}
                    summary={chosenText.join(' · ') || t('send.advanced.none')}
                >
                    <p className={styles.hint}>{poll.question || t('governance.pollNumber', { id: String(pollIndex) })}</p>
                    {/* Picking another From address seeds the ballot from that
                        address's own vote, which can be none: with nothing
                        chosen the editor shows, never an empty list. */}
                    {editingBallot || chosenText.length === 0 ? ballotEditor : (
                        <div className={detailStyles.chosen}>
                            <ul className={detailStyles.chosenList} aria-label={t('governance.detail.yourVoteLabel')} data-poll-chosen="">
                                {chosenText.map((text) => (
                                    <li className={detailStyles.chosenItem} key={text}>{text}</li>
                                ))}
                            </ul>
                            <Button
                                variant="link"
                                size="sm"
                                icon={<Icon.PencilIcon />}
                                aria-label={t('governance.detail.changeChoice')}
                                onClick={() => setEditingBallot(true)}
                            >
                                {t('governance.detail.change')}
                            </Button>
                        </div>
                    )}
                    {voteBalance !== null && voteBalance !== undefined ? (
                        <p className={styles.hint}>{t('governance.detail.votingWeight', { amount: formatWithThousands(String(voteBalance)), tick: poll.tick || '' })}</p>
                    ) : null}
                </FormSection>
                {/* An optional section holding only the memo: its title
                    names the field and carries its count. */}
                <MemoSection
                    inputId="poll-memo"
                    {...sections.bind('memo')}
                    revealKey={sectionErrorKey('memo')}
                    maxLength={MAX_MEMO_LENGTH}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                />
            </FormFrame>,
        );
    }

    // The poll page: a demo wallet's refusal (only once Vote was pressed), or
    // the refusal of a poll that closed under Cast Vote or its confirm
    // screen, leads the page. Nothing is drawn while neither has happened.
    const pageNotices = (isOpen && demoGuard.note) || (!isOpen && formError) ? (
        <>
            {isOpen ? demoGuard.note : null}
            {!isOpen && formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
        </>
    ) : null;

    // The shared tab strip: Vote while the poll is open, Result once it
    // closes, then Activity and Details.
    const tabItems = [
        isOpen
            ? { id: 'vote', label: t('governance.detail.vote'), icon: <Icon.ThumbsUpIcon /> }
            : { id: 'result', label: 'Result', icon: <Icon.VerifyIcon /> },
        { id: 'activity', label: 'Activity', icon: <Icon.HistoryIcon /> },
        { id: 'details', label: t('tokenDetail.tabs.details'), icon: <Icon.InfoIcon /> },
    ];
    const hasRules = hasQuorum || Boolean(poll.min_voters) || Boolean(poll.min_vote_balance) || Boolean(poll.decide_threshold);

    // Vote: the bet market's Bet tab (operator ruling 2026-11-13). The head
    // keeps the ballot's title, help tip and how many choices it takes; then
    // one list card with a row per choice (its mark, its name, a chevron),
    // and the whole row opens Cast Vote with that choice. There is no
    // checkbox and no separate Vote button. Weight is counted only at the
    // close (results are read once voting ends, and this tab shows only
    // while it is open), so a row carries no votes, share or fill rather
    // than a made-up 0%. Rows stay buttons after this wallet has voted, as
    // bet rows do after a bet: a later vote replaces the earlier one until
    // the close. What this wallet voted sits under the list, like the bet's
    // held line. A closed poll swaps this tab for Result, like a closed market.
    const choiceOptions = options.map((label, i) => {
        const name = String(label ?? '');
        return {
            key: i,
            label: name,
            mark: outcomeMarkOf(options, i),
            staked: null,
            chance: null,
            percent: null,
            name: t('governance.detail.voteFor', { option: name }),
            disabled: !fromAddress,
            onSelect: () => voteFor(i),
        };
    });
    const votePanel = (
        <section className={outcomeStyles.action} aria-label={t('governance.detail.choiceList')} data-poll-vote-panel="">
            {/* No head: the choice rows follow the tab directly. The
                delegation help is the ballot editor's tip on Cast Vote (G121:
                help sits only beside an editable field). */}
            <OutcomeList label={t('governance.detail.choiceList')} options={choiceOptions} />
            {options.length === 0 ? (
                <p className={styles.hint}>This poll has no voting options.</p>
            ) : addressesByChain && !fromAddress ? (
                // The choice rows stay disabled with no address here, so the page says why.
                <p className={styles.hint} data-poll-no-address="">No address on this network. Use Receive to generate one, then vote.</p>
            ) : null}
            {sourceBallot.length ? <p className={styles.hint}>You can change this address&apos;s vote until the poll closes. The latest confirmed vote from this address replaces its earlier vote.</p> : null}
            <FormStatusSlot status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null} />
            {walletBallots.length || voteLoadError ? voteReceipt : null}
        </section>
    );

    // Activity: the ballots cast on this poll, newest first; this wallet's
    // own are marked.
    const ownAddresses = new Set((addressesByChain?.[chainId] || []).map((a) => String(a.address)));
    const recentVotes = (Array.isArray(pollVotes) ? pollVotes : [])
        .slice()
        .sort((a, b) => Number(b?.action_index || 0) - Number(a?.action_index || 0));
    const activityPanel = (
        <>
            {pollVotes === null ? <p className={styles.hint}>Loading votes…</p> : null}
            {pollVotesFailed ? <StatusMessage variant="error">Could not load the votes on this poll.</StatusMessage> : null}
            {pollVotes !== null && !pollVotesFailed && recentVotes.length === 0 ? (
                // The bet page's empty state, worded for votes.
                <EmptyState data-poll-activity-empty="" title={isOpen ? 'No votes yet' : 'No votes'} body="Votes cast on this poll appear here." titleAs="p" />
            ) : null}
            {recentVotes.length ? (
                <OutcomeActivity
                    rows={recentVotes.map((row, n) => {
                        const invalid = !isAcceptedVote(row);
                        // A thumb for a Yes or No vote, else the choice's
                        // letter on its colour, as the bet market's Activity.
                        // A missing choice reads as unknown, never as choice 0.
                        const choice = row?.choice ?? row?.option_index;
                        const mark = outcomeMarkOf(options, choice === null || choice === undefined || choice === '' ? Number.NaN : choice);
                        return {
                            key: `${String(row?.action_index ?? row?.tx_hash ?? n)}:${String(row?.choice ?? row?.option_index ?? '')}`,
                            title: ballotRowText(row, options, isSplit),
                            amount: null,
                            icon: <OutcomeMark tone={mark.tone} letter={mark.letter} shape="round" />,
                            meta: [
                                ...(row?.source ? [{ key: 'source', text: String(row.source) }] : []),
                                ...(ownAddresses.has(String(row?.source)) ? [{ key: 'mine', text: 'You', tone: 'mine' }] : []),
                                { key: 'when', text: `block ${String(row?.block_index ?? 'n/a')}` },
                                ...(invalid ? [{ key: 'status', text: 'Rejected', tone: 'danger' }] : []),
                            ],
                        };
                    })}
                />
            ) : null}
            {recentVotes.length >= POLL_VOTE_LIMIT ? (
                <p className={styles.hint}>
                    The read stopped at {POLL_VOTE_LIMIT} ballot rows, so some votes may not be listed.
                </p>
            ) : null}
        </>
    );

    // Details: the one fact list (its rules among the facts, as the bet's
    // terms are), then the note card.
    const detailsPanel = (
        <>
            <OutcomeFacts label={t('governance.detail.detailsLabel')} rows={factRows} />
            {/* The explanatory note sits in the wallet's one notice card (G90),
                8px under the facts. */}
            {hasRules ? null : (
                <WarningCard data-poll-details-note="">
                    <WarningLine>{t('governance.detail.noRules')}</WarningLine>
                </WarningCard>
            )}
        </>
    );

    return wrap(
        <ListPage notices={pageNotices}>
            <OutcomeDetailLayout
                hero={hero}
                tabs={tabItems}
                tab={tab}
                onTabChange={setTab}
                tabsLabel={t('governance.detail.sections')}
                panels={{
                    vote: isOpen ? votePanel : null,
                    result: isOpen ? null : resultPanel,
                    activity: activityPanel,
                    details: detailsPanel,
                }}
            />
            {demoGuard.dialog}
        </ListPage>,
    );
}
