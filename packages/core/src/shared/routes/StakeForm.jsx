// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    ScreenHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Plain-language labels for the four capabilities (capability-staking-model.md
// §3). Keyed by the protocol capability id the hub returns.
const CAPABILITY_LABELS = {
    price:          'Price feeds',
    cross_chain:    'Cross-chain',
    oracle_publish: 'Oracle publishing',
    attestation:    'Attestation',
};

/**
 * STAKE authoring form — §42.7.1.
 *
 * Capability-staking model: one STAKE action, no tier. The user enters
 * an amount and the signing pubkey; capabilities (price, cross_chain,
 * oracle_publish, attestation) auto-qualify when the pubkey's total
 * stake reaches each capability's MIN_STAKE. See
 * claude/reports/specs/2026-05-24_capability-staking-model.md.
 *
 * Two modes:
 *   - "New stake" (VERSION 1) — fresh pubkey. Indexer rejects if the
 *     pubkey already has an active stake.
 *   - "Top up" (VERSION 2) — adds to a pubkey this address already
 *     staked. Indexer rejects if no active stake or source mismatch.
 *
 * Fields:
 *   - Amount: decimal XCHAIN (≤ 8 fractional digits, > 0).
 *   - Signing pubkey: 64 hex char Ed25519 input.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {() => void} props.onBack
 */
