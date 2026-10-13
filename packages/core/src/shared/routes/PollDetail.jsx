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
import {
    AddressText,
    Button,
    ChainBadge,
    FeeSelector,
    FormPage,
    Input,
    ListPage,
    PageHeader,
    Screen,
    SectionHeader,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

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

function statusLabel(status) {
    if (status === 'failed_quorum') return 'Did not pass';
    if (status === 'finalized') return 'Decided';
    if (status === 'open' || !status) return 'Open';
    const words = String(status).trim().toLowerCase().replace(/[_-]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function votePollRef(vote) {
    return vote?.poll_index ?? vote?.poll_action_index ?? vote?.poll_ref;
}

function latestBallotRows(rows, address) {
    const matching = rows.filter((row) => String(row?.source ?? '') === String(address));
    if (!matching.length) return [];
    const latestAction = matching.reduce((latest, row) => {
        const actionIndex = Number(row?.action_index);
        return Number.isFinite(actionIndex) ? Math.max(latest, actionIndex) : latest;
    }, Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(latestAction)) return matching;
    return matching.filter((row) => Number(row?.action_index) === latestAction);
}

function ballotRowText(row, options, isSplit) {
    const option = Number(row?.choice ?? row?.option_index);
    const label = Number.isInteger(option) ? `${option}: ${options[option] ?? ''}` : 'Unknown option';
    return isSplit ? `${label} (${String(row?.share ?? '0')} share)` : label;
}

/**
 * VOTE poll detail: the poll definition, its frozen per-option results (once
 * finalized), and, while the poll is open, an inline cast-ballot form (VOTE v1).
 * The ballot editor adapts to tally mode: approval = option checkboxes (capped
 * at max_selections); split = a per-option share input. Signing reuses the same
 * chassis as the authoring forms.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string | number} props.pollIndex
 * @param {() => void} props.onBack
 */
export function PollDetail({ walletId, chainId, pollIndex, onBack }) {
    const { messaging, shell } = useMessaging();
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

    // Ballot editor state. Approval: Set of chosen option indices. Split: map of
    // option index -> share string.
    const [approvalChoices, setApprovalChoices] = useState(/** @type {Set<number>} */ (new Set()));
    const [splitShares, setSplitShares] = useState(/** @type {Record<number, string>} */ ({}));
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(/** @type {'view' | 'review' | 'submitting' | 'done'} */ ('view'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
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
                const loadedPoll = extractPoll(p);
                if (!loadedPoll) {
                    if (firstLoad) setLoadError('Poll not found.');
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
                    if (!cancelled) setResults(extractRows(r));
                } else {
                    setResults(null);
                }
            } catch (err) {
                if (!cancelled && firstLoad) setLoadError(err?.message || 'Failed to load poll.');
            } finally {
                firstLoad = false;
            }
        }
        refreshPoll();
        const refreshTimer = setInterval(refreshPoll, 30_000);
        return () => { cancelled = true; clearInterval(refreshTimer); };
    }, [chainId, pollIndex, messaging]);

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
        if (!addressesByChain) return undefined;
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
    }, [addressesByChain, chainId, pollIndex, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

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
    const initializedEditorRef = useRef('');

    useEffect(() => {
        if (!poll || !fromAddress || walletVotes === null) return;
        const editorKey = `${chainId}:${String(pollIndex)}:${fromAddress.id}`;
        if (initializedEditorRef.current === editorKey) return;
        initializedEditorRef.current = editorKey;
        if (isSplit) {
            setSplitShares(Object.fromEntries(sourceBallot.map((row) => [
                Number(row.choice ?? row.option_index), String(row.share ?? ''),
            ])));
            setApprovalChoices(new Set());
        } else {
            setApprovalChoices(new Set(sourceBallot
                .map((row) => Number(row.choice ?? row.option_index))
                .filter(Number.isInteger)));
            setSplitShares({});
        }
    }, [chainId, fromAddress, isSplit, poll, pollIndex, sourceBallot, walletVotes]);

    function toggleApproval(i) {
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
                compose: () => messaging.composeVoteForConfirm({
                    walletId,
                    chainId,
                    from,
                    builder: 'castBallotParams',
                    params: ballotParams(),
                    ...(feePerKb != null ? { feePerKb } : {}),
                }),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: ballotParams(),
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
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

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) { setFormError('No address on this chain to vote from.'); return; }
        if (isSplit) {
            const enteredShares = Object.values(splitShares).filter((share) => String(share).trim() !== '');
            if (enteredShares.some((share) => !Number.isFinite(Number(share)) || Number(share) <= 0)) {
                setFormError('Each split share must be a positive number.');
                return;
            }
            if (enteredShares.length > maxSel) {
                setFormError(`Choose no more than ${maxSel} option${maxSel === 1 ? '' : 's'}.`);
                return;
            }
        }
        const ballot = buildBallot();
        if (!ballot.length) { setFormError('Choose at least one option.'); return; }
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
            let res;
            if (isWatcherMode) {
                const wireBallot = isSplit
                    ? buildBallot().map((e) => `${e.option}:${e.share}`).join(',')
                    : buildBallot().join(',');
                res = await messaging.buildActionPsbtRequest({
                    chainId, from,
                    actionData: { action: 'VOTE', params: { VERSION: '1', POLL_REF: String(pollIndex), BALLOT: wireBallot, ...(memo.trim() && { MEMO: memo.trim() }) } },
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

    const header = <PageHeader onBack={onBack} title={`Poll #${String(pollIndex)}`} />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            </>,
        );
    }
    if (!poll) return wrap(<p>Loading poll…</p>);

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
            return wrap(<QueuedResultPanel onDone={onBack} unsaved={result.unsaved} />);
        }
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={() => setStage('view')} onDone={onBack} />);
        }
        return wrap(
            <ListPage>
                <p className={styles.summary}>Ballot cast. It counts once the network records the action; weight is measured at the poll's close block.</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Your choice</dt>
                    <dd className={styles.detailsValue}>{submittedChoice}</dd>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}><Button variant="primary" onClick={onBack}>Done</Button></div>
            </ListPage>,
        );
    }

    const pollInfo = (
        <dl className={styles.detailsList}>
            <dt className={styles.detailsLabel}>Chain</dt>
            <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
            <dt className={styles.detailsLabel}>Token</dt>
            <dd className={styles.detailsValue}>{poll.tick || 'n/a'}</dd>
            {poll.question ? (<><dt className={styles.detailsLabel}>Question</dt><dd className={styles.detailsValue}>{poll.question}</dd></>) : null}
            <dt className={styles.detailsLabel}>Status</dt>
            <dd className={styles.detailsValue}>{pollReportsOpen && blocksRemaining !== null && blocksRemaining < 0
                ? 'Awaiting finalization'
                : statusLabel(poll.poll_status)}</dd>
            <dt className={styles.detailsLabel}>Mode</dt>
            <dd className={styles.detailsValue}>{poll.tally_mode || 'approval'} / {poll.weight_mode || 'balance'}</dd>
            <dt className={styles.detailsLabel}>Closes at block</dt>
            <dd className={styles.detailsValue}>{String(poll.end_block ?? 'n/a')}</dd>
            {blocksRemaining !== null ? (
                <>
                    <dt className={styles.detailsLabel}>Voting window</dt>
                    <dd className={styles.detailsValue}>{blocksRemaining > 0
                        ? `${blocksRemaining} block${blocksRemaining === 1 ? '' : 's'} remaining`
                        : blocksRemaining === 0 ? 'Final voting block' : 'Voting closed'}</dd>
                </>
            ) : null}
            {poll.poll_status === 'finalized' ? (
                <>
                    <dt className={styles.detailsLabel}>Winning option</dt>
                    <dd className={styles.detailsValue}>{poll.winning_option !== null && poll.winning_option !== undefined ? `${poll.winning_option}: ${options[poll.winning_option] ?? ''}` : 'none'}</dd>
                </>
            ) : null}
        </dl>
    );

    const voteReceipt = (
        <div style={{ marginTop: '0.75rem' }}>
            <SectionHeader title="Your vote" />
            {walletVotes === null ? (
                <p className={styles.hint}>Loading your ballot…</p>
            ) : walletBallots.length ? (
                walletBallots.map(({ address, rows }) => (
                    <dl className={styles.detailsList} key={address}>
                        <dt className={styles.detailsLabel}>Address</dt>
                        <dd className={styles.detailsValue}><AddressText address={address} /></dd>
                        <dt className={styles.detailsLabel}>Choice</dt>
                        <dd className={styles.detailsValue}>{rows.map((row) => ballotRowText(row, options, isSplit)).join(' · ')}</dd>
                    </dl>
                ))
            ) : (
                <p className={styles.hint}>{voteLoadError
                    ? 'Your ballot could not be loaded.'
                    : 'No direct ballot from this wallet.'}</p>
            )}
            <p className={styles.hint}>A direct ballot overrides any standing {poll.tick || 'token'} delegation. Delegated weight counts only when the delegate votes, and it does not add another voter.</p>
            {isOpen && sourceBallot.length ? <p className={styles.hint}>You can change this address's vote until the poll closes. The latest confirmed ballot replaces its earlier ballot.</p> : null}
        </div>
    );

    // Frozen results are unavailable while voting is open and can be absent
    // briefly after close while the indexer finalizes the poll.
    const resultsBlock = (
        <div style={{ marginTop: '0.75rem' }}>
            <SectionHeader title="Results" />
            {results && results.length ? (
                <table className={styles.compactTable}>
                    <thead><tr><th style={{ textAlign: 'left' }}>Option</th><th style={{ textAlign: 'right' }}>Weight</th><th style={{ textAlign: 'right' }}>Voters</th></tr></thead>
                    <tbody>
                        {results.map((r) => (
                            <tr key={String(r.option_index)}>
                                <td>{r.option_index}: {options[r.option_index] ?? ''}</td>
                                <td style={{ textAlign: 'right' }}>{String(r.total_weight ?? '0')}</td>
                                <td style={{ textAlign: 'right' }}>{String(r.voter_count ?? '0')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <p className={styles.hint}>
                    {isOpen
                        ? 'Final results appear after voting closes.'
                        : pollReportsOpen ? 'Final results are being finalized.' : 'No finalized results are available.'}
                </p>
            )}
        </div>
    );

    // The confirm page, rendered in place of the poll while the
    // single-encode pipeline is live. The intent is decoded from the params
    // the HOST composed (the SDK's own ballot encoding), never from the
    // editor state, per §1: confirm what will broadcast.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                // Fallback only: the composed PSBT's exact fee wins (§5.2.5).
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
        return wrap(
            <FormPage
                label="Review ballot"
                onSubmit={handleSubmit}
                status={(isWatcherMode || isHwSource) && submitError
                    ? <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                    : null}
                actions={(
                    <>
                        <Button type="button" variant="ghost" onClick={() => setStage('view')} disabled={stage === 'submitting'}>Back</Button>
                        <Button type="submit" variant="primary" loading={stage === 'submitting'}
                            disabled={isWatcherMode ? false : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)}>
                            {isWatcherMode ? 'Create unsigned transaction' : isHwSource ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Cast ballot'}
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>Vote on poll #{String(pollIndex)} ({poll.tick}).</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>Your choice</dt>
                    <dd className={styles.detailsValue}>{shown}</dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>Watcher mode: this wallet will build an unsigned transaction. Sign it on your Signer-mode wallet, then broadcast from a Full-mode wallet.</p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
            </FormPage>,
        );
    }

    return wrap(
        <ListPage>
            {pollInfo}
            {voteReceipt}
            {resultsBlock}
            {isOpen ? (
                <FormPage
                    label={sourceBallot.length ? 'Change ballot' : 'Cast ballot'}
                    onSubmit={handleReview}
                    status={formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}
                    actions={<Button type="submit" variant="primary" disabled={!fromAddress || options.length === 0}>{sourceBallot.length ? 'Change vote' : 'Vote'}</Button>}
                >
                    <span className={styles.fromLabel}>{isSplit ? 'Split your weight across options' : `Choose up to ${maxSel} option${maxSel > 1 ? 's' : ''}`}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.4rem' }}>
                        {options.map((label, i) => (
                            isSplit ? (
                                <div key={i} className={styles.choiceRow} style={{ alignItems: 'flex-end' }}>
                                    <div style={{ flex: 1 }}>
                                        <Input label={`${i}: ${label}`} value={splitShares[i] || ''} inputMode="numeric"
                                            onChange={(e) => setSplitShares((prev) => ({ ...prev, [i]: e.target.value }))}
                                            placeholder="share" autoComplete="off" />
                                    </div>
                                </div>
                            ) : (
                                <label key={i} className={styles.choiceRow}>
                                    <input type="checkbox" checked={approvalChoices.has(i)}
                                        disabled={!approvalChoices.has(i) && approvalChoices.size >= maxSel}
                                        onChange={() => toggleApproval(i)} />
                                    <span className={styles.choiceText}>{i}: {label}</span>
                                </label>
                            )
                        ))}
                    </div>
                    {options.length === 0 ? <p className={styles.hint}>This poll has no voting options.</p> : null}
                    <Input label="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />
                    {feeTiers ? (
                        <FeeSelector
                            label="Network fee"
                            coinTicker={coinTicker}
                            tiers={feeTiers}
                            value={feePick}
                            onChange={setFeePick}
                            customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                        />
                    ) : null}
                    {!fromAddress ? <p className={styles.hint}>No address on this chain. Use Receive to generate one, then vote.</p> : null}
                </FormPage>
            ) : (
                <p className={styles.hint} style={{ marginTop: '0.75rem' }}>Voting is closed for this poll.</p>
            )}
        </ListPage>,
    );
}
