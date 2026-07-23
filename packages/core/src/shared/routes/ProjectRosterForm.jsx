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
    FeeSelector,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { normalizeGenesisRow } from './ManageToken.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;

// Protocol coin tickers for the LINK serialization (same map as
// LinkForm / AttachContentForm).
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Manage a project's official-token list (the project registry pattern,
 * Project_Registry.md): publish a TICK-type LIST of member tokens, then
 * sign a LINK pairing it with the project's original ISSUE. The indexer
 * only honours a LINK signed by the project's current owner, and the
 * latest owner-valid list replaces earlier ones, so editing is simply
 * publishing a new full list.
 *
 * Same two-sign stage machine as AttachContentForm:
 *
 *   compose      - edit the member list (prefilled with the current one)
 *   review-list  - confirm + sign the LIST
 *   wait-index   - poll the explorer for the LIST's ACTION_INDEX
 *   review-link  - confirm + sign the LINK (owner-validated)
 *   done         - both txids shown
 *
 * No crash-safe resume: if the wallet closes mid-flow the LIST is
 * already on-chain and the pairing can be finished manually via
 * Actions → Link. The wait screen says exactly that.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId          chain the project lives on
 * @param {string} props.tick             the project's ticker (uppercase)
 * @param {string | null} [props.issuerAddress]   the project's current owner (preferred signing address)
 * @param {() => void} props.onBack
 */
