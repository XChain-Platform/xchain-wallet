import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
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

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || password.length === 0) return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await messaging.sendAsset({
                walletId,
                password,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                },
                to: toAddress.trim(),
                asset: asset.trim(),
                amount: String(amount).trim(),
                memo: memo.trim() || undefined,
            });
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
            passwordRef.current?.focus();
            passwordRef.current?.select();
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
                ← Back
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
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
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
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStage('form')}
                        disabled={stage === 'submitting'}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={password.length === 0}
                    >
                        Send
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'form'
    return wrap(
        <form onSubmit={handleReview} noValidate>
            {chainsWithAddresses.length > 1 ? (
                <label className={styles.pickerLabel}>
                    Chain
                    <select
                        className={styles.picker}
                        value={chainId}
                        onChange={(e) => setChainId(e.target.value)}
                    >
                        {chainsWithAddresses.map((cid) => {
                            const d = chainRegistry.get(cid);
                            return (
                                <option key={cid} value={cid}>
                                    {d ? `${d.displayName} (${d.networkKind})` : cid}
                                </option>
                            );
                        })}
                    </select>
                </label>
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
                <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
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
