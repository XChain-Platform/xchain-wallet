// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
import { coinpayExpiryText } from '../../market/coinpayExpiry.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * §41.4 COINPAY authoring surface. Settles a pending coinpay
 * obligation (created when a non-BTC token matched against a native
 * BTC/LTC/DOGE order). The user arrives here via:
 *   - The Home resume card, when a wallet address has a
 *     `pending_coinpay` obligation, OR
 *   - The ActionsMenu "Pay COINPAY" entry, which opens this form
 *     without a prefilled obligation and scans the wallet on mount.
 *
 * Flow: form -> review -> submitting -> done. Nothing is signed
 * or broadcast until the user reaches the review stage and confirms.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]          preselected chain from the resume card
 * @param {string} [props.address]          preselected payer address (matches an address on `chainId`)
 * @param {string} [props.orderMatchActionIndex]  preselected obligation
 * @param {() => void} props.onBack
 */
export function CoinpayForm({
    walletId,
    chainId: initialChainId,
    address: initialAddress,
    orderMatchActionIndex: initialActionIndex,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [scanning, setScanning] = useState(false);
    const [obligations, setObligations] = useState(/** @type {any[]} */ ([]));
    const [selected, setSelected] = useState(
        /** @type {{ chainId: string, address: string, obligation: any } | null} */ (null),
    );
    const [password, setPassword] = useState('');
    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                if (!byChain || Object.keys(byChain).length === 0) {
                    setLoadError(
                        'No addresses in this wallet. Paying a matched order requires a funded address.',
                    );
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!addressesByChain) return undefined;
        let cancelled = false;
        setScanning(true);
        setObligations([]);
        (async () => {
            /** @type {any[]} */
            const found = [];
            const pairs = [];
            for (const [cId, addrs] of Object.entries(addressesByChain)) {
                for (const addr of addrs) {
                    pairs.push({ chainId: cId, address: addr.address, addr });
                }
            }
            await Promise.all(pairs.map(async (pair) => {
                try {
                    const resp = await messaging.getCoinpayObligationsForAddress({
                        chainId: pair.chainId,
                        address: pair.address,
                    });
                    const rows = extractRows(resp);
                    for (const row of rows) {
                        if (!isPendingForPayer(row, pair.address)) continue;
                        found.push({
                            chainId: pair.chainId,
                            address: pair.address,
                            addr: pair.addr,
                            obligation: row,
                        });
                    }
                } catch {
                    // Isolated failure per chain/address; other lookups still land.
                }
            }));
            if (cancelled) return;
            setObligations(found);
            setScanning(false);
            if (initialActionIndex) {
                const match = found.find((f) =>
                    String(f.obligation.action_index) === String(initialActionIndex)
                    && (!initialChainId || f.chainId === initialChainId)
                    && (!initialAddress || f.address === initialAddress)
                );
                if (match) setSelected(match);
            }
        })();
        return () => { cancelled = true; };
    }, [addressesByChain, messaging, initialActionIndex, initialChainId, initialAddress]);

    // Focus the password field when entering review so the user can
    // sign without lifting their hands off the keyboard.
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = selected ? chainRegistry.get(selected.chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const hw = isHwSource(selected?.addr);

    const summary = useMemo(() => {
        if (!selected) return null;
        const o = selected.obligation;
        const payeeAddress = o.payee_address || o.payeeAddress;
        const expiration = Number(o.expiration);
        return {
            actionIndex: String(o.action_index ?? o.actionIndex),
            payeeAddress,
            // Base-unit native amount. null when missing OR beyond safe
            // integer precision (large DOGE): both the real-broadcast and
            // watcher paths pass this straight to a native output, so an
            // imprecise value would mispay. Fail closed here (blocks
            // review) rather than sign a rounded output. Kept in sync with
            // coinpayAction's guard.
            coinAmount: safeBaseUnitAmount(o.coin_amount ?? o.coinAmount),
            expiration: Number.isFinite(expiration) ? expiration : null,
        };
    }, [selected]);

    // Fee estimate for the review screen. Recomputed when the selected
    // chain changes; null for unknown chains or missing chainId.
    const feeEstimate = useMemo(() => {
        if (!selected?.chainId) return null;
        return estimateNativeSendFee({ chainId: selected.chainId, chainRegistry });
    }, [selected]);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // Validate the selected obligation before advancing to review.
    // Signs nothing; just gates stage transition.
    function handleReview(event) {
        event.preventDefault();
        if (!selected || !summary) return;
        if (summary.coinAmount == null || !summary.payeeAddress) {
            setSubmitError('Obligation has no valid payee or a coin amount too large to pay safely.');
            return;
        }
        setSubmitError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!selected || !summary || stage === 'submitting') return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        if (summary.coinAmount == null || !summary.payeeAddress) {
            setSubmitError('Obligation has no valid payee or a coin amount too large to pay safely.');
            return;
        }
        setStage('submitting');
        setSubmitError(null);
        try {
            const from = {
                address: selected.addr.address,
                publicKey: selected.addr.publicKey,
                derivationPath: selected.addr.derivationPath,
                addressId: selected.addr.id,
                source: selected.addr.source,
                signerId: selected.addr.signerId,
            };
            const base = {
                walletId,
                chainId: selected.chainId,
                from,
                orderMatchActionIndex: summary.actionIndex,
                payeeAddress: summary.payeeAddress,
                coinAmount: summary.coinAmount,
            };
            let r;
            if (isWatcherMode) {
                const params = {
                    VERSION: '0',
                    ORDER_MATCH_ACTION_INDEX: String(summary.actionIndex),
                };
                r = await messaging.buildActionPsbtRequest({
                    chainId: selected.chainId,
                    from,
                    actionData: { action: 'COINPAY', params },
                    encoderOpts: {
                        customOutputs: [{ address: summary.payeeAddress, value: summary.coinAmount }],
                    },
                });
            } else if (hw) {
                r = await messaging.coinpayActionHw({ ...base, signerId: selected.addr.signerId });
            } else {
                r = await messaging.coinpayAction({ ...base, password });
            }
            setResult(r);
            setStage('done');
            // Only drop the obligation locally on a real broadcast; in
            // watcher mode the obligation stays open until the signed
            // PSBT actually broadcasts on a Full-mode wallet.
            if (!isWatcherMode) {
                setObligations((prev) => prev.filter((o) =>
                    !(o.chainId === selected.chainId
                      && String(o.obligation.action_index) === summary.actionIndex),
                ));
            }
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : err?.message || 'Sign failed.');
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

    const titleText = (stage === 'review' || stage === 'submitting')
        ? 'Review payment'
        : 'Pay for matched order';
    const header = (
        <PageHeader
            onBack={onBack}
            title={titleText}
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
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Payment broadcast</p>
                {txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{txid}</code>
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    // Review + submitting: show the obligation details, sign credentials,
    // and the confirm button. No signing happens until this stage.
    if (stage === 'review' || stage === 'submitting') {
        const feeLabel = (() => {
            if (!feeEstimate) return 'Estimate unavailable';
            const ticker = coinTicker || 'coins';
            const base = `${feeEstimate.coinAmount} ${ticker}`;
            return feeEstimate.rate ? `${base} (${feeEstimate.rate})` : base;
        })();

        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Pay {summary.coinAmount} {coinTicker || 'base units'} to complete
                    matched order #{summary.actionIndex}.
                </p>
                <dl className={styles.detailsList}>
                    <DetailRow
                        label="Chain"
                        value={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : selected.chainId}
                    />
                    <DetailRow
                        label="From"
                        value={<AddressText address={selected.address} />}
                    />
                    <DetailRow
                        label="Matched order"
                        value={<code>{summary.actionIndex}</code>}
                    />
                    <DetailRow
                        label="Paying to"
                        value={<AddressText address={summary.payeeAddress} />}
                    />
                    <DetailRow
                        label="Amount"
                        value={`${summary.coinAmount} ${coinTicker || 'base units'}`}
                    />
                    {coinpayExpiryText(summary.expiration) ? (
                        <DetailRow label="Expires" value={coinpayExpiryText(summary.expiration)} />
                    ) : null}
                    <DetailRow label="Network fee" value={feeLabel} />
                </dl>

                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={selected.addr}
                        chainId={selected.chainId}
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
                                : hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : hw
                                ? `Sign on ${selected.addr.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : 'Sign payment'}
                    </Button>
                </div>
            </form>,
        );
    }

    // Form stage: obligation picker. No credentials shown here; the user
    // picks an obligation then advances to review before signing.
    return wrap(
        <>
            {scanning && obligations.length === 0 ? (
                <p className={styles.hint}>Scanning for payments due…</p>
            ) : null}
            {!scanning && obligations.length === 0 ? (
                <p className={styles.hint}>
                    No payments due right now. When one of your orders
                    matches, the coin payment for it appears here.
                </p>
            ) : null}

            {obligations.length > 0 ? (
                <>
                    <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>
                        Pending obligations
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
                        {obligations.map((row) => {
                            const isSelected = selected
                                && selected.chainId === row.chainId
                                && String(selected.obligation.action_index) === String(row.obligation.action_index);
                            const d = chainRegistry.get(row.chainId);
                            const t = d ? PROTOCOL_COIN_TICKER[d.coin] : '';
                            return (
                                <li key={`${row.chainId}-${row.obligation.action_index}`}>
                                    <button
                                        type="button"
                                        onClick={() => setSelected(row)}
                                        aria-pressed={isSelected}
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '0.5rem',
                                            marginBottom: '0.25rem',
                                            border: isSelected
                                                ? '2px solid var(--xc-accent, #1976d2)'
                                                : '1px solid var(--xc-border)',
                                            borderRadius: '4px',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            color: 'inherit',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            {d ? <ChainBadge descriptor={d} size="sm" /> : <span>{row.chainId}</span>}
                                            <span style={{ fontWeight: 600 }}>
                                                Matched order #{String(row.obligation.action_index)}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                            Pay {row.obligation.coin_amount} {t || 'base units'} →{' '}
                                            <AddressText address={row.obligation.payee_address} />
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--xc-fg-muted)' }}>
                                            From <AddressText address={row.address} />
                                            {coinpayExpiryText(row.obligation.expiration) ? (
                                                <> · expires {coinpayExpiryText(row.obligation.expiration)}</>
                                            ) : null}
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </>
            ) : null}

            {selected && summary ? (
                <form onSubmit={handleReview} noValidate>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Chain</dt>
                        <dd className={styles.detailsValue}>
                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : selected.chainId}
                        </dd>
                        <dt className={styles.detailsLabel}>Matched order</dt>
                        <dd className={styles.detailsValue}>
                            <code>{summary.actionIndex}</code>
                        </dd>
                        <dt className={styles.detailsLabel}>Paying from</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={selected.address} />
                        </dd>
                        <dt className={styles.detailsLabel}>Paying to</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={summary.payeeAddress} />
                        </dd>
                        <dt className={styles.detailsLabel}>Amount</dt>
                        <dd className={styles.detailsValue}>
                            {summary.coinAmount} {coinTicker || 'base units'}
                        </dd>
                        {coinpayExpiryText(summary.expiration) ? (
                            <>
                                <dt className={styles.detailsLabel}>Expires</dt>
                                <dd className={styles.detailsValue}>
                                    {coinpayExpiryText(summary.expiration)}
                                </dd>
                            </>
                        ) : null}
                    </dl>

                    {submitError ? (
                        <div role="alert" className={styles.error}>{submitError}</div>
                    ) : null}

                    <div className={styles.actions}>
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={!selected || !summary}
                        >
                            Review
                        </Button>
                    </div>
                </form>
            ) : (
                <div className={styles.actions}>
                </div>
            )}
        </>,
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

// Parse a server-supplied base-unit coin amount into a safe positive
// integer, or null. Rejects non-integer shapes and values past
// Number.MAX_SAFE_INTEGER so a large-DOGE obligation can't be rounded
// into a wrong native-coin output.
function safeBaseUnitAmount(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'string' && !/^\d+$/.test(raw.trim())) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    return n;
}

function isPendingForPayer(row, address) {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.coinpay_status || row.status || '').toLowerCase();
    if (status !== 'pending_coinpay') return false;
    const payer = row.payer_address || row.payerAddress;
    return typeof payer === 'string' && payer === address;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.obligations)) return resp.obligations;
    if (Array.isArray(resp.coinpay_obligations)) return resp.coinpay_obligations;
    return [];
}