export function ProjectRosterForm({ walletId, chainId, tick, issuerAddress = null, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    // The project's ISSUE action index (the LINK's second leg).
    const [issueActionIndex, setIssueActionIndex] = useState(/** @type {string | null} */ (null));
    const [genesisChecked, setGenesisChecked] = useState(false);

    // Current published roster (prefill + context line). null = still
    // loading; { members: [] } shape from the explorer; absent roster
    // resolves to null from the host.
    const [currentRoster, setCurrentRoster] = useState(/** @type {any | null} */ (null));
    const [rosterChecked, setRosterChecked] = useState(false);

    const [membersText, setMembersText] = useState('');
    const [prefilled, setPrefilled] = useState(false);
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-list' | 'wait-index' | 'review-link' | 'done'} */
        ('compose'),
    );
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [listTxid, setListTxid] = useState(/** @type {string | null} */ (null));
    const [listActionIndex, setListActionIndex] = useState(/** @type {string | null} */ (null));
    const [linkTxid, setLinkTxid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                if (!byChain || !(byChain[chainId] || []).length) {
                    setLoadError('No address on this chain yet. Use Receive to generate one first.');
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    // Resolve the project's ISSUE action index.
    useEffect(() => {
        if (typeof messaging?.getGenesisForToken !== 'function') { setGenesisChecked(true); return undefined; }
        let cancelled = false;
        messaging.getGenesisForToken({ chainId, tick })
            .then((row) => {
                if (cancelled) return;
                const info = normalizeGenesisRow(row);
                if (info?.actionIndex) setIssueActionIndex(String(info.actionIndex));
                setGenesisChecked(true);
            })
            .catch(() => { if (!cancelled) setGenesisChecked(true); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    // Fetch the current roster for prefill. A project with no published
    // list yet resolves to null (normal for first-time publishing).
    useEffect(() => {
        if (typeof messaging?.getProjectForToken !== 'function') { setRosterChecked(true); return undefined; }
        let cancelled = false;
        messaging.getProjectForToken({ chainId, tick })
            .then((project) => {
                if (cancelled) return;
                setCurrentRoster(project || null);
                setRosterChecked(true);
            })
            .catch(() => { if (!cancelled) setRosterChecked(true); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    // Prefill the textarea once, from the current roster.
    useEffect(() => {
        if (prefilled || !rosterChecked) return;
        const members = Array.isArray(currentRoster?.members) ? currentRoster.members : [];
        const ticks = members.map((m) => (m && typeof m.tick === 'string' ? m.tick : null)).filter(Boolean);
        if (ticks.length > 0 && membersText === '') setMembersText(ticks.join('\n'));
        setPrefilled(true);
    }, [prefilled, rosterChecked, currentRoster, membersText]);

    // Signing address: prefer the project's owner (the LINK is only
    // honoured from the owner), else the newest external HD address.
    useEffect(() => {
        if (!addressesByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        if (issuerAddress) {
            const match = all.find((a) => a.address === issuerAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const hd = all.filter(
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        const pool = hd.length > 0 ? hd : all;
        if (pool.length > 0) {
            const sorted = [...pool].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        }
    }, [addressesByChain, chainId, fromAddressId, issuerAddress]);

    useEffect(() => {
        if (stage === 'review-list' || stage === 'review-link') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // Wait-index polling: same shape as AttachContentForm.
    useEffect(() => {
        if (stage !== 'wait-index' || !listTxid) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick_ = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: listTxid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setListActionIndex(idx);
                    setStage('review-link');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick_();
        const handle = setInterval(tick_, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, listTxid, chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] || '' : '';

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices both broadcasts (the LIST and the LINK).
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

    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const ownerMismatch = !!(issuerAddress && fromAddress && fromAddress.address !== issuerAddress);

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    // Parse the textarea into validated, deduplicated, uppercased ticks.
    const memberTicks = useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const raw of membersText.split(/[\n,]+/)) {
            const t = raw.trim().toUpperCase();
            if (!t || seen.has(t)) continue;
            seen.add(t);
            out.push(t);
        }
        return out;
    }, [membersText]);

    const invalidTicks = useMemo(
        () => memberTicks.filter((t) => !/^[A-Z0-9.^]+$/.test(t)),
        [memberTicks],
    );

    function handleReviewList(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No signing address available on this chain.');
            return;
        }
        if (memberTicks.length === 0) {
            setFormError('Add at least one token to the list.');
            return;
        }
        if (invalidTicks.length > 0) {
            setFormError(`These don't look like token names: ${invalidTicks.join(', ')}`);
            return;
        }
        if (!issueActionIndex) {
            setFormError(
                genesisChecked
                    ? `The creation record for ${tick} isn't indexed yet. Try again in a minute.`
                    : 'Still looking up the project\'s creation record. One moment.',
            );
            return;
        }
        if (memo && /[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        setFormError(null);
        setStage('review-list');
    }

    async function handleSignList(event) {
        event.preventDefault();
        if (submitting) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                // TICK-type LIST (TYPE=1): the roster shape the registry
                // standard expects (sdk.project.rosterParams).
                params: {
                    VERSION: '0',
                    TYPE: '1',
                    ITEM: memberTicks,
                },
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = hw
                ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.createList({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('LIST broadcast did not return a txid.');
            setListTxid(txid);
            setPassword('');
            setStage('wait-index');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'List broadcast failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSignLink(event) {
        event.preventDefault();
        if (submitting || !listActionIndex || !issueActionIndex) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                coin1: coinTicker,
                coin1ActionIndex: listActionIndex,
                coin2: coinTicker,
                coin2ActionIndex: issueActionIndex,
                ...(memo.trim() ? { memo: memo.trim() } : {}),
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = hw
                ? await messaging.linkActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.linkAction({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('LINK broadcast did not return a txid.');
            setLinkTxid(txid);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'LINK broadcast failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back"
            title={`Official tokens of ${tick}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (isWatcherMode) {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Not available in watcher mode</h2>
                <p className={styles.hint}>
                    Publishing an official-token list is a two-phase action:
                    the wallet broadcasts the list, waits for it to be
                    indexed, then broadcasts the link that makes it official.
                    A watcher-mode wallet can't observe the list landing
                    on-chain, so this flow can't be split across an
                    air-gapped boundary today.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Back</Button>
                </div>
            </>,
        );
    }

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Official list published</h2>
                <p className={styles.successLabel}>List transaction</p>
                <code className={styles.txid}>{listTxid}</code>
                <p className={styles.successLabel}>Link transaction</p>
                <code className={styles.txid}>{linkTxid}</code>
                <p className={styles.hint}>
                    Once the link confirms, every token on the list is marked
                    as an official token of the {tick} project in the explorer
                    and wallets. Publishing a new list later replaces this one.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <>
                <h2 className={styles.successTitle}>List is on its way</h2>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>List transaction</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.txid}>{listTxid}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>
                        {minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the list to be confirmed and indexed.
                    usually one or two blocks. Then one more signature links
                    it to {tick} and makes it official.
                </p>
                {slow ? (
                    <p className={styles.hint}>
                        This is taking longer than usual. If you close this
                        screen the list stays on-chain. You can finish the
                        pairing later from Actions → Link.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Close (keep waiting)</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review-list' && fromAddress) {
        return wrap(
            <form onSubmit={handleSignList} noValidate>
                <p className={styles.summary}>
                    Publish the official-token list for {tick}
                    {' '}({memberTicks.length} token{memberTicks.length === 1 ? '' : 's'}).
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Tokens</dt>
                    <dd className={styles.detailsValue}>{memberTicks.join(', ')}</dd>
                </dl>
                <p className={styles.hint}>
                    This is step 1 of 2. The list goes on-chain first; once
                    it's indexed you'll sign one more transaction linking it
                    to {tick}. {hw
                        ? 'You will confirm on your hardware device twice.'
                        : 'You will enter your password twice.'}
                </p>
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={fromAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (submitError) setSubmitError(null);
                    }}
                    onStatusChange={onHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={submitError}
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" type="button" onClick={() => setStage('compose')} disabled={submitting}>
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Publish list
                    </Button>
                </div>
            </form>,
        );
    }

    if (stage === 'review-link' && fromAddress) {
        return wrap(
            <form onSubmit={handleSignLink} noValidate>
                <p className={styles.summary}>
                    Link the published list to {tick}. This makes it the
                    project's official-token list.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>List action</dt>
                    <dd className={styles.detailsValue}>#{listActionIndex}</dd>
                    <dt className={styles.detailsLabel}>Project created in action</dt>
                    <dd className={styles.detailsValue}>#{issueActionIndex}</dd>
                </dl>
                {ownerMismatch ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>
                            This wallet isn't signing from the project's owner
                            address ({issuerAddress}). The link will only be
                            honoured if it's signed by the current owner.
                        </p>
                    </div>
                ) : null}
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={fromAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (submitError) setSubmitError(null);
                    }}
                    onStatusChange={onHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={submitError}
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Make it official
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'compose'
    const hasRoster = Array.isArray(currentRoster?.members) && currentRoster.members.length > 0;
    return wrap(
        <form onSubmit={handleReviewList} noValidate>
            <p className={styles.summary}>
                The official-token list is {tick}'s on-chain seal of
                approval: tokens on it show an "Official" badge in the
                explorer and wallets. Publishing a new list replaces the
                old one.
            </p>
            {rosterChecked && hasRoster ? (
                <p className={styles.hint}>
                    Current list ({currentRoster.members.length} token{currentRoster.members.length === 1 ? '' : 's'})
                    {' '}loaded below. Edit and republish.
                </p>
            ) : null}
            {rosterChecked && !hasRoster ? (
                <p className={styles.hint}>
                    No list published yet. This will be the first.
                </p>
            ) : null}
            <label className={styles.pickerLabel} htmlFor="roster-members">
                Tokens (one per line)
            </label>
            <textarea
                id="roster-members"
                value={membersText}
                onChange={(e) => setMembersText(e.target.value)}
                rows={6}
                spellCheck={false}
                autoCapitalize="characters"
                aria-label="Tokens (one per line)"
                style={{
                    width: '100%',
                    fontFamily: 'var(--xc-font-mono, monospace)',
                    fontSize: 'var(--xc-text-sm)',
                    padding: 'var(--xc-space-2)',
                    borderRadius: 'var(--xc-radius-md)',
                    border: '1px solid var(--xc-border)',
                    background: 'var(--xc-bg-input, transparent)',
                    color: 'var(--xc-text)',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    marginBottom: 'var(--xc-space-3)',
                }}
            />
            <Input
                label="Memo (optional)"
                hint="Protocol rejects | or ;."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />
            {ownerMismatch ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        This wallet doesn't hold the project's owner address.
                        the final link step will only be honoured if signed
                        by the current owner.
                    </p>
                </div>
            ) : null}
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
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || memberTicks.length === 0}
                >
                    Review list
                </Button>
            </div>
        </form>,
    );
}

// Resolve the ACTION_INDEX from whatever shape the explorer returns:
// a merged action row or the transactions endpoint's wrapper.
function extractActionIndex(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const raw = resp.action_index
        ?? resp.actionIndex
        ?? (Array.isArray(resp.actions) ? (resp.actions[0]?.action_index ?? resp.actions[0]?.actionIndex) : null)
        ?? null;
    if (raw === null || raw === undefined) return null;
    const s = String(raw);
    return s.length > 0 ? s : null;
}
