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
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Protocol coin tickers per xchain-sdk VALID_COINS — mirrors
// DispenserForm. `descriptor.coin` is long-form ('bitcoin' / ...).
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
 * The form is deliberately read-only above the sign block — the user
 * doesn't pick an obligation's payee or amount, they confirm it.
 * Overpaying would be wasteful; underpaying would fail validation.
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
        /** @type {'form' | 'submitting' | 'done'} */ ('form'),
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
                        'No addresses in this wallet. COINPAY requires a funded payer address.',
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
                    // Isolated failure per chain/address — other lookups still land.
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

    const descriptor = selected ? chainRegistry.get(selected.chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const hw = isHwSource(selected?.addr);

    const summary = useMemo(() => {
        if (!selected) return null;
        const o = selected.obligation;
        const payeeAddress = o.payee_address || o.payeeAddress;
        const amount = Number(o.coin_amount ?? o.coinAmount);
        const expiration = Number(o.expiration);
        return {
            actionIndex: String(o.action_index ?? o.actionIndex),
            payeeAddress,
            coinAmount: Number.isFinite(amount) ? amount : null,
            expiration: Number.isFinite(expiration) ? expiration : null,
        };
    }, [selected]);

    // §20 / Cluster W FOLLOWUP 5 — watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    async function handleSubmit(event) {
        event.preventDefault();
        if (!selected || !summary || stage === 'submitting') return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        if (summary.coinAmount == null || !summary.payeeAddress) {
            setSubmitError('Obligation is missing payee or coin amount.');
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
                // COINPAY action params per coinpayAction flow:
                //   VERSION / ORDER_MATCH_ACTION_INDEX
                // Encoder needs `customOutputs` so the buyer pays the
                // matched seller's address — preserved through encoderOpts.
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
            title="Pay COINPAY"
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
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>COINPAY broadcast</p>
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

    return wrap(
        <>
            {scanning && obligations.length === 0 ? (
                <p className={styles.hint}>Scanning for pending COINPAY obligations…</p>
            ) : null}
            {!scanning && obligations.length === 0 ? (
                <p className={styles.hint}>
                    No pending COINPAY obligations. COINPAY settles matched
                    orders between a token and a native coin; a new entry
                    appears here once one of your orders matches.
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
                                                ORDER_MATCH #{String(row.obligation.action_index)}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                            Pay {row.obligation.coin_amount} {t || 'base units'} →{' '}
                                            <AddressText address={row.obligation.payee_address} />
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--xc-fg-muted)' }}>
                                            From <AddressText address={row.address} />
                                            {row.obligation.expiration ? (
                                                <> · expires at block {row.obligation.expiration}</>
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
                <form onSubmit={handleSubmit} noValidate>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Chain</dt>
                        <dd className={styles.detailsValue}>
                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : selected.chainId}
                        </dd>
                        <dt className={styles.detailsLabel}>ORDER_MATCH</dt>
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
                        {summary.expiration ? (
                            <>
                                <dt className={styles.detailsLabel}>Expires at</dt>
                                <dd className={styles.detailsValue}>
                                    block {summary.expiration}
                                </dd>
                            </>
                        ) : null}
                    </dl>

                    {isWatcherMode ? (
                        <p className={styles.hint}>
                            Watcher mode — this wallet will build an unsigned transaction.
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
                        <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                            {submitError}
                        </p>
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
                                    : 'Sign COINPAY'}
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
