// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { t } from '../../i18n/index.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Network, From and the fee selector come from the standard
// FromSection and FeeSection.
import { Button, CopyButton, FormNotice, FormPage, Icon, PageHeader, Screen, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
// Broadcast sits on the Wallet Form Standard frame.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    useFormSections,
} from '../components/formStandard/index.js';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/routes.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { groupDecodedAmounts } from '../utils/amountFormat.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
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
const NO_ACKNOWLEDGMENTS = new Set();

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
    // The standard sections' open state, held above the early
    // returns so it survives the From picker. From closed, Message open,
    // Network fee closed.
    const formSections = useFormSections({ from: false, message: true, fee: false });
    // Which section a Broadcast-attempt refusal belongs to, and a
    // counter that changes on every attempt so that section reopens even
    // after the user closed it.
    const [errorSection, setErrorSection] = useState(/** @type {'from' | 'message' | 'fee' | null} */ (null));
    const [reviewAttempt, setReviewAttempt] = useState(0);

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
                        'No addresses on any network yet. Use Receive to generate one before posting an announcement.',
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
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
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

    // Keep the chain-required flag in every submit path without presenting a
    // protocol-fee choice for this feeless action.
    const nativeFee = nativeFeeForFeelessAction(coinTicker);

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
        return groupDecodedAmounts(decoderLib.decodeAction({
            action: 'BROADCAST',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        }));
    }, [stage, actionConfirm.open, actionParams, chainId]);
    const legacyComposed = useMemo(() => ({
        action: 'BROADCAST',
        chainId,
        decoded,
        protocolFeeKnownFree: true,
    }), [chainId, decoded]);

    function handleReview(event) {
        event.preventDefault();
        // Each attempt bumps the counter; a refusal names its section.
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setErrorSection('fee'); setFormError(feeStop.formError); return; }
        if (!chainId || !fromAddress) {
            setErrorSection('from');
            setFormError('Pick a source address first.');
            return;
        }
        if (!message.trim()) {
            setErrorSection('message');
            setFormError(null);
            setMessageError('Message is required.');
            return;
        }
        // Refuse text the indexer would reject before the form asks the host to compose it.
        if (messageLengthError) {
            setErrorSection('message');
            setFormError(messageLengthError);
            return;
        }
        // Refuse protocol separators with a field-level explanation.
        if (RESERVED_DELIMITERS.test(message)) {
            setErrorSection('message');
            setFormError('Remove any | or ; characters: the network reserves them as separators and will reject the announcement.');
            return;
        }
        setErrorSection(null);
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
                ? 'Review Announcement'
                : 'Announce'}
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
            <FormPage as="div" label="Announce" status={<StatusMessage variant="error">{loadError}</StatusMessage>} />,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(
            <FormPage as="div" label="Announce">
                <p className={styles.hint}>Loading…</p>
            </FormPage>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <FormPage as="div" label="Announcement result">
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
                <FormPage as="div" label="Announcement result">
                    <ResultScreen state="signed-not-broadcast" onDone={onDone || onBack} what="announcement" unsaved={result?.unsaved} />
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
            <FormPage as="div" label="Announcement result">
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
                        <CopyButton value={txid} label="Copy Transaction ID" />
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
                    <Button type="button" onClick={handleBuildAnother}>Announce Another</Button>
                    <Button type="button" variant="success" icon={<Icon.CheckIcon />} onClick={onDone || onBack}>Done</Button>
                </div>
            </FormPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const broadcastText = neutralizeControlText(String(actionParams.MESSAGE || '').trim(), { maxLength: 80 });
        return (
            <ConfirmActionModal
                phase={stage === 'submitting' ? 'signing' : 'ready'}
                composed={legacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={stage === 'review'}
                onApprove={() => handleSubmit({ preventDefault() {} })}
                onReject={() => { setStage('form'); setSubmitError(null); }}
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('routes.manageToken.broadcast'),
                    ...(broadcastText ? { target: broadcastText } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        // The message itself, cut short; the full text is under Technical details.
        const broadcastText = neutralizeControlText(String(actionParams.MESSAGE || '').trim(), { maxLength: 80 });
        const broadcastSummary = {
            verb: t('routes.manageToken.broadcast'),
            ...(broadcastText ? { target: broadcastText } : {}),
            direction: 'none',
            chainId,
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={broadcastSummary}
                screenVariant={variant}
                feeEstimate={feeEstimate}
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
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={setChainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // A section holding the last refusal gets a key that changes on
    // every attempt, so it reopens even after being closed.
    const sectionErrorKey = (id) => (errorSection === id && (formError || messageError) ? reviewAttempt : 0);
    const messageSummary = message.trim()
        ? (message.trim().length > 40 ? `${message.trim().slice(0, 40)}...` : message.trim())
        : null;
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Announce"
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    icon={<Icon.BroadcastIcon />}
                    loading={actionConfirm.composing}
                    // G22: never disabled for a field; a press with no
                    // address or an over-long message is refused with its reason.
                    disabled={actionConfirm.composing}
                >
                    Announce
                </FormAction>
            )}
            /* The standard order. From (closed) holds Network and the
               From address; Message (open) is the form's own field; then the
               Network fee row. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={setChainId}
                    networkHelp="The chain where the message is recorded. Your From address and the network fee are on this network."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp="The address that signs and pays for this message. The message is recorded on-chain as coming from this address."
                    revealKey={sectionErrorKey('from')}
                    // The default source resolves in an effect after the
                    // address list lands, so the notice (which opens From) is
                    // passed only when this network truly has no funding address.
                    missing={!(addressesByChain[chainId] || []).some((a) => a.role !== 'dispenser') ? (
                        <FormNotice variant="error">
                            {t('send.source.noAddress')}
                        </FormNotice>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                />
            )}
        >
            <FormSection
                id="message"
                title="Message"
                icon={Icon.BroadcastIcon}
                {...formSections.bind('message')}
                revealKey={sectionErrorKey('message')}
                summary={messageSummary}
            >
            <Textarea
                label="Message"
                help="Plain text recorded on-chain with this transaction. Anyone can read it, and it cannot be edited or removed later."
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
            </FormSection>
        </FormFrame>,
    );
}
