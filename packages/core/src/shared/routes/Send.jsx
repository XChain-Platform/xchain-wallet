import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 ChainPicker,  Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { HwSignBlock } from '../components/HwSignBlock.jsx';
import { BalanceChanges } from '../components/BalanceChanges.jsx';
import styles from './Send.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Send view — §29 authoring surface for the SEND action.
 *
 * Flow:
 *   form      -> review    -> submitting -> done | error
 *                 (back from review re-edits; error state re-opens form
 *                  pre-filled so the user doesn't retype everything)
 *
 * Review stage runs the user's draft through `decoder.decodeAction` so
 * the plain-English summary + warnings match SignApproval's sign-screen
 * (§21.1 / §30). A memo with `|` or `;` surfaces the same protocol-
 * reject warning there and here.
 *
 * The dev-SDK stub cannot encode / sign / broadcast; Send will surface
 * that error when the user hits Submit. Form + review paths still
 * exercise cleanly — good for UX review before real SDK lands.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function Send({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [toAddress, setToAddress] = useState('');
    const [asset, setAsset] = useState('');
    const [amount, setAmount] = useState('');
    const [memo, setMemo] = useState('');
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
                setAddressesByChain(byChain);
                const firstChain = Object.keys(byChain)[0];
                if (!firstChain) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one.',
                    );
                    return;
                }
                setChainId(firstChain);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const addrs = (addressesByChain[chainId] || []).filter(
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
        const descriptor = chainRegistry.get(chainId);
        if (descriptor) setAsset(descriptor.coin.toUpperCase());
    }, [chainId, addressesByChain]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'SEND',
            params: {
                TICK: asset.trim(),
                AMOUNT: String(amount).trim(),
                DESTINATION: toAddress.trim(),
                MEMO: memo.trim() || undefined,
            },
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, asset, amount, toAddress, memo, chainId]);

    // §21.2 balance-change preview. Fetched on entering review against
    // the source address; the result feeds `decoder.simulateAction` and
    // renders inside `<BalanceChanges>` between the headline and details.
    // Fetch failure is non-blocking — the section renders muted with a
    // "(preview unavailable)" line and the user can still sign.
    const [previewBalances, setPreviewBalances] = useState(
        /** @type {{ loading: boolean, error: string | null, sdkShape: any | null }} */
        ({ loading: false, error: null, sdkShape: null }),
    );
    useEffect(() => {
        if (stage !== 'review') return undefined;
        if (!chainId || !fromAddress) return undefined;
        let cancelled = false;
        setPreviewBalances({ loading: true, error: null, sdkShape: null });
        messaging.getAddressBalances(chainId, fromAddress.address)
            .then((sdkShape) => {
                if (cancelled) return;
                setPreviewBalances({ loading: false, error: null, sdkShape });
            })
            .catch((err) => {
                if (cancelled) return;
                setPreviewBalances({
                    loading: false,
                    error: err?.message || 'balance fetch failed',
                    sdkShape: null,
                });
            });
        return () => { cancelled = true; };
    }, [stage, chainId, fromAddress, messaging]);

    const previewResult = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) {
            return null;
        }
        return decoderLib.simulateAction({
            action: 'SEND',
            params: {
                TICK: asset.trim(),
                AMOUNT: String(amount).trim(),
                DESTINATION: toAddress.trim(),
                MEMO: memo.trim() || undefined,
            },
            balances: decoderLib.balancesFromSdk(previewBalances.sdkShape),
            // Fee selector lands later (§44.2 cluster); '0' until then.
            feeEstimate: '0',
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, asset, amount, toAddress, memo, chainId, previewBalances]);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!toAddress.trim()) {
            setFormError('Destination address is required.');
            return;
        }
        if (!asset.trim()) {
            setFormError('Asset ticker is required.');
            return;
        }
        const amt = String(amount).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Amount must be a positive number.');
            return;
        }
        if (/[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        setFormError(null);
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState(/** @type {string} */ ('idle'));
    const onHwStatusChange = useCallback(({ status }) => {
        setHwStatus(status);
    }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isHwSource && password.length === 0) return;
        if (isHwSource && hwStatus !== 'available') return;
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
                to: toAddress.trim(),
                asset: asset.trim(),
                amount: String(amount).trim(),
                memo: memo.trim() || undefined,
            };
            // Software path: send password; background unlocks + signs.
            // HW path: bypass password; background routes the sign
            // request through the signer-bridge RPC to the renderer-
            // hosted Trezor/Ledger signer identified by `signerId`.
            const res = isHwSource
                ? await messaging.sendAssetHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.sendAsset({ ...base, password });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Send failed.',
            );
            setStage('review');
            if (!isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to home"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>
                {stage === 'review' || stage === 'submitting' ? 'Review & Send' : 'Send'}
            </span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Sent</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <BalanceChanges
                    result={previewResult}
                    loading={previewBalances.loading}
                    error={previewBalances.error}
                />
                <details className={styles.details}>
                    <summary className={styles.detailsToggle}>
                        Details ({2 + (decoded?.details?.length || 0)})
                    </summary>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Chain</dt>
                        <dd className={styles.detailsValue}>
                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                        </dd>
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={fromAddress.address} />
                        </dd>
                        {(decoded?.details || []).map((d) => (
                            <DetailRow
                                key={d.label}
                                label={d.label}
                                value={d.value}
                            />
                        ))}
                    </dl>
                </details>
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {isHwSource ? (
                    <HwSignBlock
                        signerKind={fromAddress.source}
                        signerName={fromAddress.signerLabel || (fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger')}
                        path={fromAddress.derivationPath || ''}
                        address={fromAddress.address}
                        chainId={chainId}
                        getStatus={(opts) => messaging.getSignerStatus({
                            signerId: fromAddress.signerId,
                            chainId: opts?.chainId ?? chainId,
                        })}
                        onStatusChange={onHwStatusChange}
                    />
                ) : (
                    <Input
                        ref={passwordRef}
                        type="password"
                        label="Password"
                        hint="Required to sign."
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (submitError) setSubmitError(null);
                        }}
                        autoComplete="current-password"
                        disabled={stage === 'submitting'}
                        error={submitError || undefined}
                    />
                )}
                {isHwSource && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isHwSource
                                ? hwStatus !== 'available'
                                : password.length === 0
                        }
                    >
                        {isHwSource
                            ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : descriptor?.displayName
                                ? `Sign on ${descriptor.displayName}`
                                : 'Sign'}
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'form'
    return wrap(
        <form onSubmit={handleReview} noValidate>
            {chainsWithAddresses.length > 1 ? (
                <ChainPicker label="Chain" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses} chainRegistry={chainRegistry} />
            ) : descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>From</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}

            <Input
                label="To"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                placeholder={descriptor ? `${descriptor.displayName} address` : 'address'}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
            />
            <Input
                label="Asset"
                hint="Ticker. Native coin by default."
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
            />
            <Input
                label="Amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Memo"
                hint="Optional. Cannot contain | or ; characters."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !toAddress || !amount}
                >
                    Review
                </Button>
            </div>
        </form>,
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
