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
    Input,
    ChainBadge,
    NetworkField,
    AddressText,
 Icon, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { ContractConsentPanel } from '../components/ContractConsentPanel.jsx';
import { preferredSourceId } from '../addressSelection.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { contractBalanceRows, contractBalanceOf } from './contractResponseShape.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * DEPOSIT / WITHDRAW form (§42.5).
 *
 * One component handles both modes via the `mode` prop. The protocol
 * field shape is identical (CONTRACT_ACTION_INDEX + TICK + QUANTITY),
 * the validator accepts both, and the sign-screen / HW branch /
 * error-handling chassis is the same; the only copy that changes is
 * the verb ("Deposit to" vs "Withdraw from") and the summary line.
 *
 * Kept as two exported routes rather than one mode-switched flow at
 * the App.jsx level so the sub-route string ("contract-deposit" vs
 * "contract-withdraw") and the messaging helper pair stay visible.
 *
 * @param {object} props
 * @param {'deposit' | 'withdraw'} props.mode
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.contractActionIndex
 * @param {() => void} props.onBack
 */
export function ContractFundsForm({ mode, walletId, chainId, contractActionIndex, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isDeposit = mode === 'deposit';
    const verb = isDeposit ? 'Deposit' : 'Withdraw';
    const preposition = isDeposit ? 'to' : 'from';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [tick, setTick] = useState('');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [quantity, setQuantity] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                // Spend from the chain's active address (else newest HD
                // external), matching Send.
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this chain. Use Receive to generate one first.');
                    return;
                }
                setFromAddressId(sourceId);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Balance of the amount tick at the source address (Max + "available").
    const tickAmtBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: tick,
    });

    // D-23: a WITHDRAW spends the CONTRACT's custody, not the user's wallet, so
    // the wallet balance is the wrong ceiling for it - the form used to offer
    // "635,000 MEMEVALID available" and a Max of the same while the contract
    // held 5,000, and the excess only failed on-chain as `invalid: insufficient
    // contract balance` after a signed, fee-paying transaction. DEPOSIT keeps
    // reading the wallet (that IS what it spends).
    const [contractBalances, setContractBalances] = useState(/** @type {any} */ (null));
    useEffect(() => {
        if (isDeposit) return undefined;
        let cancelled = false;
        messaging.getContractBalance({ chainId, contractActionIndex })
            .then((res) => { if (!cancelled) setContractBalances(res); })
            // Custody stays null on a read failure, which leaves the form
            // ungated rather than blocking every withdrawal on a hiccup.
            .catch(() => { if (!cancelled) setContractBalances(null); });
        return () => { cancelled = true; };
    }, [isDeposit, chainId, contractActionIndex, messaging]);

    const heldByContract = useMemo(
        () => (isDeposit ? null : contractBalanceOf(contractBalances, tick)),
        [isDeposit, contractBalances, tick],
    );
    // What the Max button and the "available" line speak for in this mode.
    const spendableBalance = isDeposit ? tickAmtBalance : heldByContract;

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const { isWatcherMode } = useWalletMode();

    //  ( §5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included . Watcher mode still branches: it encodes, it
    // never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // : hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: isDeposit ? 'depositAction' : 'withdrawAction',
        hardware: isDeposit ? 'depositActionHw' : 'withdrawActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: isDeposit ? 'DEPOSIT' : 'WITHDRAW', params: actionParams },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || (verb + ' failed.'));
        }
    }

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const manifest = useContractManifest({
        chainId,
        contractActionIndex,
        skip: stage !== 'review' && stage !== 'submitting',
    });

    const actionParams = useMemo(() => ({
        VERSION: '0',
        CONTRACT_ACTION_INDEX: String(contractActionIndex),
        TICK: tick.trim(),
        QUANTITY: String(quantity || '').trim(),
    }), [contractActionIndex, tick, quantity]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        if (!tick.trim()) {
            setFormError('Token ticker is required.');
            return;
        }
        const q = String(quantity).trim();
        if (!q || Number.isNaN(Number(q)) || Number(q) <= 0) {
            setFormError('Quantity must be a positive number.');
            return;
        }
        // D-23: refuse a withdrawal the contract cannot cover, rather than
        // paying a fee to learn it on-chain. Only gates when the custody is
        // actually known (null = unread, so the chain stays the judge).
        if (!isDeposit && heldByContract != null && Number(q) > Number(heldByContract)) {
            setFormError(
                `The contract only holds ${formatWithThousands(heldByContract)} `
                + `${String(tick).trim().toUpperCase()}.`,
            );
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
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
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                const action = isDeposit ? 'DEPOSIT' : 'WITHDRAW';
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params: actionParams },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else {
                const fn = isDeposit
                    ? (isHwSource ? messaging.depositActionHw : messaging.depositAction)
                    : (isHwSource ? messaging.withdrawActionHw : messaging.withdrawAction);
                const args = isHwSource
                    ? { ...base, signerId: fromAddress.signerId }
                    : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || (verb + ' failed.'),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
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
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting'
                    ? `Review ${verb.toLowerCase()}`
                    : `${verb} ${preposition} contract #${contractActionIndex}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain) {
        return wrap(<p>Loading addresses…</p>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
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
                <p className={styles.summary}>
                    {verb} broadcast. The network will credit the {isDeposit ? 'contract' : 'address'} shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'N/A')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {verb} {actionParams.QUANTITY} {actionParams.TICK} {preposition} contract #{actionParams.CONTRACT_ACTION_INDEX}.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Contract</dt>
                    <dd className={styles.detailsValue}>#{actionParams.CONTRACT_ACTION_INDEX}</dd>
                    <dt className={styles.detailsLabel}>Token</dt>
                    <dd className={styles.detailsValue}>{actionParams.TICK}</dd>
                    <dt className={styles.detailsLabel}>Quantity</dt>
                    <dd className={styles.detailsValue}>{actionParams.QUANTITY}</dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                    <ContractConsentPanel
                        manifest={manifest}
                        labelClassName={styles.detailsLabel}
                        valueClassName={styles.detailsValue}
                    />
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
                {(isWatcherMode || isHwSource) && submitError ? (
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
                                : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `${verb} on ${descriptor.displayName}` : verb)}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // : hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // D-23: withdrawing offers the CONTRACT's holdings, not the wallet's. The
    // wallet TokenPicker would list tokens the contract does not hold (and hide
    // ones it does), so this mode gets a plain list of the custody rows.
    if (tokenPickerOpen && !isDeposit) {
        const rows = contractBalanceRows(contractBalances);
        return wrap(
            <div>
                <p className={styles.pickerLabel}>Tokens held by the contract</p>
                {rows.length === 0 ? (
                    <p className={styles.hint}>
                        This contract holds no tokens right now.
                    </p>
                ) : (
                    <ul className={styles.detailsList}>
                        {rows.map((row) => (
                            <li key={row.tick}>
                                <Button
                                    variant="ghost"
                                    block
                                    onClick={() => {
                                        setTick(String(row.tick).toUpperCase());
                                        setTokenPickerOpen(false);
                                        setFormError(null);
                                    }}
                                >
                                    {String(row.tick).toUpperCase()}
                                    {' - '}
                                    {formatWithThousands(String(row.quantity))}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className={styles.actions}>
                    <Button variant="secondary" block onClick={() => setTokenPickerOpen(false)}>
                        Back
                    </Button>
                </div>
            </div>,
        );
    }

    // Token picker (spendable balances, locked to the contract's chain),
    // rendered in place of the form.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setTick(String(sel.tick || '').toUpperCase());
                    setTokenPickerOpen(false);
                    setFormError(null);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {/* The target contract pins the network, so the field is single-option. */}
            <NetworkField value={chainId} onChange={() => {}} chainIds={[chainId]} chainRegistry={chainRegistry} />
            {fromAddress ? (
                <AddressField
                    label={isDeposit ? 'From' : 'To'}
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : null}
            <TokenField
                label="Token"
                value={tick && chainId ? { chainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />
            <AmountField
                label="Quantity"
                hint={isDeposit
                    ? 'Amount to send to the contract.'
                    : 'Amount to pull out of the contract. Only succeeds if the contract permits it.'}
                amount={quantity}
                tick={tick}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setQuantity(stripped);
                    // Editing the amount answers whatever the last error complained
                    // about; leaving "The contract only holds 300 XCHAIN." on screen
                    // next to a corrected 300 reads as a still-blocked form.
                    setFormError(null);
                }}
                onMax={spendableBalance && Number(spendableBalance) > 0
                    ? () => setQuantity(spendableBalance)
                    : undefined}
                maxDisabled={!spendableBalance}
                balanceText={spendableBalance != null && (tick)
                    ? `${formatWithThousands(spendableBalance)} ${String(tick).toUpperCase()} `
                        + `${isDeposit ? 'available' : 'held by the contract'}`
                    : null}
            />

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
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !tick.trim() || !quantity || actionConfirm.composing}
                >
                    {singleEncode ? verb : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
