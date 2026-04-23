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
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Standalone ISSUE form — §40.2.
 *
 * The Token Creation Wizard (§40.1) is the primary authoring surface.
 * This form is the escape hatch for users who want to compose ISSUE
 * without the template picker — every ISSUE v0 field the Custom
 * template exposes, on a single screen. Two stages: form → review+sign,
 * mirroring Send.jsx.
 *
 * Backed by the same `messaging.issueToken` helper the wizard uses —
 * no new flow, no new background handler. The review step runs the
 * draft through `decoder.decodeAction` so the plain-English summary
 * matches the sign screen shown for dApp-initiated ISSUE requests.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function IssueTokenForm({ walletId, onBack }) {
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

    const [ticker, setTicker] = useState('');
    const [supply, setSupply] = useState('');
    const [divisible, setDivisible] = useState(false);
    const [description, setDescription] = useState('');
    const [lockSupply, setLockSupply] = useState(false);
    const [transferTo, setTransferTo] = useState('');
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
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before issuing a token.',
                    );
                    return;
                }
                setChainId(first);
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

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            TICK: ticker.trim().toUpperCase(),
        };
        p.DECIMALS = divisible ? '8' : '0';
        if (supply) {
            const s = String(supply).trim();
            p.MAX_SUPPLY = s;
            p.MINT_SUPPLY = s;
        }
        if (description) p.DESCRIPTION = description.trim();
        if (lockSupply) {
            p.LOCK_MAX_SUPPLY = '1';
            p.LOCK_MINT = '1';
        }
        if (transferTo) p.TRANSFER = transferTo.trim();
        return p;
    }, [ticker, supply, divisible, description, lockSupply, transferTo]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'ISSUE',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!ticker.trim()) {
            setFormError('Ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9]+$/.test(ticker.trim())) {
            setFormError('Ticker must be A–Z, 0–9 only.');
            return;
        }
        if (!supply.trim() || Number(supply) <= 0) {
            setFormError('Supply must be a positive number.');
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
            const res = await messaging.issueToken({
                walletId,
                password,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                },
                params: actionParams,
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Issue failed.',
            );
            setStage('review');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

    const titleSuffix = descriptor ? ` on ${descriptor.displayName}` : '';
    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>
                {stage === 'review' || stage === 'submitting'
                    ? 'Review issue'
                    : `Issue token${titleSuffix}`}
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
                <h2 className={styles.successTitle}>Token issued</h2>
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
                        <DetailRow key={d.label} label={d.label} value={d.value} />
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
                        {descriptor ? `Sign on ${descriptor.displayName}` : 'Sign'}
                    </Button>
                </div>
            </form>,
        );
    }

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
                    <span className={styles.fromLabel}>Fee paid by</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            <Input
                label="Ticker"
                hint="A–Z, 0–9. Uppercase."
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label="Supply"
                inputMode="decimal"
                value={supply}
                onChange={(e) => setSupply(e.target.value)}
                autoComplete="off"
            />
            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={divisible}
                    onChange={(e) => setDivisible(e.target.checked)}
                />
                <span>Divisible (8 decimal places)</span>
            </label>
            <Input
                label="Description (optional)"
                hint="Up to 250 characters. Stored on-chain."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
                maxLength={250}
            />
            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={lockSupply}
                    onChange={(e) => setLockSupply(e.target.checked)}
                />
                <span>Lock supply + minting (irreversible)</span>
            </label>
            <Input
                label="Transfer ownership to (optional)"
                hint="Leave blank to keep control."
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
            />
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !ticker || !supply}
                >
                    Preview
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