export function StakeForm({ walletId, chainId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    // VERSION '1' = new stake, '2' = top-up an existing pubkey owned by SOURCE.
    const [stakeMode, setStakeMode] = useState(/** @type {'1' | '2'} */ ('1'));
    const [amount, setAmount] = useState('');
    const [signingPubkey, setSigningPubkey] = useState('');
    const [password, setPassword] = useState('');

    // Auto-detection of new-vs-top-up: when the pubkey is a valid 64-hex,
    // query the indexer for existing stakes by this source and surface the
    // result as a hint. Auto-sets stakeMode but the radio remains editable
    // (user can override). 'idle' until a valid pubkey is entered.
    const [detectStatus, setDetectStatus] = useState(/** @type {'idle' | 'checking' | 'new' | 'topup' | 'error'} */ ('idle'));
    // Aggregate of this source's existing valid stake for the entered pubkey
    // (top-ups add to it). '0' when new / unknown. Feeds the qualify readout.
    const [existingStake, setExistingStake] = useState('0');
    // Live per-capability MIN_STAKE thresholds from the hub, or null when the
    // hub is unreachable / not configured (regtest) / the SDK predates the
    // getter — in which case the qualify readout is hidden.
    const [thresholds, setThresholds] = useState(
        /** @type {Array<{capability: string, min_stake: string, disabled?: boolean}> | null} */ (null),
    );

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Declared before the effects below — the detection effect's dependency
    // array references fromAddress, which would hit the temporal dead zone
    // (ReferenceError at render) if these consts came after it.
    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const addrs = (byChain?.[chainId] || []).filter(
                    (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
                );
                if (addrs.length === 0) {
                    setLoadError('No address on this chain to stake from. Use Receive to generate one first.');
                    return;
                }
                const sorted = [...addrs].sort((a, b) => {
                    const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                    const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                    return bi - ai;
                });
                setFromAddressId(sorted[0].id);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // Fetch live per-capability MIN_STAKE thresholds from the hub so the
    // form can show which capabilities the staked amount qualifies for.
    // Null (no hub / regtest / older SDK) hides the readout and leaves the
    // generic guidance standing.
    useEffect(() => {
        if (typeof messaging.getCapabilityThresholds !== 'function') return undefined;
        let cancelled = false;
        messaging.getCapabilityThresholds({ chainId })
            .then((rows) => { if (!cancelled) setThresholds(Array.isArray(rows) ? rows : null); })
            .catch(() => { if (!cancelled) setThresholds(null); });
        return () => { cancelled = true; };
    }, [messaging, chainId]);

    // Auto-detect new-vs-top-up by querying the indexer for existing
    // stakes from this source matching the entered pubkey. Fires once
    // the pubkey is a valid 64-hex string and the source address is
    // resolved. Cancels in-flight requests when inputs change so a
    // stale response can't overwrite a newer detection. Also captures the
    // pubkey's existing valid stake so the qualify readout can project the
    // post-top-up total.
    useEffect(() => {
        const pk = signingPubkey.trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(pk) || !fromAddress || !chainId) {
            setDetectStatus('idle');
            setExistingStake('0');
            return;
        }
        let cancelled = false;
        setDetectStatus('checking');
        messaging.getStakesForAddress({ chainId, address: fromAddress.address })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp
                    : Array.isArray(resp?.data) ? resp.data
                    : Array.isArray(resp?.rows) ? resp.rows
                    : [];
                let match = false;
                let sum = 0;
                for (const row of rows) {
                    const rowPk = String(row.signing_pubkey || row.SIGNING_PUBKEY || '').toLowerCase();
                    const rowStatus = String(row.status || row.STATUS || '').toLowerCase();
                    if (rowPk === pk && rowStatus === 'valid') {
                        match = true;
                        const amt = Number(row.amount ?? row.AMOUNT ?? 0);
                        if (Number.isFinite(amt)) sum += amt;
                    }
                }
                setExistingStake(String(sum));
                setDetectStatus(match ? 'topup' : 'new');
                setStakeMode(match ? '2' : '1');
            })
            .catch(() => {
                if (cancelled) return;
                // Network/indexer failure — fall back to user's manual choice silently
                setExistingStake('0');
                setDetectStatus('error');
            });
        return () => { cancelled = true; };
    }, [signingPubkey, fromAddress, chainId, messaging]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5 — watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION:        stakeMode,
            AMOUNT:         amount.trim(),
            SIGNING_PUBKEY: signingPubkey.trim().toLowerCase(),
        };
        return p;
    }, [stakeMode, amount, signingPubkey]);

    // Project which capabilities the post-submit total stake qualifies for.
    // Total = the pubkey's existing valid stake (top-ups) + the entered
    // amount. Comparison is Number-based and display-only — the indexer
    // enforces the real on-chain qualification. Null when thresholds are
    // unavailable (no hub / regtest / older SDK).
    const qualifyReadout = useMemo(() => {
        if (!thresholds || thresholds.length === 0) return null;
        const amt = Number(amount.trim());
        const base = Number(existingStake);
        const projected = (Number.isFinite(amt) ? amt : 0) + (Number.isFinite(base) ? base : 0);
        const rows = thresholds
            .filter((t) => !t.disabled)
            .map((t) => {
                const min = Number(t.min_stake);
                return {
                    capability: t.capability,
                    label:      CAPABILITY_LABELS[t.capability] || t.capability,
                    minStake:   t.min_stake,
                    min,
                    qualifies:  projected > 0 && projected >= min,
                };
            })
            // Drop capabilities the hub has no numeric threshold for
            // (getMinStake returns null when unconfigured) — we can't claim
            // qualified/not for those, and "null XCHAIN" would be nonsense.
            .filter((r) => r.minStake != null && Number.isFinite(r.min));
        if (rows.length === 0) return null;
        return { projected, rows, hasTopup: Number(existingStake) > 0 };
    }, [thresholds, amount, existingStake]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        const amt = amount.trim();
        if (!/^[0-9]+(\.[0-9]{1,8})?$/.test(amt) || Number(amt) <= 0) {
            setFormError('Amount must be a positive number with up to 8 decimals.');
            return;
        }
        const pk = signingPubkey.trim();
        if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
            setFormError('Signing pubkey must be exactly 64 hex characters (Ed25519 public key).');
            return;
        }
        setFormError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && password.length === 0) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        setStage('submitting');
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
                params: actionParams,
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'STAKE', params: actionParams },
                });
            } else if (isHwSource) {
                res = await messaging.stakeActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.stakeAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword ? 'Incorrect password.' : err?.message || 'Stake failed.',
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

        const header = (
        <ScreenHeader
            onBack={onBack}
            title="{stage === 'review' || stage === 'submitting' ? 'Review stake' : 'Stake on Bitcoin'}"
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain) return wrap(<p>Loading addresses…</p>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <>
                <p className={styles.summary}>
                    Stake broadcast. Activation takes effect after 6 BTC blocks.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || '—')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const verb = stakeMode === '2' ? 'Top up' : 'Stake';
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {verb} {actionParams.AMOUNT} XCHAIN for signing pubkey{' '}
                    {actionParams.SIGNING_PUBKEY.slice(0, 12)}….
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
                    <dt className={styles.detailsLabel}>Mode</dt>
                    <dd className={styles.detailsValue}>
                        {stakeMode === '2' ? 'Top up an existing stake' : 'New stake'}
                    </dd>
                    <dt className={styles.detailsLabel}>Signing pubkey</dt>
                    <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {actionParams.SIGNING_PUBKEY}
                    </dd>
                    <dt className={styles.detailsLabel}>Amount</dt>
                    <dd className={styles.detailsValue}>{actionParams.AMOUNT} XCHAIN</dd>
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode — this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : (
                    <SignCredentials
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
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {(isWatcherMode || isHwSource) && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : isHwSource ? hwStatus !== 'available' : password.length === 0
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : 'Stake on Bitcoin'}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div className={styles.chainLine}>
                {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
            </div>
            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Staking from</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}

            <fieldset style={{ border: '1px solid var(--border, #ccc)', padding: '0.5rem', borderRadius: '4px', marginBottom: '0.75rem' }}>
                <legend style={{ padding: '0 0.25rem' }}>Mode</legend>
                <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem', color: 'var(--muted, #666)' }}>
                    Auto-set from the signing pubkey below — flip if you want to override.
                </p>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>
                    <input
                        type="radio"
                        name="stakeMode"
                        value="1"
                        checked={stakeMode === '1'}
                        onChange={() => setStakeMode('1')}
                    /> New stake
                </label>
                <label style={{ display: 'block' }}>
                    <input
                        type="radio"
                        name="stakeMode"
                        value="2"
                        checked={stakeMode === '2'}
                        onChange={() => setStakeMode('2')}
                    /> Top up an existing stake
                </label>
                {detectStatus !== 'idle' ? (
                    <p style={{ fontSize: '0.8rem', margin: '0.5rem 0 0', color: 'var(--muted, #666)' }}>
                        {detectStatus === 'checking' && 'Checking the indexer for an existing stake…'}
                        {detectStatus === 'new' && '✓ No existing stake for this pubkey — defaulting to New stake.'}
                        {detectStatus === 'topup' && '✓ Existing stake found — defaulting to Top up. (Choose New stake to force-reject as duplicate.)'}
                        {detectStatus === 'error' && 'Couldn\'t reach the indexer — pick the mode manually. The indexer will reject if the wrong one is chosen.'}
                    </p>
                ) : null}
            </fieldset>

            <Input
                label="Amount"
                hint="How much XCHAIN to stake. You don't pick capabilities — each one activates automatically once your total stake reaches its threshold, so a larger stake can unlock more."
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
                inputMode="decimal"
            />

            {qualifyReadout ? (
                <div style={{
                    border: '1px solid var(--border, #ccc)',
                    borderRadius: '4px',
                    padding: '0.5rem 0.75rem',
                    marginBottom: '0.75rem',
                    background: 'var(--xc-bg-muted, transparent)',
                }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
                        Capabilities this stake unlocks
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {qualifyReadout.rows.map((r) => (
                            <li
                                key={r.capability}
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: '0.5rem',
                                    fontSize: '0.85rem',
                                    padding: '0.15rem 0',
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    style={{ color: r.qualifies ? 'var(--xc-success, #16a34a)' : 'var(--muted, #999)' }}
                                >
                                    {r.qualifies ? '✓' : '○'}
                                </span>
                                <span style={{
                                    flex: 1,
                                    color: r.qualifies ? 'var(--xc-text, inherit)' : 'var(--muted, #777)',
                                }}>
                                    {r.label}
                                    <span className="sr-only">{r.qualifies ? ' — qualifies' : ' — not yet'}</span>
                                </span>
                                <span style={{ color: 'var(--muted, #777)', fontVariantNumeric: 'tabular-nums' }}>
                                    {r.minStake} XCHAIN
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p style={{ fontSize: '0.75rem', color: 'var(--muted, #777)', margin: '0.5rem 0 0' }}>
                        {qualifyReadout.hasTopup
                            ? `Based on your total stake of ${qualifyReadout.projected} XCHAIN for this pubkey (existing + this top-up). `
                            : ''}
                        Thresholds are set by network governance and can change.
                    </p>
                </div>
            ) : null}

            <Input
                label="Signing pubkey"
                hint="64-character hex-encoded Ed25519 public key. This key signs hub PBFT votes on your behalf."
                value={signingPubkey}
                onChange={(e) => setSigningPubkey(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
            />

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !amount.trim() || !signingPubkey.trim()}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}
