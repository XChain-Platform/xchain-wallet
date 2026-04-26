import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 ChainPicker, } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Dividend form — §40.8.
 *
 * Pays a dividend of DIVIDEND_TICK to every holder of TICK at the
 * snapshot block (per DIVIDEND.md: the action is processed at the
 * block it confirms in; source address is excluded from receiving).
 *
 * Once the user fills in the "of token" ticker, the form fetches the
 * holder list via `messaging.getHoldersForToken` and renders a cost
 * preview (holder count + total distribution). The cost preview is
 * best-effort — a fetch failure falls back to a plain warning rather
 * than blocking review.
 *
 * Spec §40.8 shows the form reachable from a Token detail page with
 * TICK pre-filled. Until the Token detail page ships, TICK is typed
 * manually; a future step can accept a `tick` prop for pre-fill.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DividendForm({ walletId, onBack }) {
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

    const [tick, setTick] = useState('');
    const [dividendTick, setDividendTick] = useState('');
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

    // Holders preview — fetched when the user's TICK input stabilizes,
    // display-only. { loading, rows, error }. Rows per explorer shape:
    // { address, amount, percent }.
    const [holders, setHolders] = useState(
        /** @type {{ loading: boolean, rows: any[] | null, error: string | null }} */
        ({ loading: false, rows: null, error: null }),
    );

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before paying dividends.',
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

    // Fetch holders whenever TICK settles. Debounced so fast typing
    // doesn't fire one query per keystroke; the 400ms window is long
    // enough to feel snappy without hammering the explorer.
    useEffect(() => {
        const trimmed = tick.trim().toUpperCase();
        if (!chainId || !trimmed) {
            setHolders({ loading: false, rows: null, error: null });
            return;
        }
        setHolders((prev) => ({ ...prev, loading: true, error: null }));
        let cancelled = false;
        const handle = setTimeout(() => {
            messaging.getHoldersForToken({ chainId, tick: trimmed })
                .then((resp) => {
                    if (cancelled) return;
                    setHolders({ loading: false, rows: extractRows(resp), error: null });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setHolders({
                        loading: false,
                        rows: null,
                        error: err?.message || 'Failed to load holders.',
                    });
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [tick, chainId, messaging]);

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
            TICK: tick.trim().toUpperCase(),
            DIVIDEND_TICK: dividendTick.trim().toUpperCase(),
            AMOUNT: String(amount).trim(),
        };
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [tick, dividendTick, amount, memo]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DIVIDEND',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    // Holder-count preview excludes the source address per DIVIDEND.md
    // ("SOURCE address is excluded from receiving dividends"). When
    // `holders.rows` is null (unfetched / error), the preview just
    // shows the error / loading state.
    const preview = useMemo(() => {
        if (!holders.rows) return null;
        const sourceAddr = fromAddress?.address;
        const eligible = sourceAddr
            ? holders.rows.filter((r) => r.address !== sourceAddr)
            : holders.rows;
        const amt = Number(String(amount).trim());
        let totalHeld = 0;
        for (const row of eligible) {
            const h = Number(row.amount);
            if (Number.isFinite(h)) totalHeld += h;
        }
        const total = Number.isFinite(amt) && amt > 0 && totalHeld > 0
            ? amt * totalHeld
            : null;
        return {
            eligibleCount: eligible.length,
            sourceExcluded: Boolean(sourceAddr && holders.rows.some((r) => r.address === sourceAddr)),
            total,
        };
    }, [holders.rows, fromAddress, amount]);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!tick.trim()) {
            setFormError('Holder-of token is required.');
            return;
        }
        if (!/^[A-Za-z0-9.^]+$/.test(tick.trim())) {
            setFormError('Holder-of ticker accepts A–Z, 0–9, period, or ^TICK_ID.');
            return;
        }
        if (!dividendTick.trim()) {
            setFormError('Dividend asset is required.');
            return;
        }
        if (!/^[A-Za-z0-9.^]+$/.test(dividendTick.trim())) {
            setFormError('Dividend ticker accepts A–Z, 0–9, period, or ^TICK_ID.');
            return;
        }
        const amt = String(amount).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Per-unit amount must be a positive number.');
            return;
        }
        if (memo && /[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        setFormError(null);
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

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
                params: actionParams,
            };
            const res = isHwSource
                ? await messaging.dividendActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.dividendAction({ ...base, password });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Dividend failed.',
            );
            setStage('review');
            if (!isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
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
                    ? 'Review dividend'
                    : `Pay dividend${titleSuffix}`}
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
                <h2 className={styles.successTitle}>Dividend sent</h2>
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
                    {preview ? (
                        <>
                            <dt className={styles.detailsLabel}>Eligible holders</dt>
                            <dd className={styles.detailsValue}>
                                {preview.eligibleCount}
                                {preview.sourceExcluded ? ' (source excluded)' : ''}
                            </dd>
                            {preview.total !== null ? (
                                <>
                                    <dt className={styles.detailsLabel}>Total distribution</dt>
                                    <dd className={styles.detailsValue}>
                                        ~{preview.total} {dividendTick.trim().toUpperCase()}
                                    </dd>
                                </>
                            ) : null}
                        </>
                    ) : null}
                </dl>
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <p className={styles.hint}>
                    DIVIDEND charges an XChain fee based on the number of database
                    hits (§DIVIDEND.md). Make sure the source address holds enough
                    DIVIDEND asset to cover the full payout.
                </p>
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
                {isHwSource && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
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
                        disabled={
                            isHwSource
                                ? hwStatus !== 'available'
                                : password.length === 0
                        }
                    >
                        {isHwSource
                            ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : (descriptor ? `Sign on ${descriptor.displayName}` : 'Sign')}
                    </Button>
                </div>
            </form>,
        );
    }

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
                    <span className={styles.fromLabel}>Paying from</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            <Input
                label="Holder-of token"
                hint="The token whose holders will receive this dividend."
                value={tick}
                onChange={(e) => setTick(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label="Dividend asset"
                hint="The token you are distributing."
                value={dividendTick}
                onChange={(e) => setDividendTick(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label="Per-unit amount"
                hint="Amount of dividend asset per 1 unit of holder-of token."
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Memo (optional)"
                hint="Protocol rejects | or ;."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />

            {tick.trim() ? (
                <p className={styles.hint}>
                    {holders.loading ? 'Counting holders…'
                        : holders.error ? `Couldn't load holders: ${holders.error}`
                            : holders.rows ? `${preview?.eligibleCount ?? 0} eligible holder${(preview?.eligibleCount ?? 0) === 1 ? '' : 's'}`
                                : ''}
                    {preview?.total !== null && preview?.total !== undefined
                        ? ` · total distribution ~${preview.total} ${dividendTick.trim().toUpperCase() || 'DIVIDEND'}`
                        : ''}
                </p>
            ) : null}

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !tick || !dividendTick || !amount}
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

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
