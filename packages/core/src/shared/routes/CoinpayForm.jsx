// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { AddressText, Button, ChainBadge, FeeSelector, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { coinpayExpiryText } from '../../market/coinpayExpiry.js';
import { baseUnitsToCoinText, obligationBaseUnits } from '../../market/obligationStatus.js';
import { classifyObligation } from '../../market/obligationStatus.js';
import styles from './IssueTokenForm.module.css';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Shown when an obligation's wall-clock deadline has passed (PC-15).
// Expiry only settles at the next block past the deadline, so the row
// can still read `pending_coinpay`; paying in that gap risks a
// confirm-after-expiry, which sends the coin with no token settlement.
const EXPIRED_ERROR = 'This payment window has expired. Do not pay: a payment '
    + 'confirming after the deadline sends your coin without receiving the '
    + 'tokens. The escrowed tokens return to the seller.';

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
    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));

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

    const descriptor = selected ? chainRegistry.get(selected.chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const ownerLane = useOwnerActionLane({
        messaging,
        walletId,
        chainId: selected?.chainId,
        owner: selected?.addr || null,
        software: 'coinpayAction',
        hardware: 'coinpayActionHw',
    });

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
    // Display copy for the amount: coin scale with the ticker, matching the
    // Payments-due card. summary.coinAmount is base units and must never be
    // shown next to the ticker as if it were coins.
    const amountLabel = coinAmountLabel(summary?.coinAmount, coinTicker);

    // Network fee: Low / Normal / Fast / Custom, editable via FeeSelector on
    // the obligation-confirm stage. `feeEstimate` backs the slider readout and
    // the review row; `feePerKb` prices the broadcast. Mirrors ComposeMessage.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => (selected?.chainId
            ? estimateNativeSendFeeTiers({ chainId: selected.chainId, chainRegistry })
            : null),
        [selected],
    );
    const feeCustomEstimate = useMemo(
        () => (selected?.chainId && feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: selected.chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [selected, feePick],
    );
    const feeEstimate = !selected?.chainId
        ? null
        : (feePick.mode === 'custom'
            ? feeCustomEstimate
            : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: selected.chainId, chainRegistry, speed: feePick.mode })));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // Validate the selected obligation before advancing to review.
    // Signs nothing; just gates stage transition.
    function handleReview(event) {
        event.preventDefault();
        if (!selected || !summary) return;
        if (summary.coinAmount == null || !summary.payeeAddress) {
            setSubmitError('Obligation has no valid payee or a coin amount too large to pay safely.');
            return;
        }
        if (classifyObligation(summary.expiration).state === 'expired') {
            setSubmitError(EXPIRED_ERROR);
            return;
        }
        setSubmitError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!selected || !summary || stage === 'submitting' || ownerLane.composing) return;
        if (summary.coinAmount == null || !summary.payeeAddress) {
            setSubmitError('Obligation has no valid payee or a coin amount too large to pay safely.');
            return;
        }
        // PC-15 funds-safety re-check at sign time: the deadline can pass
        // while the user sits on the review screen, and a COINPAY that
        // confirms after expiry burns the coin with no token settlement.
        if (classifyObligation(summary.expiration).state === 'expired') {
            setSubmitError(EXPIRED_ERROR);
            setStage('review');
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
            if (ownerLane.isWatcherMode) {
                // Goes through the COINPAY-specific encode route, which
                // re-verifies the obligation before building the native output.
                // The generic buildActionPsbtRequest would happily encode a
                // payment to whatever payee/amount this screen handed it, and an
                // air-gapped signer only ever sees the outputs it is given.
                r = await messaging.buildCoinpayPsbtRequest({
                    ...base,
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else {
                // Compose the native payment output into the same PSBT that the
                // shared screen dry-runs and later hands to the signing flow.
                r = await ownerLane.run({
                    actionData: {
                        action: 'COINPAY',
                        params: { VERSION: '0', ORDER_MATCH_ACTION_INDEX: summary.actionIndex },
                    },
                    encoderOpts: {
                        customOutputs: [{ address: summary.payeeAddress, value: summary.coinAmount }],
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    submitExtra: {
                        orderMatchActionIndex: summary.actionIndex,
                        payeeAddress: summary.payeeAddress,
                        coinAmount: summary.coinAmount,
                    },
                });
            }
            setResult(r);
            setStage('done');
            // Only drop the obligation locally on a real broadcast; in
            // watcher mode the obligation stays open until the signed
            // PSBT actually broadcasts on a Full-mode wallet.
            if (!ownerLane.isWatcherMode) {
                setObligations((prev) => prev.filter((o) =>
                    !(o.chainId === selected.chainId
                      && String(o.obligation.action_index) === summary.actionIndex),
                ));
            }
        } catch (err) {
            if (isUserRejection(err)) {
                setStage('review');
                return;
            }
            const bad = err?.name === 'InvalidPasswordError';
            // Was the raw `err?.message`, i.e. the encoder's developer string
            // on screen; every other swept form maps through this helper.
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: selected.chainId,
                coinTicker,
                fallback: err?.message || 'Sign failed.',
            }));
            setStage('review');
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
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (ownerLane.open) {
        return (
            <ActionConfirmScreen
                {...ownerLane.confirmProps}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || selected?.chainId}
                signerReady={signerReady}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<QueuedResultPanel onDone={onBack} />);
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
                    Pay {amountLabel} to complete
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
                        value={amountLabel}
                    />
                    {coinpayExpiryText(summary.expiration) ? (
                        <DetailRow label="Expires" value={coinpayExpiryText(summary.expiration)} />
                    ) : null}
                    <DetailRow label="Network fee" value={feeLabel} />
                </dl>

                {ownerLane.isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : null}
                {submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : null}

                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting' || ownerLane.composing}
                    >
                        {ownerLane.isWatcherMode
                            ? 'Create unsigned transaction'
                            : 'Continue to confirmation'}
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
                            // Same canonical reader the confirm/review stages use
                            // (amountLabel below): coin_amount is the explorer's
                            // decimal coin figure, and echoing it verbatim skips
                            // the normalization (e.g. trailing-zero stripping)
                            // that reader does. Falls back to the raw figure only
                            // when the row can't be parsed at all.
                            const rowAmountLabel = coinAmountLabel(
                                safeBaseUnitAmount(row.obligation.coin_amount), t,
                            ) ?? `${row.obligation.coin_amount} ${t || 'base units'}`;
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
                                            Pay {rowAmountLabel} →{' '}
                                            <AddressText address={row.obligation.payee_address} />
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--xc-fg-muted)' }}>
                                            From <AddressText address={row.address} />
                                            {coinpayExpiryText(row.obligation.expiration) ? (
                                                <> · expires {coinpayExpiryText(row.obligation.expiration)}</>
                                            ) : null}
                                            {classifyObligation(row.obligation.expiration).state === 'expired' ? (
                                                <strong style={{ color: 'var(--xc-danger)' }}> · EXPIRED, do not pay</strong>
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
                            {amountLabel}
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

                    {feeTiers ? (
                        <FeeSelector
                            label="Network fee"
                            coinTicker={coinTicker}
                            tiers={feeTiers}
                            value={feePick}
                            onChange={setFeePick}
                            customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                        />
                    ) : null}

                    {submitError ? (
                        <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
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

// Parse an obligation's coin_amount into a safe positive base-unit
// integer, or null. Rejects values past Number.MAX_SAFE_INTEGER so a
// large-DOGE obligation can't be rounded into a wrong native-coin output.
function safeBaseUnitAmount(raw) {
    // The explorer serves the obligation's coin_amount as the match's DECIMAL
    // coin figure in every shape ("10" is ten coins), so it goes through the
    // one canonical reader (obligationBaseUnits) and this function keeps its
    // own contract: a positive, exactly-representable base-unit NUMBER, or
    // null.
    const base = obligationBaseUnits(raw);
    if (base === null || base <= 0n) return null;
    const n = Number(base);
    if (!Number.isSafeInteger(n)) return null;
    return n;
}

// Coin-scale copy for a base-unit amount, with the ticker: "10 DOGE" for
// 1000000000. Falls back to a labelled base-unit figure rather than a
// coin-labelled wrong number when the amount cannot be converted.
function coinAmountLabel(baseUnits, coinTicker) {
    if (baseUnits == null) return null;
    const coinText = baseUnitsToCoinText(String(baseUnits));
    return coinText != null
        ? `${coinText} ${coinTicker || 'coins'}`
        : `${baseUnits} base units`;
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
