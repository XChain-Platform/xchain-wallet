// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, AddressText, Button, ChainPicker, CopyButton, FeeSelector, FormNotice, FormPage, Icon, PageHeader, Screen, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import '../../i18n/locales/en/send.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { useSettings } from '../hooks/useSettings.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';

const chainRegistry = registryLib.defaultRegistry();

// '|' separates fields and ';' separates actions on the wire, so neither can
// appear in text the user typed. The form says so in its own words rather than
// letting the compose call fail with the protocol's field names.
const RESERVED_DELIMITERS = /[|;]/;

// BROADCAST MESSAGE is measured with JavaScript String.length by the indexer.
const MAX_BROADCAST_MESSAGE_LENGTH = 250;
/**
 * Publishes a plain BROADCAST format 0 message tied to the source address.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
export function BroadcastForm({ walletId, onBack, onDone, initialChainId, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const { settings } = useSettings();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [message, setMessage] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // The required-message refusal is a field error on Message, kept apart from
    // formError so the form-level status never doubles it.
    const [messageError, setMessageError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default).
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any network yet. Use Receive to generate one before broadcasting.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key broadcast from the wallet's OLDEST chain forever.
                // Open on the last-used chain behind a caller-seeded one and
                // ahead of the first-key fallback, exactly as Send and Swap do.
                setChainId((prev) => pickDefaultChainId(byChain, {
                    explicitChainId: prev,
                    settings,
                }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Same default as Send and every other spend-from-balance form: the
    // chain's active address, else the newest HD external. A dispenser-
    // delegated address is never the default; it vends rather than funds.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const funding = all.filter((a) => a.role !== 'dispenser');
        setFromAddressId(preferredSourceId(funding, activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain, initialFromAddress]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);
    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const coinTicker = tickerForDescriptor(descriptor);

    // PC-51: native-coin protocol fee (BROADCAST is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

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

    const actionParams = useMemo(() => ({ VERSION: '0', MESSAGE: message }), [message]);
    const messageLengthError = actionTextSafetyError(message, 'Message') || (message.length > MAX_BROADCAST_MESSAGE_LENGTH
        ? `Message is ${message.length} characters; the network accepts at most ${MAX_BROADCAST_MESSAGE_LENGTH} characters.`
        : null);

    // (§5.6 slice 2): software broadcasts go through the
    // single-encode confirm page; hardware + watcher keep the legacy
    // review stage. Declared before the `isHwSource`/`isWatcherMode`
    // consts below only for readability: `singleEncode` is computed
    // after them.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });

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
            action: 'BROADCAST',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionConfirm.open, actionParams, chainId]);

    function handleReview(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!message.trim()) {
            setFormError(null);
            setMessageError('Message is required.');
            return;
        }
        // Refuse text the indexer would reject before the form asks the host to compose it.
        if (messageLengthError) {
            setFormError(messageLengthError);
            return;
        }
        // Refuse protocol separators with a field-level explanation.
        if (RESERVED_DELIMITERS.test(message)) {
            setFormError('Remove any | or ; characters: the network reserves them as separators and will reject the broadcast.');
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    // §18.4 / Cluster N FOLLOWUP 2: surface firmware advisories when
    // the source is HW. Hook handles the SignerRecord lookup + cache.
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // pilot: hardware signers now go through the confirm page too. They
    // were excluded, which meant the users most likely to care about
    // verification got the LEGACY rebuild-on-Approve path with no output-set
    // tamper check - and the modal's own hardware note tells them this screen is
    // where action intent gets verified, since the device can only show native
    // outputs. Watcher mode still branches (it encodes, it never signs).
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT via broadcastAction.prebuiltPsbt.
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
                actionData: { action: 'BROADCAST', params: actionParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => (isHwSource
                    // The HW route runs the SAME broadcastAction flow with a
                    // remote signer, so it signs the prebuilt PSBT byte-
                    // identically just like the software lane.
                    ? messaging.broadcastActionHw({
                        walletId,
                        chainId,
                        from,
                        params: actionParams,
                        signerId: fromAddress.signerId,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    })
                    : messaging.broadcastAction({
                        walletId,
                        chainId,
                        from,
                        params: actionParams,
                        password: passwordValueRef.current,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    })),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Broadcast failed.',
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
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'BROADCAST', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.broadcastActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.broadcastAction({ ...base, password });
            }
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
                        coinTicker: coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Broadcast failed.',
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
        setMessage('');
        setStage('form');
    }
    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting'
                ? 'Review broadcast'
                : 'Broadcast'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
        </Screen>
    );

    // The load error, the loading line and every result panel lay out through
    // FormPage like the form itself, so no state draws straight into Screen.
    if (loadError) {
        return wrap(
            <FormPage as="div" label="Broadcast" status={<StatusMessage variant="error">{loadError}</StatusMessage>} />,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(
            <FormPage as="div" label="Broadcast">
                <p className={styles.hint}>Loading…</p>
            </FormPage>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <FormPage as="div" label="Broadcast result">
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={handleBuildAnother}
                        onDone={onDone || onBack}
                    />
                </FormPage>,
            );
        }
        // Signed, but the broadcast leg never landed. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch it renders as a completed broadcast.
        if (result?.queued) {
            return wrap(
                <FormPage as="div" label="Broadcast result">
                    <ResultScreen state="signed-not-broadcast" onDone={onDone || onBack} what="broadcast" unsaved={result?.unsaved} />
                </FormPage>,
            );
        }
        const explorerUrl = txid ? explorerPageUrl({
            chainId,
            kind: 'transaction',
            value: txid,
            settings,
        }) : null;
        return wrap(
            <FormPage as="div" label="Broadcast result">
                <div role="status" aria-live="polite" aria-atomic="true">
                    <h2 className={styles.successTitle}>Broadcast pending</h2>
                    <p className={styles.hint}>
                        Your action was broadcast but is not confirmed yet.
                        Confirmation time depends on the selected network and fee.
                    </p>
                </div>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                        <CopyButton value={txid} label="Copy transaction ID" />
                        {explorerUrl ? (
                            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                                View on explorer <span aria-hidden="true">↗</span>
                            </a>
                        ) : null}
                    </>
                ) : (
                    <p className={styles.hint}>The broadcast completed without a transaction ID.</p>
                )}
                <div className={styles.actions}>
                    <Button type="button" onClick={handleBuildAnother}>Broadcast another</Button>
                    <Button type="button" variant="primary" onClick={onDone || onBack}>Done</Button>
                </div>
            </FormPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review broadcast"
                onSubmit={handleSubmit}
                status={(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
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
                                : 'Sign'}
                    </Button>
                )}
            >
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
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
                    <FormNotice variant="warning" role="alert" lines={decoded.warnings} />
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
                        signerInfo={hwSignerInfo}
                    />
                )}
            </FormPage>,
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
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
                hwSignerInfo={hwSignerInfo}
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

    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label="Broadcast"
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={<Icon.BroadcastIcon />}
                    loading={actionConfirm.composing}
                    disabled={!fromAddress
                        || !!messageLengthError
                        || actionConfirm.composing}
                >
                    Broadcast
                </Button>
            )}
        >
            <ChainPicker label="Network" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} hideNetworkKind />

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
                <FormNotice variant="error">
                    {t('send.source.noAddress')}
                </FormNotice>
            )}

            <Textarea
                label="Message"
                required
                rows={4}
                maxLength={MAX_BROADCAST_MESSAGE_LENGTH}
                error={messageError || messageLengthError || undefined}
                value={message}
                onChange={(e) => {
                    setMessage(e.target.value);
                    if (formError) setFormError(null);
                    if (messageError) setMessageError(null);
                }}
                autoComplete="off"
                autoCapitalize="sentences"
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
        </FormPage>,
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
