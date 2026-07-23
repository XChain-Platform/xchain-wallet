// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
 ChainPicker,  Icon, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import {
    isConfirmModalSliceEnabled,
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Mint form (§40.3).
 *
 * Mints additional supply of an existing mintable token the user owns.
 * Per-mint-limit enforcement and owner checks happen at the protocol
 * layer; the form only collects ticker + amount + optional destination.
 *
 * Destination defaults to the fee-paying address when left blank;
 * protocol §MINT treats an absent DESTINATION as "credit the
 * broadcasting address," which the decoder also surfaces on the
 * review screen.
 *
 * Until the Token detail page (§40.5 context) ships, the ticker is
 * user-entered. Once Token detail exists, callers can prefill ticker
 * via a later prop.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]   When supplied with `initialTick`, the chain + ticker are locked (no picker / no input). Used by ManageToken so per-token actions can't operate on the wrong token.
 * @param {string} [props.initialTick]
 */
export function MintForm({ walletId, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const lockedToken = !!(initialChainId && initialTick);
    // Shared source-loading + `from` descriptor + signer dispatch (G6).
    const {
        addressesByChain,
        loadError,
        chainId,
        setChainId,
        fromAddress,
        setFromAddressId,
        chainsWithAddresses,
        descriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        buildFrom,
        submit,
    } = useActionForm({
        walletId,
        action: 'MINT',
        submitMethods: { hw: 'mintAssetHw', software: 'mintToken' },
        initialChainId,
        initialFromAddress,
        lockedToken,
        noAddressMessage:
            'No addresses on any chain yet. Use Receive to generate one before minting.',
    });


    const [ticker, setTicker] = useState((initialTick || '').toUpperCase());

    // Balance of the amount tick at the source address (Max + "available").
    const tickAmtBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: ticker,
    });
    const [amount, setAmount] = useState('');
    const [destination, setDestination] = useState('');
    const [password, setPassword] = useState('');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));

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

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listContacts !== 'function') return undefined;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(rows || []); })
            .catch(() => { if (!cancelled) setContacts([]); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    //  §5.6 slice 2 (actionForms): software mints go through the
    // single-encode confirm modal (compose + tamper + sdk.preflight all
    // host-side); hardware + watcher keep the legacy review stage.
    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const singleEncode = isConfirmModalSliceEnabled(settings, 'actionForms');
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    // The modal's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            TICK: ticker.trim().toUpperCase(),
            AMOUNT: String(amount).trim(),
        };
        if (destination.trim()) p.DESTINATION = destination.trim();
        return p;
    }, [ticker, amount, destination]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting' && !confirmModalOpen) return null;
        return decoderLib.decodeAction({
            action: 'MINT',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);

    // Single-encode confirm (mirrors Send slice 1): compose + tamper-check +
    // pre-flight run HOST-side; Approve signs the byte-identical prebuilt
    // PSBT via mintToken.prebuiltPsbt. Reject is a calm no-op back to the
    // form; real failures land in the form error banner.
    async function openConfirmModal() {
        const from = buildFrom();
        if (!chainId || !from) return;
        setSubmitError(null);
        try {
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: {
                    mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
                },
                compose: () => messaging.composeForConfirm({
                    walletId,
                    chainId,
                    from,
                    actionData: { action: 'MINT', params: actionParams },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                }),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: {
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt: {
                            psbtHex: composed.psbt,
                            encoding: composed.encoding,
                            actionString: composed.actionString,
                            version: composed.version,
                        },
                    },
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            console.error('Mint (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(humanizeError(err, 'mint').message);
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!ticker.trim()) {
            setFormError('Ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9.]+$/.test(ticker.trim())) {
            setFormError('Ticker must be A–Z, 0–9 (subtokens may include a period).');
            return;
        }
        const amt = String(amount).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Amount must be a positive number.');
            return;
        }
        setFormError(null);
        //  slice 2: with the flag on, software mints go straight to
        // the single-encode confirm modal instead of the legacy review
        // stage. Hardware + watcher keep the legacy path for this slice.
        if (singleEncode && !isWatcherMode && !isHwSource) {
            openConfirmModal();
            return;
        }
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
            const res = await submit({
                params: actionParams,
                password,
                ...(feePerKb != null ? { extraBase: { feePerKb }, encoderOpts: { feePerKb } } : {}),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Mint failed.',
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

    const titleSuffix = descriptor ? ` on ${descriptor.displayName}` : '';
        const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review mint'
                    : `Mint${titleSuffix}`}
        />
    );
    const wrap = (children, footer = null) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
            {footer}
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
                <h2 className={styles.successTitle}>Minted</h2>
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
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
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
                                : isHwSource
                                    ? hwStatus !== 'available'
                                    : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Sign on ${descriptor.displayName}` : 'Sign')}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form (operator
    // direction 2026-07-22: the overlay modal didn't fit small/mobile
    // viewports). All other form state stays intact behind it.
    if (confirmModalOpen) {
        return (
            <ConfirmActionModal
                screenVariant={variant}
                phase={confirmAction.phase}
                composed={confirmAction.composed}
                report={confirmAction.report}
                reportLoading={confirmAction.phase === 'preflighting'}
                acknowledged={confirmAction.acknowledged}
                onAcknowledge={confirmAction.acknowledge}
                canApprove={confirmAction.canApprove}
                onApprove={confirmAction.approve}
                onReject={confirmAction.reject}
                decoded={decoded}
                simulation={null}
                error={confirmAction.error}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                credentialsReady={signerReady || password.length > 0}
                credentials={signerReady ? (
                    <p className={styles.hint}>
                        <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                    </p>
                ) : (
                    <Input
                        type="password"
                        label="Password"
                        hint="Required to sign."
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                    />
                )}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select token"
                onSelect={(sel) => {
                    setTicker(String(sel.tick || '').toUpperCase());
                    if (!lockedToken && sel.chainId) setChainId(sel.chainId);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
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

    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                variant={variant}
                contacts={contacts}
                onPick={(entry) => {
                    setDestination(entry.address);
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
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
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            {lockedToken ? null : (
                <TokenField
                    label="Token"
                    value={ticker && chainId ? { chainId, tick: ticker } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}
            <AmountField
                label="Amount"
                hint="How much to mint."
                amount={amount}
                tick={ticker}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmount(stripped);
                }}
                onMax={tickAmtBalance && Number(tickAmtBalance) > 0
                    ? () => setAmount(tickAmtBalance)
                    : undefined}
                maxDisabled={!tickAmtBalance}
                balanceText={tickAmtBalance != null && (ticker)
                    ? `${formatWithThousands(tickAmtBalance)} ${String(ticker).toUpperCase()} available`
                    : null}
            />
            <AddressField
                label="Destination (optional)"
                icon="contacts"
                hint="Leave blank to mint to the fee-paying address."
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                onIconClick={() => setContactsPickerOpen(true)}
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
                    loading={confirmAction.composing}
                    disabled={!fromAddress || !ticker || !amount || confirmAction.composing}
                >
                    {singleEncode && !isWatcherMode && !isHwSource ? 'Mint' : 'Preview'}
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
