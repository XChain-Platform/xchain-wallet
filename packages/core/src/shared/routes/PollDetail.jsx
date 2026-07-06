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
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
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
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

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
        setPoll(null); setResults(null); setLoadError(null);
        Promise.all([
            messaging.governancePoll({ chainId, pollIndex }),
            messaging.governancePollResults({ chainId, pollIndex }).catch(() => null),
        ])
            .then(([p, r]) => {
                if (cancelled) return;
                setPoll(p || null);
                setResults(extractRows(r));
            })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load poll.'); });
        return () => { cancelled = true; };
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

    const options = Array.isArray(poll?.options) ? poll.options : [];
    const isSplit = poll?.tally_mode === 'split';
    const maxSel = Number(poll?.max_selections) || 1;
    const isOpen = !poll?.poll_status || poll.poll_status === 'open';

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

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) { setFormError('No address on this chain to vote from.'); return; }
        const ballot = buildBallot();
        if (!ballot.length) { setFormError('Choose at least one option.'); return; }
        setFormError(null);
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
                });
            } else {
                const fn = isHwSource ? messaging.castBallotActionHw : messaging.castBallotAction;
                const args = isHwSource
                    ? { walletId, chainId, from, params, signerId: fromAddress.signerId }
                    : { walletId, chainId, from, params, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : err?.message || 'Vote failed.');
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    const header = <PageHeader onBack={onBack} title={`Poll #${String(pollIndex)}`} />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!poll) return wrap(<p>Loading poll…</p>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={() => setStage('view')} onDone={onBack} />);
        }
        return wrap(
            <>
                <p className={styles.summary}>Ballot cast. It counts once the network records the action; weight is measured at the poll's close block.</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}><Button variant="primary" onClick={onBack}>Done</Button></div>
            </>,
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
            <dd className={styles.detailsValue}>{poll.poll_status || 'open'}</dd>
            <dt className={styles.detailsLabel}>Mode</dt>
            <dd className={styles.detailsValue}>{poll.tally_mode || 'approval'} / {poll.weight_mode || 'balance'}</dd>
            <dt className={styles.detailsLabel}>Closes at block</dt>
            <dd className={styles.detailsValue}>{String(poll.end_block ?? 'n/a')}</dd>
            {poll.poll_status === 'finalized' ? (
                <>
                    <dt className={styles.detailsLabel}>Winning option</dt>
                    <dd className={styles.detailsValue}>{poll.winning_option !== null && poll.winning_option !== undefined ? `${poll.winning_option}: ${options[poll.winning_option] ?? ''}` : 'none'}</dd>
                </>
            ) : null}
        </dl>
    );

    // Finalized results table (frozen per-option tally).
    const resultsBlock = results && results.length ? (
        <div style={{ marginTop: '0.75rem' }}>
            <span className={styles.fromLabel}>Results</span>
            <table style={{ width: '100%', fontSize: '0.85rem' }}>
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
        </div>
    ) : null;

    if (stage === 'review' || stage === 'submitting') {
        const ballot = buildBallot();
        const shown = isSplit
            ? ballot.map((e) => `${e.option}: ${options[e.option] ?? ''} (${e.share})`).join(' · ')
            : ballot.map((i) => `${i}: ${options[i] ?? ''}`).join(' · ');
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>Vote on poll #{String(pollIndex)} ({poll.tick}).</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>Your choice</dt>
                    <dd className={styles.detailsValue}>{shown}</dd>
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
                {(isWatcherMode || isHwSource) && submitError ? (<div role="alert" className={styles.error}>{submitError}</div>) : null}
                <div className={styles.actions}>
                    <Button type="button" variant="ghost" onClick={() => setStage('view')} disabled={stage === 'submitting'}>Back</Button>
                    <Button type="submit" variant="primary" loading={stage === 'submitting'}
                        disabled={isWatcherMode ? false : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)}>
                        {isWatcherMode ? 'Create unsigned transaction' : isHwSource ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Cast ballot'}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <>
            {pollInfo}
            {resultsBlock}
            {isOpen ? (
                <form onSubmit={handleReview} noValidate style={{ marginTop: '0.75rem' }}>
                    <span className={styles.fromLabel}>{isSplit ? 'Split your weight across options' : `Choose up to ${maxSel} option${maxSel > 1 ? 's' : ''}`}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.4rem' }}>
                        {options.map((label, i) => (
                            isSplit ? (
                                <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                    <div style={{ flex: 1 }}>
                                        <Input label={`${i}: ${label}`} value={splitShares[i] || ''} inputMode="numeric"
                                            onChange={(e) => setSplitShares((prev) => ({ ...prev, [i]: e.target.value }))}
                                            placeholder="share" autoComplete="off" />
                                    </div>
                                </div>
                            ) : (
                                <label key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input type="checkbox" checked={approvalChoices.has(i)} onChange={() => toggleApproval(i)} />
                                    <span>{i}: {label}</span>
                                </label>
                            )
                        ))}
                    </div>
                    <Input label="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />
                    {formError ? <div role="alert" className={styles.error}>{formError}</div> : null}
                    <div className={styles.actions}>
                        <Button type="submit" variant="primary" disabled={!fromAddress}>Vote</Button>
                    </div>
                    {!fromAddress ? <p className={styles.hint}>No address on this chain. Use Receive to generate one, then vote.</p> : null}
                </form>
            ) : (
                <p className={styles.hint} style={{ marginTop: '0.75rem' }}>Voting is closed for this poll.</p>
            )}
        </>,
    );
}
