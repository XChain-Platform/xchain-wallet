import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Protocol coin tickers per xchain-sdk VALID_COINS. `descriptor.coin` is
// long-form ('bitcoin' / 'litecoin' / 'dogecoin'); SWAP serializes the
// short-form tickers in GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * §41.5 SWAP authoring surface.
 *
 * Builds a v0 Create SWAP — atomic token-pair swap that settles in one
 * transaction with no COINPAY follow-up. The v0 form is deliberately
 * single-chain in the default UX (GIVE_COIN = GET_COIN = current
 * chain's native ticker) because the common case is "swap MYTOKEN for
 * COOLCOIN on Bitcoin". Cross-chain swaps use the same SWAP primitive
 * but are out-of-scope for the Phase 3 form.
 *
 * SWAP does NOT work with native coin (BTC / LTC / DOGE) — that's
 * what DISPENSER is for. The form rejects inputs where GIVE_TICK or
 * GET_TICK match the chain's native ticker.
 *
 * Cancel (v1) and Edit (v2) share the same `swapAction` core flow
 * but route through a future "My swaps" surface; not built here.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function SwapForm({ walletId, onBack }) {
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
    const [giveTick, setGiveTick] = useState('');
    const [giveAmount, setGiveAmount] = useState('');
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'form' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before creating a swap.',
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

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const hw = isHwSource(fromAddress);

    const validationError = useMemo(() => {
        if (!giveTick) return null;
        if (!getTick) return null;
        // SWAP does NOT work with native coin per protocol rules.
        if (coinTicker && giveTick.toUpperCase() === coinTicker) {
            return `SWAP cannot give ${coinTicker} — use DISPENSER for token ↔ native coin.`;
        }
        if (coinTicker && getTick.toUpperCase() === coinTicker) {
            return `SWAP cannot get ${coinTicker} — use DISPENSER for token ↔ native coin.`;
        }
        if (giveTick.toUpperCase() === getTick.toUpperCase()) {
            return 'Give and get tickers must differ.';
        }
        return null;
    }, [giveTick, getTick, coinTicker]);

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !chainId) return;
        if (validationError) return;
        if (!giveTick || !giveAmount || !getTick || !getAmount) {
            setFormError('Fill give/get tickers and amounts before signing.');
            return;
        }
        if (!hw && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;

        setStage('submitting');
        setFormError(null);
        setSubmitError(null);
        try {
            const params = {
                VERSION: '0',
                GIVE_COIN: coinTicker,
                GIVE_TICK: giveTick.trim(),
                GIVE_AMOUNT: String(giveAmount).trim(),
                GET_COIN: coinTicker,
                GET_TICK: getTick.trim(),
                GET_AMOUNT: String(getAmount).trim(),
                ...(memo.trim() ? { MEMO: memo.trim() } : {}),
            };
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
                params,
            };
            const r = hw
                ? await messaging.swapActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.swapAction({ ...base, password });
            setResult(r);
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : err?.message || 'Sign failed.');
            setStage('form');
            if (!hw) {
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
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>Swap tokens</span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Back</Button>
                </div>
            </>,
        );
    }

    if (stage === 'done') {
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>SWAP broadcast</p>
                {result?.txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{result.txid}</code>
                    </p>
                ) : null}
                <p className={styles.hint}>
                    Your swap is now open. It will settle atomically when a
                    counterparty matches it; cancel or edit before match via
                    the SWAP action index.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    const chainIds = Object.keys(addressesByChain || {});

    return wrap(
        <form onSubmit={handleSubmit} noValidate>
            <label className={styles.fieldLabel}>
                <span>Chain</span>
                <select
                    className={styles.select}
                    value={chainId || ''}
                    onChange={(e) => setChainId(e.target.value)}
                >
                    {chainIds.map((cId) => {
                        const d = chainRegistry.get(cId);
                        return (
                            <option key={cId} value={cId}>
                                {d ? d.displayName : cId}
                            </option>
                        );
                    })}
                </select>
            </label>

            <label className={styles.fieldLabel}>
                <span>From address</span>
                <select
                    className={styles.select}
                    value={fromAddressId || ''}
                    onChange={(e) => setFromAddressId(e.target.value)}
                >
                    {(addressesByChain[chainId] || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.address}</option>
                    ))}
                </select>
            </label>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Input
                    label="Give ticker"
                    value={giveTick}
                    onChange={(e) => setGiveTick(e.target.value)}
                    placeholder="e.g. RAREPEPE"
                    autoCapitalize="characters"
                    style={{ flex: 1 }}
                />
                <Input
                    label="Give amount"
                    type="text"
                    inputMode="decimal"
                    value={giveAmount}
                    onChange={(e) => setGiveAmount(e.target.value)}
                    style={{ flex: 1 }}
                />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Input
                    label="Get ticker"
                    value={getTick}
                    onChange={(e) => setGetTick(e.target.value)}
                    placeholder="e.g. PEPECASH"
                    autoCapitalize="characters"
                    style={{ flex: 1 }}
                />
                <Input
                    label="Get amount"
                    type="text"
                    inputMode="decimal"
                    value={getAmount}
                    onChange={(e) => setGetAmount(e.target.value)}
                    style={{ flex: 1 }}
                />
            </div>

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />

            {validationError ? (
                <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>
                    {validationError}
                </p>
            ) : null}

            {fromAddress && chainId ? (
                <>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Chain</dt>
                        <dd className={styles.detailsValue}>
                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                        </dd>
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={fromAddress.address} />
                        </dd>
                    </dl>

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
                    {hw && submitError ? (
                        <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                            {submitError}
                        </p>
                    ) : null}
                </>
            ) : null}

            {formError ? (
                <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>
                    {formError}
                </p>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onBack}
                    disabled={stage === 'submitting'}
                >
                    Back
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'submitting'}
                    disabled={!!validationError
                        || !fromAddress
                        || !giveTick || !giveAmount || !getTick || !getAmount
                        || (hw ? hwStatus !== 'available' : password.length === 0)}
                >
                    {hw
                        ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                        : 'Sign swap'}
                </Button>
            </div>
        </form>,
    );
}
