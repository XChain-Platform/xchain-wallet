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
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, Icon, Input, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { AmountField } from '../components/AmountField.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import {
    mintHeadroom, exceedsHeadroom, mintWindowState, mintWindowMessage, mintLockMessage,
} from '../utils/mintHeadroom.js';
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
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import styles from './IssueTokenForm.module.css';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

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

    // What a MINT can carry is the token's remaining headroom -
    // min(MAX_MINT, MAX_SUPPLY - current supply) - never the minter's
    // balance. The form used to size Max and its "available" footer off
    // the holdings lookup every other amount form reaches for, so a token
    // sitting at its cap offered a Max of its whole supply: an amount the
    // chain rejects by construction, after a fee-paying broadcast. Same
    // defect as D-23 (contract Withdraw sized off the wallet, not the
    // contract's custody), on a sibling form.
    const tokenInfo = useTokenInfo({ chainId, tick: ticker, skip: !ticker });
    const headroom = useMemo(
        () => mintHeadroom({
            maxSupply: tokenInfo?.maxSupply ?? null,
            totalSupply: tokenInfo?.totalSupply ?? null,
            mintMax: tokenInfo?.mintMax ?? null,
        }),
        [tokenInfo],
    );
    // Nothing bounds a mint of an uncapped token with no MAX_MINT, so
    // there is no Max to offer and no number to quote; say so instead of
    // leaving a bare field that looks like a still-loading one.
    const uncapped = !!tokenInfo && headroom === null;

    // D-164: a token can also be un-mintable for a reason that is not a
    // quantity. `mint.js` gates on MINT_START_BLOCK and MINT_STOP_BLOCK, and
    // this form used to offer a full transaction's worth while the window was
    // shut - and then show the network's refusal of that exact amount
    // underneath it. Both blocks arrive in the same `tokenInfo` object the
    // headroom above is computed from; the only thing that was missing is the
    // tip, which the wizard already reads the same way for its callback rail.
    const [tipHeight, setTipHeight] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        if (!chainId) return undefined;
        if (typeof messaging?.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId })
            .then((r) => {
                if (!cancelled) setTipHeight(r && r.watermark != null ? Number(r.watermark) : null);
            })
            .catch(() => { if (!cancelled) setTipHeight(null); });
        return () => { cancelled = true; };
    }, [chainId, ticker, messaging, walletId]);

    const mintWindow = useMemo(
        () => mintWindowState({
            mintStartBlock: tokenInfo?.mintStartBlock ?? null,
            mintStopBlock: tokenInfo?.mintStopBlock ?? null,
            tip: tipHeight,
        }),
        [tokenInfo, tipHeight],
    );
    const windowShut = mintWindow.state === 'before' || mintWindow.state === 'closed';
    // D-167: LOCK_MINT outranks the window, because the two say different
    // things - a window opens or closed on a schedule, and this never changes.
    // Same object, same read, third bound.
    const lockNotice = mintLockMessage(tokenInfo?.locks, ticker);
    const mintBlocked = !!lockNotice || windowShut;
    const blockedNotice = lockNotice || mintWindowMessage(mintWindow, ticker);
    // The per-address cap cannot be turned into a remaining figure here: it is
    // cumulative over this address's whole MINT history and nothing the wallet
    // reads carries that total. So it is STATED rather than subtracted, which
    // is the honest version of the same warning.
    const addressCap = tokenInfo?.mintAddressMax ?? null;
    const [amount, setAmount] = useState('');
    const [destination, setDestination] = useState('');
    const [password, setPassword] = useState('');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: opt in to pay the XCHAIN protocol fee in the native coin. MINT is
    // a quotable fee-bearing action; the authoritative price/validity check
    // runs at submit time (applyNativeFeePreflight) and forfeit-warns if the
    // action can't be priced.
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(coinTicker);

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

    // §5.6 slice 2 (actionForms): mints go through the single-encode
    // confirm page (compose + tamper + sdk.preflight all host-side), hardware
    // included. Watcher mode keeps the legacy review stage: it
    // encodes, it never signs.
    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
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
        // residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only - the watcher, demo and locked-ECDH path. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review' && stage !== 'submitting') return null;
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
                    // PC-51: the native-fee opt-in must reach COMPOSE so the
                    // FEE_DESTINATION output sits inside the PSBT the user
                    // approves, not folded in on a later rebuild.
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                }),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // Re-price the native-coin protocol fee at Approve.
                // The output was sized at compose, and the amount consensus
                // requires moves inversely with the coin price, so a move while
                // the confirm screen sits open leaves it short - which the
                // chain rejects while keeping the fee.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
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
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: humanizeError(err, 'mint').message,
            }));
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
        // Stop an over-mint here rather than three screens later.
        // The confirm page already catches it (MAX_MINT + supply-headroom
        // preflight, plus the dry run), but only behind three individual
        // "sign anyway" overrides, and a user who takes them pays a
        // protocol fee for an action the chain will reject.
        // D-164: the same reason, one bound over. A mint outside the window is
        // refused whatever its size, so stopping it here costs the user a
        // round trip they cannot win and tells them WHEN instead - the one
        // remedy the generic pre-flight sentence says does not exist
        // ("Waiting will not change this").
        if (mintBlocked) {
            setFormError(blockedNotice);
            return;
        }
        if (exceedsHeadroom(amt, headroom)) {
            const TICK = ticker.trim().toUpperCase();
            setFormError(Number(headroom) > 0
                ? `Only ${formatWithThousands(headroom)} ${TICK} can still be minted.`
                : `${TICK} is at its supply cap - no more can be minted.`);
            return;
        }
        setFormError(null);
        // slice 2: with the flag on, mints go straight to the
        // single-encode confirm page instead of the legacy review stage.
        if (!isWatcherMode) {
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
                extraBase: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFeeMandatory,
                        fallback: err?.message || 'Mint failed.',
                    }),
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
                    ? 'Review mint'
                    : `Mint`}
        />
    );
    const wrap = (children, footer = null) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
            {footer}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
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
        // A queued result is signed and NOT broadcast, so "Minted"
        // would claim the one thing that has not happened yet.
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} what="mint" />);
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
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
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

    // confirm page, rendered in place of the form (operator
    // direction 2026-07-22: the overlay modal didn't fit small/mobile
    // viewports). All other form state stays intact behind it.
    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                // Fallback only: the composed PSBT's exact fee wins (§5.2.5).
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                // 'receive', not 'send': the send list is spendable balances,
                // which is the wrong question for MINT - you mint precisely
                // what you do NOT hold. With the send list this form could not
                // reach a mint-by-anyone token (XCHAIN on regtest/testnet), nor
                // let an issuer top up a supply they had spent to zero: the
                // picker answered "No matching balances" and there was no other
                // way in. 'receive' runs the platform-wide token discovery,
                // which is the same "meaningful at zero balance" case (D-41).
                purpose="receive"
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
                    <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />
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
                <StatusMessage variant="error" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </StatusMessage>
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
                onMax={!mintBlocked && headroom !== null && Number(headroom) > 0
                    ? () => { setAmount(headroom); setFormError(null); }
                    : undefined}
                maxDisabled={mintBlocked || headroom === null || Number(headroom) <= 0}
                // D-164: the window outranks the quantity. "10 available to
                // mint" over a closed window is a claim the network refuses on
                // the same screen, so the window's own sentence replaces it
                // rather than sitting beside it.
                balanceText={blockedNotice || (headroom !== null && ticker
                    ? `${formatWithThousands(headroom)} ${String(ticker).toUpperCase()} available to mint`
                        + (addressCap
                            ? `, ${formatWithThousands(addressCap)} per address in total`
                            : '')
                    : (uncapped && ticker ? 'No supply cap' : null))}
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
            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
                mandatory={nativeFeeMandatory}
            />
            {formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={confirmAction.composing}
                    disabled={!fromAddress || !ticker || !amount || confirmAction.composing}
                >
                    {!isWatcherMode ? 'Mint' : 'Preview'}
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
