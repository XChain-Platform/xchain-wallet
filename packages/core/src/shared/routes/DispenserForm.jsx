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

// Protocol coin tickers per xchain-sdk VALID_COINS. The registry's
// descriptor.coin values are long-form ('bitcoin' / 'litecoin' /
// 'dogecoin'); DISPENSER serializes the short-form tickers.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// §40.7.1's Mode 1 FIAT dispenser uses the validator oracle (no
// ORACLE_ADDRESS); Mode 2 uses a user oracle (ORACLE_ADDRESS). For
// the initial form we expose the optional ORACLE_ADDRESS + FIAT_CODE
// fields under "Advanced options" so the §40.7.1 primary flow stays
// uncluttered.
const FIAT_CODES = ['USD', 'CAD', 'AUD', 'MXN', 'GBP', 'JPY', 'CNY', 'CHF', 'BRL', 'INR', 'EUR', 'KRW'];

/**
 * Dispenser authoring form — §40.7.1.
 *
 * Opens a new DISPENSER (v0 Create) so a token owner can vend
 * `GIVE_AMOUNT` of their token every time a buyer sends
 * `GET_AMOUNT` of the native coin (or, in the FIAT lane, an
 * oracle-priced fiat-equivalent amount) to the dispenser address.
 *
 * Spec defaults:
 *   - GIVE_COIN + GET_COIN = the current chain's protocol ticker
 *     (BTC / LTC / DOGE). Dispensers do not cross chains.
 *   - GET_TICK = '' (coin-paid) when the buyer pays in the native
 *     coin — the primary §40.7.1 lane. The SDK validator from
 *     xchain-sdk@1.8.1 accepts an empty GET_TICK as long as
 *     GET_COIN is set.
 *   - GET_ADDRESS left empty — protocol defaults to SOURCE.
 *
 * Cancel + Edit (v1 / v2) are not exposed here; those land alongside
 * a dispenser-detail surface in a later step.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DispenserForm({ walletId, onBack }) {
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
    const [giveAmount, setGiveAmount] = useState('');
    const [escrow, setEscrow] = useState('');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [oracleAddress, setOracleAddress] = useState('');
    const [fiatCode, setFiatCode] = useState('');
    const [fiatAmount, setFiatAmount] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
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
                        'No addresses on any chain yet. Use Receive to generate one before opening a dispenser.',
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
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    const fillsEstimate = useMemo(() => {
        const ga = Number(giveAmount);
        const esc = Number(escrow);
        if (!Number.isFinite(ga) || ga <= 0) return null;
        if (!Number.isFinite(esc) || esc <= 0) return null;
        return Math.floor(esc / ga);
    }, [giveAmount, escrow]);

    const summaryLine = useMemo(() => {
        const tick = ticker.trim().toUpperCase() || 'TOKEN';
        const per = giveAmount.trim() || '?';
        const esc = escrow.trim() || '?';
        if (oracleAddress.trim() && fiatCode) {
            return `You will lock ${esc} ${tick}. Each fill sends ${per} ${tick} at the oracle-priced ${fiatCode} rate.`;
        }
        if (fiatAmount.trim() && fiatCode) {
            return `You will lock ${esc} ${tick}. Each fill sends ${per} ${tick} when someone pays ${fiatAmount} ${fiatCode}.`;
        }
        const trig = triggerPrice.trim() || '?';
        const coin = coinTicker || 'coin';
        const fillsNote = fillsEstimate !== null ? ` The dispenser holds about ${fillsEstimate} fills.` : '';
        return `You will lock ${esc} ${tick}. Each time someone sends ${trig} ${coin}, they will receive ${per} ${tick}.${fillsNote}`;
    }, [ticker, giveAmount, escrow, triggerPrice, oracleAddress, fiatCode, fiatAmount, coinTicker, fillsEstimate]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0' };
        const tick = ticker.trim().toUpperCase();
        const ga = giveAmount.trim();
        const esc = escrow.trim();
        const trig = triggerPrice.trim();
        const oracle = oracleAddress.trim();
        const fa = fiatAmount.trim();

        if (tick) p.GIVE_TICK = tick;
        if (coinTicker) p.GIVE_COIN = coinTicker;
        if (ga) p.GIVE_AMOUNT = ga;
        if (esc) p.GIVE_ESCROW = esc;

        // Coin-paid lane: GET_COIN = chain coin, GET_TICK empty.
        if (coinTicker) p.GET_COIN = coinTicker;

        if (oracle) {
            // Oracle pricing: validator path (fiatAmount + code) or user-
            // oracle path (oracle + code, fiatAmount empty). GET_AMOUNT
            // is typically 0 per DISPENSER.md example 4/5 because the
            // effective coin price is derived dynamically.
            p.GET_AMOUNT = trig || '0';
            p.ORACLE_ADDRESS = oracle;
            if (fiatCode) p.FIAT_CODE = fiatCode;
            if (fa) p.FIAT_AMOUNT = fa;
        } else if (fiatCode && fa) {
            // Validator FIAT path — no oracle, but fiat code + amount set.
            p.GET_AMOUNT = trig || '0';
            p.FIAT_CODE = fiatCode;
            p.FIAT_AMOUNT = fa;
        } else {
            // Plain coin-paid dispenser.
            if (trig) p.GET_AMOUNT = trig;
        }

        return p;
    }, [ticker, giveAmount, escrow, triggerPrice, oracleAddress, fiatCode, fiatAmount, coinTicker]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DISPENSER',
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
            setFormError('Token ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9.]+$/.test(ticker.trim())) {
            setFormError('Ticker must be A–Z, 0–9 (subassets may include a period).');
            return;
        }
        const ga = giveAmount.trim();
        if (!ga || Number(ga) <= 0) {
            setFormError('Per-fill give amount must be a positive number.');
            return;
        }
        const esc = escrow.trim();
        if (!esc || Number(esc) <= 0) {
            setFormError('Escrow amount must be a positive number.');
            return;
        }
        if (Number(esc) < Number(ga)) {
            setFormError('Escrow is smaller than a single fill — the dispenser would never dispense.');
            return;
        }
        const oracle = oracleAddress.trim();
        const fa = fiatAmount.trim();
        const trig = triggerPrice.trim();
        if (!oracle && !fa && !trig) {
            setFormError('Set a trigger price, or enable FIAT / oracle pricing under Advanced.');
            return;
        }
        if (trig && Number(trig) < 0) {
            setFormError('Trigger price cannot be negative.');
            return;
        }
        if (oracle && !fiatCode) {
            setFormError('Oracle pricing requires a FIAT_CODE — pick a fiat currency under Advanced.');
            return;
        }
        if (fa && !/^\d+\.\d{2}$/.test(fa)) {
            setFormError('FIAT amount must be in X.XX format.');
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
            const res = await messaging.dispenserAction({
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
                    : err?.message || 'Dispenser creation failed.',
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
                    ? 'Review dispenser'
                    : `Create dispenser${titleSuffix}`}
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
                <h2 className={styles.successTitle}>Dispenser opened</h2>
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
                <p className={styles.hint}>{summaryLine}</p>
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
                    <span className={styles.fromLabel}>Opening on</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            <Input
                label="Token"
                hint="Ticker of the token you will dispense. Must be owned by this address."
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label="Give amount (per fill)"
                hint="Tokens sent to the buyer every time the dispenser is triggered."
                inputMode="decimal"
                value={giveAmount}
                onChange={(e) => setGiveAmount(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Escrow amount"
                hint="Total tokens locked in the dispenser. Must be ≥ one fill."
                inputMode="decimal"
                value={escrow}
                onChange={(e) => setEscrow(e.target.value)}
                autoComplete="off"
            />
            <Input
                label={`Trigger price${coinTicker ? ` (${coinTicker})` : ''}`}
                hint={`Native ${coinTicker || 'coin'} amount buyers send per fill.`}
                inputMode="decimal"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                autoComplete="off"
            />

            <button
                type="button"
                className={styles.pickerLabel}
                onClick={() => setShowAdvanced((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
                {showAdvanced ? '▾ Advanced options' : '▸ Advanced options (FIAT pricing, oracle)'}
            </button>

            {showAdvanced ? (
                <>
                    <label className={styles.pickerLabel}>
                        Priced in FIAT (optional)
                        <select
                            className={styles.picker}
                            value={fiatCode}
                            onChange={(e) => setFiatCode(e.target.value)}
                        >
                            <option value="">— none (coin-paid) —</option>
                            {FIAT_CODES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </label>
                    <Input
                        label="FIAT amount (X.XX)"
                        hint="Validator-priced FIAT dispenser. Leave blank if using a user oracle."
                        inputMode="decimal"
                        value={fiatAmount}
                        onChange={(e) => setFiatAmount(e.target.value)}
                        autoComplete="off"
                    />
                    <Input
                        label="Oracle address (optional)"
                        hint="User-oracle (PRICE v1) address for FIAT pricing. Requires a FIAT_CODE."
                        value={oracleAddress}
                        onChange={(e) => setOracleAddress(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                </>
            ) : null}

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !ticker || !giveAmount || !escrow}
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
