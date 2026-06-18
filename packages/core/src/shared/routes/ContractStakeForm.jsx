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
    ScreenHeader,
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
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Contract-targeted staking is BTC-only at launch (mirrors capability staking's
// indexer-side coin gate). All staking actions in this form go through STAKE v3 /
// UNSTAKE v1 / DELEGATE v1; capability staking lives in the separate StakeForm.
const STAKE_COIN = 'bitcoin';

/**
 * ContractStakeForm: STAKE v3 / UNSTAKE v1 / DELEGATE v1 authoring surface.
 *
 * Entered from ContractDetail.jsx when the target contract opted into staking
 * (cooldown_blocks set at DEPLOY v1). The form prominently surfaces the
 * slash destination + cooldown duration so users can read the trust they're
 * extending before they sign. See:
 *   xchain-documentation/protocol/actions/CONTRACT_STAKING.md
 *
 * Three modes (radio):
 *   - 'stake'    → STAKE v3 (AMOUNT + SIGNING_PUBKEY + TICK)
 *   - 'unstake'  → UNSTAKE v1 (SIGNING_PUBKEY + TICK)
 *   - 'delegate' → DELEGATE v1 (SIGNING_PUBKEY + TICK)
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string|number} props.contractActionIndex - target contract being staked TO
 * @param {() => void} props.onBack
 */
export function ContractStakeForm({ walletId, chainId, contractActionIndex, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    // Contract metadata (cooldown + slash destination), fetched to surface in the UI
    const [contractMeta, setContractMeta] = useState(/** @type {{ cooldown: number|null, slashDestination: string|null, valid: boolean } | null} */ (null));

    // Mode selection, defaults to stake (the most common operation)
    const [mode, setMode] = useState(/** @type {'stake'|'unstake'|'delegate'} */ ('stake'));
    const [amount, setAmount] = useState('');
    const [signingPubkey, setSigningPubkey] = useState('');
    const [tick, setTick] = useState('XCHAIN');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Load wallet addresses on the chain
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

    // Load contract metadata
    useEffect(() => {
        let cancelled = false;
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => {
                if (cancelled) return;
                const row = resp?.row || resp?.rows?.[0] || resp;
                if (!row) {
                    setLoadError('Could not load target contract metadata.');
                    return;
                }
                const cooldown = row.cooldown_blocks ?? row.COOLDOWN_BLOCKS ?? null;
                const slashDest = row.slash_destination ?? row.SLASH_DESTINATION
                    ?? row.slash_destination_address ?? null;
                setContractMeta({
                    cooldown: cooldown !== null ? Number(cooldown) : null,
                    slashDestination: slashDest ? String(slashDest) : null,
                    valid: cooldown !== null && cooldown !== undefined,
                });
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load contract metadata.');
            });
        return () => { cancelled = true; };
    }, [chainId, contractActionIndex, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            SIGNING_PUBKEY: signingPubkey.trim(),
            TARGET_CONTRACT_INDEX: String(contractActionIndex),
            TICK: tick.trim(),
        };
        if (mode === 'stake') p.AMOUNT = amount.trim();
        return p;
    }, [mode, amount, signingPubkey, tick, contractActionIndex]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No Bitcoin address available to stake from.');
            return;
        }
        if (!contractMeta?.valid) {
            setFormError('Target contract is not stakeable (no cooldown configured at deploy time).');
            return;
        }
        if (!actionParams.SIGNING_PUBKEY || !/^[0-9a-fA-F]{64}$/.test(actionParams.SIGNING_PUBKEY)) {
            setFormError('Signing pubkey must be 64 hex characters (Ed25519).');
            return;
        }
        if (!actionParams.TICK) {
            setFormError('Token ticker is required.');
            return;
        }
        if (mode === 'stake') {
            if (!actionParams.AMOUNT || !/^[0-9]+(\.[0-9]+)?$/.test(actionParams.AMOUNT) || Number(actionParams.AMOUNT) <= 0) {
                setFormError('Amount must be a positive decimal.');
                return;
            }
        }
        setFormError(null);
        setStage('review');
    }

    const { isWatcherMode } = useWalletMode();

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
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
                mode,
                params: actionParams,
            };
            let res;
            if (isWatcherMode) {
                // Watcher mode falls back to action-format request building.
                let action;
                let version;
                if (mode === 'stake')        { action = 'STAKE';    version = '3'; }
                else if (mode === 'unstake') { action = 'UNSTAKE';  version = '1'; }
                else                          { action = 'DELEGATE'; version = '1'; }
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params: { VERSION: version, ...actionParams } },
                });
            } else if (isHwSource) {
                res = await messaging.contractStakeActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.contractStakeAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || `${mode} failed.`,
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
            backLabel="Back to contract"
            title={`Stake on contract #${contractActionIndex}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain || !contractMeta) {
        return wrap(<p>Loading…</p>);
    }
    if (!contractMeta.valid) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>
                    Contract #{contractActionIndex} is not stakeable. Its DEPLOY did not
                    set a cooldown duration. Staking is only available on contracts that
                    explicitly opted in at deploy time.
                </div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }

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
                    {mode === 'stake' ? 'Stake' : mode === 'unstake' ? 'Unstake' : 'Delegation'} submitted.
                    The transaction was broadcast; the indexer will record it shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || '(pending)')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const verb = mode === 'stake' ? 'Stake' : mode === 'unstake' ? 'Unstake' : 'Delegate';
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {verb}
                    {mode === 'stake' ? ` ${actionParams.AMOUNT} ${actionParams.TICK}` : ` (${actionParams.TICK})`}
                    {' '}on contract #{contractActionIndex}.
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
                    <dt className={styles.detailsLabel}>Signing pubkey</dt>
                    <dd className={styles.detailsValue}>
                        <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{actionParams.SIGNING_PUBKEY}</code>
                    </dd>
                    {mode === 'stake' ? (
                        <>
                            <dt className={styles.detailsLabel}>Amount</dt>
                            <dd className={styles.detailsValue}>{actionParams.AMOUNT} {actionParams.TICK}</dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Cooldown</dt>
                    <dd className={styles.detailsValue}>{contractMeta.cooldown} blocks</dd>
                    <dt className={styles.detailsLabel} style={{ color: '#b94a48' }}>Slash risk</dt>
                    <dd className={styles.detailsValue} style={{ color: '#b94a48' }}>
                        Funds slashed by this contract are sent to{' '}
                        {contractMeta.slashDestination
                            ? <AddressText address={contractMeta.slashDestination} />
                            : 'the contract-configured destination'}.
                    </dd>
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction. Sign it on
                        your Signer-mode wallet, then bring the signed transaction to a Full-mode
                        wallet to broadcast.
                    </p>
                ) : (
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
                                : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : `${verb}`}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div className={styles.summary} style={{ marginBottom: '0.5rem' }}>
                Target: contract #{contractActionIndex},{' '}
                <strong>{contractMeta.cooldown}-block cooldown</strong>.{' '}
                Slashed funds are routed to{' '}
                {contractMeta.slashDestination
                    ? <AddressText address={contractMeta.slashDestination} />
                    : '(configured at deploy)'}.
            </div>

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>From</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain yet. Use Receive to generate one first.
                </div>
            )}

            <fieldset style={{ border: 'none', padding: 0, marginBottom: '0.75rem' }}>
                <legend style={{ fontWeight: 'bold' }}>Action</legend>
                <label style={{ marginRight: '1rem' }}>
                    <input
                        type="radio"
                        name="contract-stake-mode"
                        checked={mode === 'stake'}
                        onChange={() => setMode('stake')}
                    /> Stake
                </label>
                <label style={{ marginRight: '1rem' }}>
                    <input
                        type="radio"
                        name="contract-stake-mode"
                        checked={mode === 'unstake'}
                        onChange={() => setMode('unstake')}
                    /> Unstake
                </label>
                <label>
                    <input
                        type="radio"
                        name="contract-stake-mode"
                        checked={mode === 'delegate'}
                        onChange={() => setMode('delegate')}
                    /> Delegate (rotate key)
                </label>
            </fieldset>

            <Input
                label="Token ticker"
                hint="Any registered token. XCHAIN is the platform default."
                value={tick}
                onChange={(e) => setTick(e.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
            />

            {mode === 'stake' ? (
                <Input
                    label="Amount"
                    hint="How much of the token to stake. Decimals must not exceed the token's precision."
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoComplete="off"
                />
            ) : null}

            <Input
                label={mode === 'delegate' ? 'New signing pubkey (64-hex Ed25519)' : 'Signing pubkey (64-hex Ed25519)'}
                hint={mode === 'delegate'
                    ? 'The new Ed25519 pubkey to rotate to. Generate one offline; this wallet does not auto-generate validator keys.'
                    : mode === 'unstake'
                        ? 'The Ed25519 pubkey identifying which contract-stake to begin cooldown for.'
                        : 'The Ed25519 pubkey to associate with this stake. Re-staking with the same pubkey tops up.'}
                value={signingPubkey}
                onChange={(e) => setSigningPubkey(e.target.value.trim())}
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
                    disabled={!fromAddress}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}
