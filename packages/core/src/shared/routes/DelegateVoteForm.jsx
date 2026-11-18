// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isDeviceAddressSource } from '../../schemas/constants.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, Button, ChainBadge, Icon, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
// The Wallet Form Standard frame (From, main section, Network fee, one action).
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, MemoSection, SummaryAddress, joinSummaryParts, useFormSections } from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { titleCase } from '../utils/titleCase.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
// Review and done facts as label-left value-right rows, never stacked uppercase labels.
import facts from './FactRows.module.css';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * VOTE delegation form (v3), one job per route (liquid democracy, VOTE.md
 * §13). The mode is fixed by the route; the form never switches between them.
 *
 *   - `mode: 'delegate'` (Delegate votes): hand your TICK voting weight to
 *     another holder. Only flows for polls where you did not vote directly
 *     and still hold the token at close (resolved at tally time); this just
 *     records the instruction.
 *   - `mode: 'clear'` (from a My delegations row): revoke the standing
 *     delegation for TICK (blank DELEGATE_TO). The row fixes the address,
 *     the token and the network, so they show read-only with the current
 *     delegate.
 *
 * @param {object} props
 * @param {'delegate' | 'clear'} props.mode
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} [props.presetTick]
 * @param {{ tick: string, delegate: string, address: string }} [props.clear]  the My delegations row being cleared
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]   after a cleared delegation, back to the list
 */
export function DelegateVoteForm(props) {
    const { mode, walletId, chainId, presetTick, clear } = props;
    return <DelegateVoteFormState key={JSON.stringify([mode, walletId, chainId, presetTick, clear?.tick, clear?.address])} {...props} />;
}

