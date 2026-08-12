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
    AddressText,
 NetworkField,  Icon, StatusMessage, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSettings } from '../hooks/useSettings.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { externalIndexOf } from '../addressSelection.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

const chainRegistry = registryLib.defaultRegistry();

/**
 * Standalone ISSUE form (§40.2).
 *
 * The Token Creation Wizard (§40.1) is the primary authoring surface.
 * This form is the escape hatch for users who want to compose ISSUE
 * without the template picker: every ISSUE v0 field the Custom
 * template exposes, on a single screen. Two stages: form -> review+sign,
 * mirroring Send.jsx.
 *
 * Backed by the same `messaging.issueToken` helper the wizard uses.
 * No new flow, no new background handler. The review step runs the
 * draft through `decoder.decodeAction` so the plain-English summary
 * matches the sign screen shown for dApp-initiated ISSUE requests.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function IssueTokenForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const { settings } = useSettings();
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
    const [supply, setSupply] = useState('');
    // Blank means "mint the whole supply now". Kept as its own
    // string so an explicit 0 stays distinguishable from an untouched field.
    const [initialMint, setInitialMint] = useState('');
    // Optional per-transaction MINT cap (ISSUE v0 MAX_MINT). Blank omits the
    // field entirely, which xchain-indexer stores as 0 and treats as "no
    // per-tx cap" (xchain-indexer src/actions/mint.js) - matching the Mint
    // settings panel (TokenAdminForm.jsx mode='mint-settings') left blank.
    const [maxMint, setMaxMint] = useState('');
    const [divisible, setDivisible] = useState(false);
    const [description, setDescription] = useState('');
    const [lockSupply, setLockSupply] = useState(false);
    const [transferTo, setTransferTo] = useState('');
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draft = useFormDraft({ view: 'issue-token', walletId, ttlMs: formDraftTtlMs });
    const [draftPending, setDraftPending] = useState(() => draft.hasDraft());
    useEffect(() => {
        if (stage !== 'form' || !draftPending) return;
        draft.save({
            chainId, fromAddressId, ticker, supply, initialMint, maxMint, divisible,
            description, lockSupply, transferTo, payFeeInNativeCoin,
        });
    }, [
        stage, draftPending, draft,
        chainId, fromAddressId, ticker, supply, initialMint, maxMint, divisible,
        description, lockSupply, transferTo, payFeeInNativeCoin,
    ]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(false); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.fromAddressId === 'string') setFromAddressId(v.fromAddressId);
        if (typeof v.ticker === 'string') setTicker(v.ticker);
        if (typeof v.supply === 'string') setSupply(v.supply);
        if (typeof v.initialMint === 'string') setInitialMint(v.initialMint);
        if (typeof v.maxMint === 'string') setMaxMint(v.maxMint);
        if (typeof v.divisible === 'boolean') setDivisible(v.divisible);
        if (typeof v.description === 'string') setDescription(v.description);
        if (typeof v.lockSupply === 'boolean') setLockSupply(v.lockSupply);
        if (typeof v.transferTo === 'string') setTransferTo(v.transferTo);
        if (typeof v.payFeeInNativeCoin === 'boolean') setPayFeeInNativeCoin(v.payFeeInNativeCoin);
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
                        'No addresses on any chain yet. Use Receive to generate one before issuing a token.',
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
            (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = (externalIndexOf(a.derivationPath) ?? -1);
                const bi = (externalIndexOf(b.derivationPath) ?? -1);
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
    }, [messaging]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            TICK: ticker.trim().toUpperCase(),
        };
        p.DECIMALS = divisible ? '8' : '0';
        if (supply) {
            const s = String(supply).trim();
            p.MAX_SUPPLY = s;
            // MAX_SUPPLY is the cap, MINT_SUPPLY is how much of it
            // exists the moment the token is created. Deriving both from the
            // one "Supply" box made every wallet-issued token born at its own
            // cap with zero mint headroom, which made the whole Mint surface
            // unreachable for anything issued here. "Initial mint" left blank
            // keeps that simple path (mint it all now); a smaller value leaves
            // the difference mintable later. A 0 omits MINT_SUPPLY entirely,
            // the fair-mint shape (see TokenWizard's `edition` template): the
            // cap is declared at issuance with nothing minted yet.
            const wantsMint = String(initialMint).trim();
            const mint = wantsMint === '' ? s : wantsMint;
            if (Number(mint) > 0) p.MINT_SUPPLY = mint;
        }
        if (maxMint.trim()) p.MAX_MINT = maxMint.trim();
        if (description) p.DESCRIPTION = description.trim();
        if (lockSupply) {
            p.LOCK_MAX_SUPPLY = '1';
            p.LOCK_MINT = '1';
        }
        if (transferTo) p.TRANSFER = transferTo.trim();
        return p;
    }, [ticker, supply, initialMint, maxMint, divisible, description, lockSupply, transferTo]);

    // What is left mintable after the initial mint, as a display string, or
    // null when the pair is blank/invalid/fully minted (nothing to say).
    const mintHeadroom = useMemo(() => {
        const cap = Number(String(supply).trim());
        const mintText = String(initialMint).trim();
        if (!mintText || !Number.isFinite(cap) || cap <= 0) return null;
        const mint = Number(mintText);
        if (!Number.isFinite(mint) || mint < 0 || mint > cap) return null;
        const left = cap - mint;
        if (left <= 0) return null;
        // Trim float noise from the subtraction (0.3 - 0.1 = 0.19999...).
        return divisible ? String(Number(left.toFixed(8))) : String(left);
    }, [supply, initialMint, divisible]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'ISSUE',
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
            setFormError('Ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9]+$/.test(ticker.trim())) {
            setFormError('Ticker must be A–Z, 0–9 only.');
            return;
        }
        if (!supply.trim() || Number(supply) <= 0) {
            setFormError('Supply must be a positive number.');
            return;
        }
        // An initial mint above the cap is rejected outright by the
        // indexer (issue.js), which costs the user the fee and the token, so
        // it is caught here rather than at broadcast.
        const mintText = initialMint.trim();
        if (mintText) {
            const mintNum = Number(mintText);
            if (!Number.isFinite(mintNum) || mintNum < 0) {
                setFormError('Initial mint must be zero or a positive number.');
                return;
            }
            if (mintNum > Number(supply)) {
                setFormError('Initial mint cannot be more than the supply.');
                return;
            }
            // Minting nothing on a token that can never mint leaves a token
            // with no supply and no way to ever create any.
            if (mintNum === 0 && lockSupply) {
                setFormError(
                    'An initial mint of 0 needs minting left unlocked, or the token can never have any supply.',
                );
                return;
            }
        }
        const maxMintText = maxMint.trim();
        if (maxMintText) {
            const maxMintNum = Number(maxMintText);
            if (!Number.isFinite(maxMintNum) || maxMintNum <= 0) {
                setFormError('Max mint per transaction must be a positive number, or left blank for no limit.');
                return;
            }
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode wallets have pubkeys but
    // no keys to sign with. Submit path routes through buildActionPsbt
    // (encode-only, no vault unlock, no signer, no broadcast); the user
    // takes the resulting unsigned PSBT to a Signer-mode wallet.
    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): the path composes ONE PSBT host-side
    // and confirms it on the shared confirm page.: hardware comes
    // through here too - it was excluded, which sent the users most likely
    // to care about verification down the legacy rebuild-on-Approve path
    // with no output-set tamper check, while the confirm page's own
    // hardware note tells them this screen is where action intent gets
    // verified. Watcher mode still branches (it encodes, it never signs).
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'issueToken',
        hardware: 'issueTokenHw',
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
                actionData: { action: 'ISSUE', params: actionParams },
                // The native-fee opt-in has to reach the COMPOSE step: the
                // FEE_DESTINATION output must be inside the PSBT the user
                // approves, not folded in on a later rebuild.
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            setFormError(submitFailureMessage(err, {
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: err?.message || 'Issue failed.',
            }));
        }
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
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ISSUE', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.issueTokenHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.issueToken({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        coinTicker,
                        mandatory: nativeFeeMandatory,
                        fallback: err?.message || 'Issue failed.',
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
                    ? 'Review issue'
                    : `Issue token`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
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
        // Signed but not broadcast, so the token does not exist yet.
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} what="issuance" />);
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Token issued</h2>
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
                {payFeeInNativeCoin ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>{NATIVE_FEE_WARNING}</p>
                    </div>
                ) : null}
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
                    <StatusMessage
                        variant="error"
                        recovery={
                            // Cluster P FOLLOWUP 4: the post-submit
                            // error class is "encoder rejected /
                            // network unreachable / device unplugged".
                            // Returning to the form stage lets the
                            // user adjust an input or re-stage the HW
                            // device without retyping the password.
                            // Wrong-password isn't reachable on this
                            // branch (no password input in HW /
                            // watcher modes).
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

    // confirm page, rendered in place of the form (the overlay modal
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
                    setTransferTo(entry.address);
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    const draftBanner = draft.hasDraft() && !draftPending ? (
        <StatusMessage
            variant="status"
            recovery={{ label: 'Restore', onAction: restoreDraft }}
        >
            You have an unfinished issue draft.
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
            <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />

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

            <Input
                label="Ticker"
                hint="A–Z, 0–9. Uppercase."
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Input
                label="Supply"
                hint="The most that can ever exist."
                inputMode="decimal"
                value={supply}
                onChange={(e) => setSupply(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Initial mint (optional)"
                hint={mintHeadroom
                    ? `Leaves ${mintHeadroom} to mint later.`
                    : 'How much exists at creation. Leave blank to mint the whole supply now; a smaller number leaves the rest to mint later.'}
                inputMode="decimal"
                value={initialMint}
                onChange={(e) => setInitialMint(e.target.value)}
                autoComplete="off"
            />
            <Input
                label="Max mint per transaction (optional)"
                hint="Caps how much can be minted in one transaction. Leave blank for no limit."
                inputMode="decimal"
                value={maxMint}
                onChange={(e) => setMaxMint(e.target.value)}
                autoComplete="off"
            />
            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={divisible}
                    onChange={(e) => setDivisible(e.target.checked)}
                />
                <span>Divisible (8 decimal places)</span>
            </label>
            <Input
                label="Description (optional)"
                hint="Up to 250 characters. Stored on-chain."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
                maxLength={250}
            />
            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={lockSupply}
                    onChange={(e) => setLockSupply(e.target.checked)}
                />
                <span>Lock supply + minting (irreversible)</span>
            </label>
            {lockSupply && mintHeadroom ? (
                // Locking minting alongside a partial initial mint strands the
                // remainder forever: the cap says one thing, the token can only
                // ever hold another. Say so before the fee is spent.
                <StatusMessage variant="status">
                    {`Locking minting means the ${mintHeadroom} left under the cap can never be minted. Clear this box to mint it later.`}
                </StatusMessage>
            ) : null}
            <AddressField
                label="Transfer ownership to (optional)"
                icon="contacts"
                hint="Leave blank to keep control."
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
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
                // Cluster P FOLLOWUP 4: formError surfaces field-level
                // validation ("Ticker is required", "Supply must be a
                // positive number", "Pick a source address first").
                // No one-click recovery affordance fits here; the user
                // edits the offending field and re-submits. Auditable
                // per-form decision: terminal-as-rendered, recovery is
                // user-iteration via the Inputs above.
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !ticker || !supply || actionConfirm.composing}
                >
                    {singleEncode ? 'Issue token' : 'Preview'}
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
