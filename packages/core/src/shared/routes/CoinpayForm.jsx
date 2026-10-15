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
import {
    AddressText, Button, ChainBadge, EmptyState, FeeSelector, FormPage, Icon,
    ListPage, PageHeader, Screen, SectionHeader, StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
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
import { addressValidationError, isValidAddressForChain } from '../utils/addressValidation.js';

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

const EXPIRY_LOSS_WARNING = 'This payment must confirm before the payment deadline. '
    + 'If it confirms after the deadline, the coin is still sent but you do not '
    + 'receive the tokens.';

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
export function CoinpayForm(props) {
    const scope = [
        props.walletId,
        props.chainId,
        props.address,
        props.orderMatchActionIndex,
    ].map((value) => String(value ?? '')).join('\u0000');
    return <ScopedCoinpayForm key={scope} {...props} />;
}

function ScopedCoinpayForm({
    walletId,
    chainId: initialChainId,
    address: initialAddress,
    orderMatchActionIndex: initialActionIndex,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState(/** @type {string | null} */ (null));
    const [obligations, setObligations] = useState(/** @type {any[]} */ ([]));
    const [selected, setSelected] = useState(
        /** @type {{ chainId: string, address: string, obligation: any } | null} */ (null),
    );
    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [nativeBalance, setNativeBalance] = useState(
        /** @type {{ loading: boolean, baseUnits: bigint | null }} */
        ({ loading: false, baseUnits: null }),
    );

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
                if (!cancelled) {
                    setLoadError(loadFailureMessage(err, 'load this wallet\'s addresses'));
                }
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!addressesByChain) return undefined;
        // A demo wallet owes nothing and cannot pay: a demo wallet's addresses
        // never go to an explorer (issue #82).
        if (demoGuard.blocked) return undefined;
        let cancelled = false;
        setScanning(true);
        setScanError(null);
        setObligations([]);
        (async () => {
            /** @type {any[]} */
            const found = [];
            const pairs = [];
            const failures = [];
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
                } catch (error) {
                    failures.push(error);
                }
            }));
            if (cancelled) return;
            setObligations(found);
            setScanning(false);
            setScanError(failures.length > 0
                ? loadFailureMessage(failures[0], 'load every payment due')
                : null);
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
    }, [addressesByChain, messaging, initialActionIndex, initialChainId, initialAddress, demoGuard.blocked]);

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
        const actionIndex = o.action_index ?? o.actionIndex;
        const expiration = Number(o.expiration);
        return {
            actionIndex: actionIndex == null ? '' : String(actionIndex).trim(),
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
    const validationError = obligationValidationError({
        selected,
        summary,
        descriptor,
        feePick,
        feeEstimate,
        feePerKb,
    });
    const requiredBaseUnits = summary?.coinAmount == null
        ? null
        : BigInt(summary.coinAmount) + BigInt(feeEstimate?.sats || 0);
    const insufficientBalance = nativeBalance.baseUnits != null
        && requiredBaseUnits != null
        && nativeBalance.baseUnits < requiredBaseUnits;
    const insufficientBalanceMessage = insufficientBalance
        ? `Insufficient ${coinTicker || 'coin'} balance. This address has ${coinAmountLabel(nativeBalance.baseUnits, coinTicker)}, but the payment and estimated network fee require ${coinAmountLabel(requiredBaseUnits, coinTicker)}.`
        : null;

    useEffect(() => {
        if (!selected?.chainId || !selected?.address) {
            setNativeBalance({ loading: false, baseUnits: null });
            return undefined;
        }
        if (typeof messaging.getAddressBalances !== 'function') {
            setNativeBalance({ loading: false, baseUnits: null });
            return undefined;
        }
        let cancelled = false;
        setNativeBalance({ loading: true, baseUnits: null });
        messaging.getAddressBalances(selected.chainId, selected.address)
            .then((balances) => {
                if (cancelled) return;
                setNativeBalance({
                    loading: false,
                    baseUnits: nativeBalanceBaseUnits(balances, coinTicker),
                });
            })
            .catch(() => {
                if (!cancelled) setNativeBalance({ loading: false, baseUnits: null });
            });
        return () => { cancelled = true; };
    }, [selected?.chainId, selected?.address, coinTicker, messaging]);

    // Validate the selected obligation before advancing to review.
    // Signs nothing; just gates stage transition.
    function handleReview(event) {
        event.preventDefault();
        if (!selected || !summary) {
            setSubmitError('Choose a payment before continuing.');
            return;
        }
        if (validationError) {
            setSubmitError(validationError);
            return;
        }
        if (insufficientBalance) {
            setSubmitError(insufficientBalanceMessage);
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
        if (validationError) {
            setSubmitError(validationError);
            setStage('review');
            return;
        }
        if (insufficientBalance) {
            setSubmitError(insufficientBalanceMessage);
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
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: selected.chainId,
                coinTicker,
                verb: 'prepare this payment',
                fallback: "Couldn't prepare this payment. Check your connection and try again.",
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
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={titleText}
        />
    );
    const wrap = (children, template = 'list') => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {template === 'list' ? <ListPage>{children}</ListPage> : children}
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
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} unsaved={result?.unsaved} />);
        }
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
                <StatusMessage variant="success">
                    Payment broadcast successfully.
                </StatusMessage>
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
        const feeRateLabel = feeEstimate?.rate || 'Unavailable';

        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review matched order payment"
                onSubmit={handleSubmit}
                status={submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : stage === 'submitting' ? (
                    <StatusMessage>Preparing payment for confirmation…</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting' || ownerLane.composing}
                    >
                        {ownerLane.isWatcherMode
                            ? 'Create unsigned transaction'
                            : 'Continue to confirmation'}
                    </Button>
                )}
            >
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <DetailRow
                            label="Network"
                            value={<ChainBadge descriptor={descriptor} size="sm" />}
                        />
                    ) : null}
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
                        <DetailRow label="Payment deadline" value={coinpayExpiryText(summary.expiration)} />
                    ) : null}
                    <DetailRow label="Network fee rate" value={feeRateLabel} />
                </dl>

                <StatusMessage className={styles.error}>{EXPIRY_LOSS_WARNING}</StatusMessage>

                {ownerLane.isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : null}
            </FormPage>,
            'form',
        );
    }

    // Form stage: obligation picker. No credentials shown here; the user
    // picks an obligation then advances to review before signing.
    return wrap(
        <>
            {addressesByChain === null ? (
                <p className={styles.hint}>Loading addresses…</p>
            ) : null}
            {scanning && obligations.length === 0 ? (
                <p className={styles.hint}>Scanning for payments due…</p>
            ) : null}
            {scanError ? (
                <StatusMessage variant="error" className={styles.error}>{scanError}</StatusMessage>
            ) : null}
            {addressesByChain !== null && !scanning && !scanError && obligations.length === 0 ? (
                <EmptyState
                    title="No payments due"
                    body="When one of your orders matches, the coin payment for it appears here."
                />
            ) : null}

            {obligations.length > 0 ? (
                <>
                    <SectionHeader title="Pending obligations" />
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
                                    {/* The native row button keeps the whole obligation card as one target. */}
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
                                                ? '2px solid var(--xc-accent-primary)'
                                                : '1px solid var(--xc-border)',
                                            borderRadius: '4px',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            color: 'inherit',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                                            <span style={{ fontWeight: 600 }}>
                                                Matched order #{String(row.obligation.action_index)}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                            Pay {rowAmountLabel}{' '}
                                            <span className={styles.inlineDirectionalIcon}>
                                                <Icon.ForwardIcon />
                                            </span>{' '}
                                            <AddressText address={row.obligation.payee_address} />
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--xc-fg-muted)' }}>
                                            From <AddressText address={row.address} />
                                            {coinpayExpiryText(row.obligation.expiration) ? (
                                                <> · payment deadline {coinpayExpiryText(row.obligation.expiration)}</>
                                            ) : null}
                                            {classifyObligation(row.obligation.expiration).state === 'expired' ? (
                                                <strong style={{ color: 'var(--xc-danger-fg)' }}> · EXPIRED, do not pay</strong>
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
                <FormPage
                    demoGuard={demoGuard}
                    label="Selected payment obligation"
                    onSubmit={handleReview}
                    status={(submitError || validationError || insufficientBalanceMessage) ? (
                        <StatusMessage variant="error" className={styles.error}>
                            {submitError || validationError || insufficientBalanceMessage}
                        </StatusMessage>
                    ) : nativeBalance.loading ? (
                        <StatusMessage>Checking available balance…</StatusMessage>
                    ) : null}
                    actions={(
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={!selected || !summary || nativeBalance.loading
                                || Boolean(validationError) || insufficientBalance}
                        >
                            Review
                        </Button>
                    )}
                >
                    <dl className={styles.detailsList}>
                        {descriptor ? (
                            <>
                                <dt className={styles.detailsLabel}>Network</dt>
                                <dd className={styles.detailsValue}>
                                    <ChainBadge descriptor={descriptor} size="sm" />
                                </dd>
                            </>
                        ) : null}
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
                                <dt className={styles.detailsLabel}>Payment deadline</dt>
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

                </FormPage>
            ) : null}
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

function obligationValidationError({
    selected, summary, descriptor, feePick, feeEstimate, feePerKb,
}) {
    if (!selected || !summary) return null;
    if (!selected.chainId || !descriptor?.coin || !descriptor?.networkKind) {
        return 'This payment uses a network the wallet does not recognize. Return to Payments due and refresh.';
    }
    const sourceAddress = String(selected.addr?.address || '').trim();
    if (!sourceAddress || sourceAddress !== String(selected.address || '').trim()) {
        return 'The paying address no longer matches this wallet. Return to Payments due and refresh.';
    }
    if (!isValidAddressForChain(sourceAddress, descriptor.coin, descriptor.networkKind)) {
        return 'The paying address is not valid for this network. Return to Payments due and refresh.';
    }
    if (!summary.actionIndex) {
        return 'This payment has no matched order number. Return to Payments due and refresh.';
    }
    const payeeAddress = String(summary.payeeAddress || '').trim();
    if (!payeeAddress) {
        return 'This payment has no recipient address. Return to Payments due and refresh.';
    }
    if (!isValidAddressForChain(payeeAddress, descriptor.coin, descriptor.networkKind)) {
        return addressValidationError(payeeAddress, descriptor)
            || 'The recipient address is not valid for this network. Return to Payments due and refresh.';
    }
    if (summary.coinAmount == null) {
        return 'This payment amount is missing, invalid, or too large to pay safely. Return to Payments due and refresh.';
    }
    if (!coinpayExpiryText(summary.expiration)) {
        return 'This payment has no valid deadline. Return to Payments due and refresh.';
    }
    if (!feeEstimate || (feePick.mode === 'custom' && feePerKb == null)) {
        return 'Choose a valid network fee before continuing.';
    }
    return null;
}

function loadFailureMessage(error, verb) {
    return submitFailureMessage(error, {
        verb,
        fallback: `Couldn't ${verb}. Check your connection and try again.`,
    });
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

function nativeBalanceBaseUnits(balances, coinTicker) {
    const native = balances?.native;
    if (!native || (coinTicker && String(native.tick || '').toUpperCase() !== coinTicker)) {
        return null;
    }
    const quantity = String(native.quantity ?? '').trim();
    if (!/^\d+$/.test(quantity)) return null;
    try {
        return BigInt(quantity);
    } catch {
        return null;
    }
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