function DelegateVoteFormState({ mode = 'delegate', walletId, chainId: initialChainId, presetTick, clear = null, onBack, onDone }) {
    // Seeded from the launching context; the Network field lets the user retarget.
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    // Clearing only happens from a My delegations row, which names the
    // address, token and current delegate; without that row it is a delegate.
    const isClear = mode === 'clear' && Boolean(clear?.tick && clear?.address);
    const verb = isClear ? 'Clear vote delegation' : 'Delegate votes';
    // Title Case button label for the same action as `verb`.
    // The main action names what it does, with its own icon.
    const submitLabel = isClear ? 'Clear Delegation' : 'Delegate Votes';
    const submitIcon = isClear ? <Icon.TrashIcon /> : <Icon.UsersIcon />;

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    const [tick, setTick] = useState((isClear ? clear.tick : presetTick) || '');
    const [delegateTo, setDelegateTo] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);
    // The standard's open state, held above the early returns (the
    // picker pages) so it survives them; only the main section starts open.
    const formSections = useFormSections({ from: false, delegation: true, memo: false, fee: false });
    // Counts review presses, so a section holding the error reopens on each.
    const [validationAttempt, setValidationAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoadError(null);
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                // A clear signs from the row's own address (its delegator),
                // never the active one.
                if (isClear) {
                    const own = (byChain?.[chainId] || []).find((a) => a.address === clear.address);
                    if (!own) {
                        setLoadError('This address is not in this wallet on this network.');
                        return;
                    }
                    setFromAddressId(own.id);
                    setLoadError(null);
                    return;
                }
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this network. Use Receive to generate one first.');
                    return;
                }
                setFromAddressId(sourceId);
                setLoadError(null);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(readFailureMessage(err, 'load your addresses'));
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

    const isHwSource = isDeviceAddressSource(fromAddress?.source);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included. Watcher mode still branches: it encodes, it
    // never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: isClear ? 'clearVoteDelegationAction' : 'delegateVoteAction',
        hardware: isClear ? 'clearVoteDelegationActionHw' : 'delegateVoteActionHw',
    });

    const voteParams = useMemo(() => ({
        tick: tick.trim(),
        ...(!isClear && { delegateTo: delegateTo.trim() }),
        ...(memo.trim() && { memo: memo.trim() }),
    }), [delegateTo, isClear, memo, tick]);
    const legacyWireParams = useMemo(() => ({
        VERSION: '3',
        TICK: voteParams.tick,
        DELEGATE_TO: voteParams.delegateTo || '',
        ...(voteParams.memo && { MEMO: voteParams.memo }),
    }), [voteParams]);
    const legacyDecoded = useMemo(() => (
        stage === 'review' || stage === 'submitting'
            ? decoderLib.decodeAction({ action: 'VOTE', params: legacyWireParams, chainId: chainId || undefined, chainRegistry })
            : null
    ), [stage, legacyWireParams, chainId]);
    const legacyComposed = useMemo(() => (legacyDecoded ? {
        action: 'VOTE',
        chainId,
        decoded: legacyDecoded,
        protocolFeeKnownFree: true,
    } : null), [chainId, legacyDecoded]);

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        if (submitInFlightRef.current) return;
        submitInFlightRef.current = true;
        setSubmitError(null);
        try {
            const from = {
                address: fromAddress.address,
                publicKey: fromAddress.publicKey,
                derivationPath: fromAddress.derivationPath,
                addressId: fromAddress.id,
                source: fromAddress.source,
                signerId: fromAddress.signerId,
            };
            const res = await actionConfirm.run({
                chainId,
                from,
                // The VOTE v3 wire params come from the SDK's own
                // delegate/clear builder, host-side. A client-side mirror of
                // that encoding would be SIGNED rather than caught: the tamper
                // check verifies the PSBT against whatever the encoder was handed.
                compose: () => messaging.composeVoteForConfirm(withAdvancedOptions({
                    walletId,
                    chainId,
                    from,
                    builder: isClear ? 'clearDelegationParams' : 'delegateParams',
                    params: voteParams,
                    ...(feePerKb != null ? { feePerKb } : {}),
                })),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: voteParams,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || (verb + ' failed.'),
            }));
        } finally {
            submitInFlightRef.current = false;
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

    useEffect(() => {
        let cancelled = false;
        if (isClear || typeof messaging.listContacts !== 'function') return undefined;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(rows || []); })
            .catch(() => { if (!cancelled) setContacts([]); });
        return () => { cancelled = true; };
    }, [isClear, messaging]);

    function handleReview(event) {
        event.preventDefault();
        setValidationAttempt((n) => n + 1); // Reopens the section holding the error.
        if (!fromAddress) { setFormError('No source address available.'); return; }
        if (!descriptor?.coin || !descriptor?.networkKind || !isValidAddressForChain(
            fromAddress.address, descriptor.coin, descriptor.networkKind,
        )) {
            setFormError('The selected source address is not valid for this network.');
            return;
        }
        if (!tick.trim()) { setFormError('Governance token is required.'); return; }
        const tickError = tickerReferenceError(tick, { noun: 'Governance token' });
        if (tickError) { setFormError(tickError); return; }
        if (!isClear && !delegateTo.trim()) { setFormError('Delegate-to address is required.'); return; }
        if (!isClear && (!descriptor?.coin || !descriptor?.networkKind || !isValidAddressForChain(
            delegateTo.trim(), descriptor.coin, descriptor.networkKind,
        ))) {
            setFormError(`Delegate-to address is not valid for ${descriptor?.displayName || chainId}.`);
            return;
        }
        if (!isClear && delegateTo.trim().toLowerCase() === fromAddress.address.toLowerCase()) {
            setFormError('Delegate-to address must be different from the source address.');
            return;
        }
        if (/[|;]/.test(memo)) { setFormError('Memo cannot contain | or ; characters.'); return; }
        const memoError = memoLengthError(memo.trim());
        if (memoError) { setFormError(memoError); return; }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        setFormError(null);
        if (singleEncode) { void openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (submitInFlightRef.current) return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        submitInFlightRef.current = true;
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
                params: voteParams,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                // Both modes share the VOTE v3 wire action; clear = blank DELEGATE_TO.
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'VOTE', params: legacyWireParams },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else {
                const fn = isClear
                    ? (isHwSource ? messaging.clearVoteDelegationActionHw : messaging.clearVoteDelegationAction)
                    : (isHwSource ? messaging.delegateVoteActionHw : messaging.delegateVoteAction);
                const args = isHwSource ? { ...base, signerId: fromAddress.signerId } : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || (verb + ' failed.'),
            }));
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={titleCase(stage === 'review' || stage === 'submitting' ? `Review ${verb.toLowerCase()}` : verb)}
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain) return wrap(<ListPage><p>Loading addresses…</p></ListPage>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<ListPage><ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} /></ListPage>);
        if (result?.psbtHex && !txid) {
            return wrap(<ListPage><ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} /></ListPage>);
        }
        return wrap(
            <ListPage>
                <p className={styles.summary}>
                    {isClear
                        ? `Delegation cleared. Your ${voteParams.tick} voting weight stops flowing once the network records the action.`
                        : `Delegation set. Your ${voteParams.tick} voting weight flows to the delegate for polls you do not vote on directly.`}
                </p>
                <dl className={facts.list}>
                    <dt className={facts.label}>Transaction ID</dt>
                    <dd className={facts.value}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}><Button variant="success" icon={<Icon.CheckIcon />} onClick={onDone || onBack}>Done</Button></div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
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
                onReject={() => { setSubmitError(null); setStage('form'); }}
                decoded={legacyDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: isClear
                        ? t('components.confirmSummary.verbClearDelegation')
                        : t('components.confirmSummary.verbDelegateVotes'),
                    ...(voteParams.tick ? { ticker: voteParams.tick.toUpperCase() } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    ...(voteParams.delegateTo ? { recipient: voteParams.delegateTo } : {}),
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
        // The token whose votes move, and the address they go to.
        const delegateVoteSummary = {
            verb: isClear
                ? t('components.confirmSummary.verbClearDelegation')
                : t('components.confirmSummary.verbDelegateVotes'),
            ...(voteParams.tick ? { ticker: voteParams.tick.toUpperCase() } : {}),
            direction: 'none',
            chainId,
            address: fromAddress?.address,
            ...(voteParams.delegateTo ? { recipient: voteParams.delegateTo } : {}),
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={delegateVoteSummary}
                screenVariant={variant}
                chainLabel={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
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
                onChainChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select Token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => { setTick(String(sel.tick || '').toUpperCase()); setTokenPickerOpen(false); }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                variant={variant}
                contacts={contacts}
                onPick={(entry) => { setDelegateTo(entry.address); setContactsPickerOpen(false); }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    // The section each form error belongs to. A fee stop opens Network
    // fee, a source problem opens From, a memo problem opens Memo, everything
    // else (token, delegate) the main one.
    const feeStopNow = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
    const feeHasError = Boolean(formError && feeStopNow && formError === feeStopNow.formError);
    const fromHasError = Boolean(formError && /source address/i.test(formError) && !/^Delegate-to/.test(formError));
    const memoHasError = Boolean(formError && /^Memo/i.test(formError));
    const delegationHasError = Boolean(formError && !feeHasError && !fromHasError && !memoHasError);
    const sectionErrorKey = (hasError) => (hasError ? validationAttempt + 1 : 0);
    const delegationSummary = joinSummaryParts([
        tick.trim() ? tick.trim().toUpperCase() : null,
        !isClear && delegateTo.trim() ? <>to <SummaryAddress address={delegateTo} /></> : null,
        isClear && clear.delegate ? <>from <SummaryAddress address={clear.delegate} /></> : null,
    ], ' ') || 'No token yet';

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={verb}
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    icon={submitIcon}
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing}
                >
                    {submitLabel}
                </FormAction>
            )}
            /* The standard order: From (Network and address), Delegation (token
               and delegate), optional Memo, then the Network fee row. A preset
               governance token decides the network, so it locks there. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
                    lockNetwork={Boolean(presetTick) || isClear}
                    networkHelp="The chain the delegation is recorded on. Your From address and the fee are on this network, and the governance token must live on it."
                    address={fromAddress?.address || null}
                    // A clear is fixed to the delegation's own address: the
                    // picker icon shows, locked, with the reason.
                    onOpenPicker={isClear ? undefined : () => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    pickerLockedReason="The delegation's own address signs this clear"
                    addressHelp="The address whose voting weight you delegate or take back. It sends this action and pays the network fee."
                    revealKey={sectionErrorKey(fromHasError)}
                />
            )}
            fee={feeTiers ? (
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey(feeHasError)}
                />
            ) : null}
        >
            <FormSection
                id="delegation"
                title="Delegation"
                icon={Icon.UsersIcon}
                {...formSections.bind('delegation')}
                revealKey={sectionErrorKey(delegationHasError)}
                summary={delegationSummary}
            >
            <TokenField
                label="Governance token"
                help="The token whose voting weight you are delegating or clearing the delegation for."
                value={tick && chainId ? { chainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
                disabled={isClear}
            />

            {/* Clearing shows the delegate being removed, read-only. */}
            {isClear ? (
                <AddressField
                    label="Current delegate"
                    help="The holder your weight in this token flows to today. Polls that close after the clear is recorded no longer count your weight through them."
                    value={clear.delegate || ''}
                    readOnly
                    onChange={() => {}}
                />
            ) : null}

            {!isClear ? (
                <AddressField
                    label="Delegate to address"
                    icon="contacts"
                    help="The holder who will cast your weight on polls you do not vote on directly."
                    value={delegateTo}
                    onChange={(e) => setDelegateTo(e.target.value)}
                    onIconClick={() => setContactsPickerOpen(true)}
                />
            ) : null}
            </FormSection>

            {/* Memo is its own optional section holding only the memo, so
                the section title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey(memoHasError)}
                value={memo}
                maxLength={MAX_MEMO_LENGTH}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}
