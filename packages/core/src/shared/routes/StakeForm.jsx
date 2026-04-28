import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
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

// Protocol-fixed stake amounts per STAKE.md's "Tier Stake Amounts"
// table. Informational only — the indexer enforces these from its
// protocol config at processing time; the user doesn't pick them.
const TIER_AMOUNTS = {
    '1': '1,000 XCHAIN',
    '2': '5,000 XCHAIN',
};

// Chains the Tier 2 signing key can validate. Tier 1 passes an empty
// CHAINS field; Tier 2 picks a subset here.
const CHAIN_OPTIONS = ['BTC', 'LTC', 'DOGE'];

/**
 * STAKE authoring form — §42.7.1.
 *
 * Tier 1 (Oracle) and Tier 2 (Cross-chain validator) supported. Tier 3
 * (Oracle publisher) is deferred — the STAKE format currently in SDK
 * 1.10.0's `formats.js` omits DOGE_ADDRESS even though STAKE.md
 * documents it as required for Tier 3. Captured in spec follow-ups
 * (see claude/reports/specs/2026-04-24_phase4-staking-followups.md).
 *
 * Fields:
 *   - Tier: radio (1 / 2).
 *   - Signing pubkey: 64 hex char Ed25519 input.
 *   - Chains: Tier 2 only — multi-checkbox (BTC/LTC/DOGE).
 *
 * Amount is display-only (protocol-fixed per tier).
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
    const [tier, setTier] = useState(/** @type {'1' | '2'} */ ('2'));
    const [signingPubkey, setSigningPubkey] = useState('');
    const [selectedChains, setSelectedChains] = useState(/** @type {string[]} */ (['BTC', 'DOGE']));
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
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            TIER: tier,
            SIGNING_PUBKEY: signingPubkey.trim().toLowerCase(),
            CHAINS: tier === '2' ? selectedChains.join(',') : '',
        };
        return p;
    }, [tier, signingPubkey, selectedChains]);

    function toggleChain(chain) {
        setSelectedChains((prev) =>
            prev.includes(chain) ? prev.filter((c) => c !== chain) : [...prev, chain],
        );
    }

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        const pk = signingPubkey.trim();
        if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
            setFormError('Signing pubkey must be exactly 64 hex characters (Ed25519 public key).');
            return;
        }
        if (tier === '2' && selectedChains.length === 0) {
            setFormError('Tier 2 requires at least one chain.');
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
                {stage === 'review' || stage === 'submitting' ? 'Review stake' : 'Stake on Bitcoin'}
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
        const amount = TIER_AMOUNTS[tier];
        const tierLabel = tier === '1' ? 'Tier 1 (Oracle)' : 'Tier 2 (Cross-chain validator)';
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Stake {amount} as {tierLabel}
                    {tier === '2' && actionParams.CHAINS ? ` for ${actionParams.CHAINS}` : ''}.
                    {' '}Delegated signing pubkey: {actionParams.SIGNING_PUBKEY.slice(0, 12)}…
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
                    <dt className={styles.detailsLabel}>Tier</dt>
                    <dd className={styles.detailsValue}>{tierLabel}</dd>
                    {tier === '2' ? (
                        <>
                            <dt className={styles.detailsLabel}>Chains</dt>
                            <dd className={styles.detailsValue}>{actionParams.CHAINS}</dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Signing pubkey</dt>
                    <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {actionParams.SIGNING_PUBKEY}
                    </dd>
                    <dt className={styles.detailsLabel}>Amount</dt>
                    <dd className={styles.detailsValue}>{amount} (protocol-fixed)</dd>
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
                <legend style={{ padding: '0 0.25rem' }}>Tier</legend>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>
                    <input
                        type="radio"
                        name="tier"
                        value="1"
                        checked={tier === '1'}
                        onChange={() => setTier('1')}
                    /> Tier 1 — Oracle ({TIER_AMOUNTS['1']})
                </label>
                <label style={{ display: 'block' }}>
                    <input
                        type="radio"
                        name="tier"
                        value="2"
                        checked={tier === '2'}
                        onChange={() => setTier('2')}
                    /> Tier 2 — Cross-chain validator ({TIER_AMOUNTS['2']})
                </label>
            </fieldset>

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

            {tier === '2' ? (
                <fieldset style={{ border: '1px solid var(--border, #ccc)', padding: '0.5rem', borderRadius: '4px', marginBottom: '0.75rem' }}>
                    <legend style={{ padding: '0 0.25rem' }}>Chains</legend>
                    {CHAIN_OPTIONS.map((chain) => (
                        <label key={chain} style={{ display: 'inline-block', marginRight: '1rem' }}>
                            <input
                                type="checkbox"
                                checked={selectedChains.includes(chain)}
                                onChange={() => toggleChain(chain)}
                            /> {chain}
                        </label>
                    ))}
                </fieldset>
            ) : null}

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !signingPubkey.trim()}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}
