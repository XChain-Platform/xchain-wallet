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
    ScreenHeader,
    Button,
    Input,
    ChainBadge,
    ChainPicker,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
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
 * Ownership trading: either side can trade the token's *ownership
 * record* (the asset name) instead of a balance via the give/get
 * ownership toggles (GIVE_OWNERSHIP / GET_OWNERSHIP). Ownership trades
 * carry no amount and are single-fill; ownership-for-ownership swaps set
 * both toggles.
 *
 * Cancel (v1) and Edit (v2) share the same `swapAction` core flow
 * but route through a future "My swaps" surface; not built here.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]       seed the chain (e.g. launched from ManageToken)
 * @param {string} [props.initialGiveTick]      prefill the give ticker
 * @param {boolean} [props.initialGiveOwnership] open in give-ownership mode (sell a token name)
 */
export function SwapForm({ walletId, onBack, initialChainId, initialGiveTick, initialGiveOwnership }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [giveTick, setGiveTick] = useState((initialGiveTick || '').toUpperCase());
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(!!initialGiveOwnership);
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);
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
                // Don't clobber a caller-seeded chain (ManageToken sell flow).
                setChainId((c) => c || first);
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
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: hw ? fromAddress?.signerId : null,
    });

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

    // §20 / Cluster W FOLLOWUP 5 — watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !chainId) return;
        if (validationError) return;
        if (!giveTick || !getTick
            || (!giveOwnership && !giveAmount)
            || (!getOwnership && !getAmount)) {
            setFormError('Fill the give/get tickers and amounts before signing.');
            return;
        }
        if (!isWatcherMode && !hw && password.length === 0) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        setStage('submitting');
        setFormError(null);
        setSubmitError(null);
        try {
            const params = {
                VERSION: '0',
                GIVE_COIN: coinTicker,
                GIVE_TICK: giveTick.trim(),
                // Ownership side escrows the token's ownership record — no
                // amount; otherwise serialize the balance amount.
                ...(giveOwnership
                    ? { GIVE_OWNERSHIP: '1' }
                    : { GIVE_AMOUNT: String(giveAmount).trim() }),
                GET_COIN: coinTicker,
                GET_TICK: getTick.trim(),
                ...(getOwnership
                    ? { GET_OWNERSHIP: '1' }
                    : { GET_AMOUNT: String(getAmount).trim() }),
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
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'SWAP', params },
                });
            } else if (hw) {
                r = await messaging.swapActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                r = await messaging.swapAction({ ...base, password });
            }
            setResult(r);
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : err?.message || 'Sign failed.');
            setStage('form');
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

        const header = (
        <ScreenHeader
            onBack={onBack}
            title="Swap tokens"
        />
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
                </div>
            </>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid;
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
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>SWAP broadcast</p>
                {txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{txid}</code>
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
            <ChainPicker
                label="Chain"
                value={chainId}
                onChange={setChainId}
                chainIds={chainIds}
                chainRegistry={chainRegistry}
            />

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
                {giveOwnership ? null : (
                    <Input
                        label="Give amount"
                        type="text"
                        inputMode="decimal"
                        value={giveAmount}
                        onChange={(e) => setGiveAmount(e.target.value)}
                        style={{ flex: 1 }}
                    />
                )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>
                <input
                    type="checkbox"
                    checked={giveOwnership}
                    onChange={(e) => setGiveOwnership(e.target.checked)}
                />
                Give this token&apos;s ownership instead of an amount
            </label>
            {giveOwnership ? (
                <p className={styles.hint} style={{ margin: '0 0 0.5rem' }}>
                    Transfers the entire ownership of {giveTick.trim() ? giveTick.trim().toUpperCase() : 'this token'} — single-fill, no partial matches.
                </p>
            ) : null}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Input
                    label="Get ticker"
                    value={getTick}
                    onChange={(e) => setGetTick(e.target.value)}
                    placeholder="e.g. PEPECASH"
                    autoCapitalize="characters"
                    style={{ flex: 1 }}
                />
                {getOwnership ? null : (
                    <Input
                        label="Get amount"
                        type="text"
                        inputMode="decimal"
                        value={getAmount}
                        onChange={(e) => setGetAmount(e.target.value)}
                        style={{ flex: 1 }}
                    />
                )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>
                <input
                    type="checkbox"
                    checked={getOwnership}
                    onChange={(e) => setGetOwnership(e.target.checked)}
                />
                Require the matcher to give that token&apos;s ownership instead of an amount
            </label>
            {getOwnership ? (
                <p className={styles.hint} style={{ margin: '0 0 0.5rem' }}>
                    The matcher must currently own {getTick.trim() ? getTick.trim().toUpperCase() : 'this token'}; on match its ownership transfers to you.
                </p>
            ) : null}

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
                            signerInfo={hwSignerInfo}
                        />
                    )}
                    {(isWatcherMode || hw) && submitError ? (
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
                    type="submit"
                    variant="primary"
                    loading={stage === 'submitting'}
                    disabled={!!validationError
                        || !fromAddress
                        || !giveTick || !getTick
                        || (!giveOwnership && !giveAmount)
                        || (!getOwnership && !getAmount)
                        || (isWatcherMode
                            ? false
                            : hw ? hwStatus !== 'available' : password.length === 0)}
                >
                    {isWatcherMode
                        ? 'Create unsigned transaction'
                        : hw
                            ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Sign swap'}
                </Button>
            </div>
        </form>,
    );
}
