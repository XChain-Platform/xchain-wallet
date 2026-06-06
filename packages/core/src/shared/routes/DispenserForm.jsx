// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 ChainPicker,  Icon, StatusMessage,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSettings } from '../hooks/useSettings.js';
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
export function DispenserForm({ walletId, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [ticker, setTicker] = useState((initialTick || '').toUpperCase());
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

    // Cluster P FOLLOWUP 5 — form-draft persistence. Persists every
    // user-visible composition field (chain / source / give terms /
    // advanced fields). Password stays in component state.
    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draft = useFormDraft({ view: 'dispenser', walletId, ttlMs: formDraftTtlMs });
    const [draftPending, setDraftPending] = useState(() => draft.hasDraft());
    useEffect(() => {
        if (stage !== 'form' || !draftPending) return;
        draft.save({
            chainId, fromAddressId, ticker, giveAmount, escrow,
            triggerPrice, oracleAddress, fiatCode, fiatAmount,
            showAdvanced,
        });
    }, [
        stage, draftPending, draft,
        chainId, fromAddressId, ticker, giveAmount, escrow,
        triggerPrice, oracleAddress, fiatCode, fiatAmount,
        showAdvanced,
    ]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(false); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.fromAddressId === 'string') setFromAddressId(v.fromAddressId);
        if (typeof v.ticker === 'string') setTicker(v.ticker);
        if (typeof v.giveAmount === 'string') setGiveAmount(v.giveAmount);
        if (typeof v.escrow === 'string') setEscrow(v.escrow);
        if (typeof v.triggerPrice === 'string') setTriggerPrice(v.triggerPrice);
        if (typeof v.oracleAddress === 'string') setOracleAddress(v.oracleAddress);
        if (typeof v.fiatCode === 'string') setFiatCode(v.fiatCode);
        if (typeof v.fiatAmount === 'string') setFiatAmount(v.fiatAmount);
        if (typeof v.showAdvanced === 'boolean') setShowAdvanced(v.showAdvanced);
        setDraftPending(true);
    }, [draft]);
    const dismissDraft = useCallback(() => {
        draft.clear();
        setDraftPending(false);
    }, [draft]);

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
                if (!lockedToken) setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const addrs = all.filter(
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
    }, [chainId, addressesByChain, initialFromAddress]);

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
            setFormError('Ticker must be A–Z, 0–9 (subtokens may include a period).');
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

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5 — watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !hw && password.length === 0) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
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
                    actionData: { action: 'DISPENSER', params: actionParams },
                });
            } else if (hw) {
                res = await messaging.dispenserActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.dispenserAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
            // Cluster P FOLLOWUP 5 — clear the draft on success.
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Dispenser creation failed.',
            );
            setStage('review');
            if (!isWatcherMode && !hw) {
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

    const titleSuffix = descriptor ? ` on ${descriptor.displayName}` : '';
        const header = (
        <ScreenHeader
            onBack={onBack}
            title="{stage === 'review' || stage === 'submitting'
                    ? 'Review dispenser'
                    : `Create dispenser${titleSuffix}`}"
        />
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
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode — this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
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
                {(isWatcherMode || hw) && submitError ? (
                    <StatusMessage
                        variant="error"
                        recovery={
                            // Cluster P FOLLOWUP 4 — encoder /
                            // network / device errors are recoverable
                            // by returning to the form stage and
                            // adjusting an input or re-staging the HW
                            // device. Wrong-password isn't reachable
                            // here (no password input in HW / watcher
                            // modes).
                            { label: 'Edit', onAction: () => { setSubmitError(null); setStage('form'); } }
                        }
                    >
                        {submitError}
                    </StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : hw
                                    ? hwStatus !== 'available'
                                    : password.length === 0
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : hw
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Sign on ${descriptor.displayName}` : 'Sign')}
                    </Button>
                </div>
            </form>,
        );
    }

    const draftBanner = draft.hasDraft() && !draftPending ? (
        <StatusMessage
            variant="status"
            recovery={{ label: 'Restore', onAction: restoreDraft }}
        >
            You have an unfinished dispenser draft.
            <button
                type="button"
                onClick={dismissDraft}
                aria-label="Discard saved draft"
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    marginInlineStart: 'var(--xc-space-2)',
                    fontSize: 'var(--xc-text-xs)',
                }}
            >
                Discard
            </button>
        </StatusMessage>
    ) : null;

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {draftBanner}
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={ticker} />
            ) : (
                <>
                    {chainsWithAddresses.length > 1 ? (
                        <ChainPicker label="Chain" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses} chainRegistry={chainRegistry} />
                    ) : descriptor ? (
                        <div className={styles.chainLine}>
                            <ChainBadge descriptor={descriptor} size="sm" />
                        </div>
                    ) : null}
                </>
            )}

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

            {lockedToken ? null : (
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
            )}
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
                // Cluster P FOLLOWUP 4 — formError is field-level
                // validation. Recovery is user-iteration over the
                // Inputs above; no one-click affordance fits.
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
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
