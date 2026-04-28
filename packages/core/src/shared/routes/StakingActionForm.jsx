import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
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

/**
 * UNSTAKE + CLAIM_REWARDS combined form — §42.7.2 unstake-lane +
 * §42.7.3 claim-rewards.
 *
 * One component, two modes via the `mode` prop. Both actions share a
 * chassis (address load / SignCredentials / HW branch / review / done)
 * and diverge only in which field inputs appear, which messaging
 * helper is called, and the verb rendered on the submit button.
 *
 *   - `mode: 'unstake'` — VERSION|TIER. Tier radio (1 / 2). Per
 *     STAKE.md, UNSTAKE withdraws the full tier stake; there is no
 *     partial-amount field (spec §42.7.2 mentions an amount, but the
 *     on-chain format doesn't carry one — captured as FOLLOWUP 4 in
 *     the staking followups doc).
 *   - `mode: 'claim-rewards'` — VERSION only. No input fields; the
 *     form is a confirm-and-sign screen.
 *
 * @param {object} props
 * @param {'unstake' | 'claim-rewards'} props.mode
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {() => void} props.onBack
 */
export function StakingActionForm({ mode, walletId, chainId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isUnstake = mode === 'unstake';
    const verb = isUnstake ? 'Unstake' : 'Claim rewards';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [tier, setTier] = useState(/** @type {'1' | '2'} */ ('2'));
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

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
                    setLoadError('No address on this chain. Use Receive to generate one first.');
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

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5 — watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    const actionParams = useMemo(() => {
        if (isUnstake) {
            return { VERSION: '0', TIER: tier };
        }
        return { VERSION: '0' };
    }, [isUnstake, tier]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
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
                const action = isUnstake ? 'UNSTAKE' : 'CLAIM_REWARDS';
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params: actionParams },
                });
            } else {
                const fn = isUnstake
                    ? (isHwSource ? messaging.unstakeActionHw : messaging.unstakeAction)
                    : (isHwSource ? messaging.claimRewardsActionHw : messaging.claimRewardsAction);
                const args = isHwSource
                    ? { ...base, signerId: fromAddress.signerId }
                    : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword ? 'Incorrect password.' : err?.message || (verb + ' failed.'),
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
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>
                {stage === 'review' || stage === 'submitting'
                    ? `Review ${verb.toLowerCase()}`
                    : verb}
            </span>
            <span className={styles.spacer} />
        </div>
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
                    {isUnstake
                        ? 'Unstake broadcast. The indexer will return your staked XCHAIN after the on-chain confirmation window.'
                        : 'Claim broadcast. Pending rewards will be credited after the indexer processes the action.'}
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
        const tierLabel = tier === '1' ? 'Tier 1 (Oracle)' : 'Tier 2 (Cross-chain validator)';
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {isUnstake
                        ? `Unstake ${tierLabel} — the full tier stake is returned.`
                        : 'Claim all pending staking rewards for this address.'}
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
                    {isUnstake ? (
                        <>
                            <dt className={styles.detailsLabel}>Tier</dt>
                            <dd className={styles.detailsValue}>{tierLabel}</dd>
                        </>
                    ) : null}
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode — this wallet will build an unsigned PSBT.
                        Sign it on your Signer-mode wallet, then bring the
                        signed PSBT to a Full-mode wallet to broadcast.
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
                            ? 'Build unsigned PSBT'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : verb}
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
                    <span className={styles.fromLabel}>
                        {isUnstake ? 'Unstaking from' : 'Claiming for'}
                    </span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}

            {isUnstake ? (
                <fieldset style={{ border: '1px solid var(--border, #ccc)', padding: '0.5rem', borderRadius: '4px', marginBottom: '0.75rem' }}>
                    <legend style={{ padding: '0 0.25rem' }}>Tier</legend>
                    <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem', color: 'var(--muted, #666)' }}>
                        Pick which tier stake to withdraw. Unstake returns the full tier amount — the protocol doesn't support partial unstakes.
                    </p>
                    <label style={{ display: 'block', marginBottom: '0.25rem' }}>
                        <input
                            type="radio"
                            name="tier"
                            value="1"
                            checked={tier === '1'}
                            onChange={() => setTier('1')}
                        /> Tier 1 — Oracle (1,000 XCHAIN)
                    </label>
                    <label style={{ display: 'block' }}>
                        <input
                            type="radio"
                            name="tier"
                            value="2"
                            checked={tier === '2'}
                            onChange={() => setTier('2')}
                        /> Tier 2 — Cross-chain validator (5,000 XCHAIN)
                    </label>
                </fieldset>
            ) : (
                <p style={{ fontSize: '0.9rem', color: 'var(--muted, #666)' }}>
                    Claiming sweeps all pending staking rewards for this address into your balance. Rewards continue to accrue after the claim.
                </p>
            )}

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
