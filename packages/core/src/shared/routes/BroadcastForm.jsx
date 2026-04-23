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
 * BROADCAST form — §40.6.
 *
 * Publishes an arbitrary text string, oracle value, or feed reference
 * on-chain, tied to the source address. Three UX lanes map onto the
 * four protocol format versions (BROADCAST.md):
 *
 *   - plain broadcast (v0): feed name + message, no value, no fee.
 *   - oracle (v1): feed name + value + fee (+ optional memo).
 *   - feed URL (v2): feed name (a URL) + fee (+ optional memo).
 *
 * v3 (feed results) is a resolve path from a prior feed's detail page
 * and not surfaced as a standalone authoring lane here.
 *
 * Field mapping — MESSAGE is the protocol's one-string payload; the
 * form presents "Feed name" and "Text" as separate inputs for clarity
 * (§40.6) and composes them:
 *
 *   - feedName non-empty → MESSAGE = feedName; text (if any) → MEMO.
 *   - feedName empty     → MESSAGE = text (validator still requires
 *                          at least one of them).
 *
 * Timestamp (auto) prepends the current UTC ISO time to MEMO so the
 * sign-screen sees what will land on-chain. Users can turn it off for
 * plain broadcasts where the tx's block time is enough context.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function BroadcastForm({ walletId, onBack }) {
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

    const [feedName, setFeedName] = useState('');
    const [text, setText] = useState('');
    const [value, setValue] = useState('');
    const [feedFee, setFeedFee] = useState('');
    const [includeTimestamp, setIncludeTimestamp] = useState(false);
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
                        'No addresses on any chain yet. Use Receive to generate one before broadcasting.',
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
        const feed = feedName.trim();
        const body = text.trim();
        const val = String(value).trim();
        const fee = String(feedFee).trim();

        // Compose MESSAGE + MEMO from the two text inputs.
        const message = feed || body;
        const memoParts = [];
        if (includeTimestamp) memoParts.push(new Date().toISOString());
        if (feed && body) memoParts.push(body);
        const memo = memoParts.join(' — ');

        // Version selection: oracle (v1) > feed (v2) > plain (v0).
        let version = '0';
        if (val && fee) version = '1';
        else if (fee) version = '2';

        /** @type {Record<string, string>} */
        const p = { VERSION: version, MESSAGE: message };
        if (val) p.VALUE = val;
        if (fee) p.FEE = fee;
        if (memo) p.MEMO = memo;
        return p;
    }, [feedName, text, value, feedFee, includeTimestamp]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'BROADCAST',
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
        if (!feedName.trim() && !text.trim()) {
            setFormError('Enter a feed name or a message.');
            return;
        }
        if (value.trim() && Number.isNaN(Number(value.trim()))) {
            setFormError('Value must be a number.');
            return;
        }
        if (feedFee.trim()) {
            const n = Number(feedFee.trim());
            if (Number.isNaN(n) || n < 0) {
                setFormError('Feed fee must be a non-negative number.');
                return;
            }
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
            const res = await messaging.broadcastAction({
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
                    : err?.message || 'Broadcast failed.',
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
                    ? 'Review broadcast'
                    : `Broadcast${titleSuffix}`}
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
                <h2 className={styles.successTitle}>Broadcast sent</h2>
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
                label="Feed name (optional)"
                hint="Stable label for an oracle or feed. Leave blank for a plain broadcast."
                value={feedName}
                onChange={(e) => setFeedName(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label="Message"
                hint="Broadcast body. When a feed name is set this becomes a memo instead."
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Value (optional)"
                hint="Numeric oracle value — pairs with a feed fee for a v1 oracle."
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Feed fee (optional, %)"
                hint="Oracle / dispenser usage fee as a percentage. Leave blank to skip."
                inputMode="decimal"
                value={feedFee}
                onChange={(e) => setFeedFee(e.target.value)}
                autoComplete="off"
            />
            <label className={styles.pickerLabel}>
                <input
                    type="checkbox"
                    checked={includeTimestamp}
                    onChange={(e) => setIncludeTimestamp(e.target.checked)}
                />
                {' '}Prepend UTC timestamp to memo
            </label>
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || (!feedName.trim() && !text.trim())}
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
