// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-32: ADDRESS v0 "On-chain preferences" editor for ONE address.
//
// The form keeps its specialized fresh-baseline review before opening the
// shared confirm page. Its safety rails are (a) every write carries ALL THREE
// preferences (a blank
// FEE_PREFERENCE / REQUIRE_MEMO on the wire silently reverts to default at
// the indexer), and (b) current values are RE-FETCHED when the user enters
// review, so a stale read cannot silently revert the two fields the user
// did not touch. The local review shows all three values and marks changes;
// the shared confirm then dry-runs and signs the exact composed transaction.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Button, Checkbox, FieldNote, Icon, InfoTip, ListPage, PageHeader, IconSelect, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
// The Wallet Form Standard frame. Its
// FormSection is the collapsible standard one, not ui/FormSection.jsx.
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, MemoSection, useFormSections } from '../components/formStandard/index.js';
import { SummaryAddress } from '../components/formStandard/SummaryAddress.jsx';
import { DiagnosticDetails } from '../components/DiagnosticDetails.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { humanizeError } from '../utils/humanizeError.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/addressPreferences.js';
import '../../i18n/locales/en/components.js';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import { useActionForm } from '../hooks/useActionForm.js';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import {
    feePreferenceLabel,
    requireMemoLabel,
    dispenserPreferenceLabel,
} from '../../flows/addressPreferences.js';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { explorerReadFailure } from '../../sdk/explorerErrors.js';

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId    chain of the address the screen opens on
 * @param {string} props.address    the address the screen opens on; From can pick another own address (ADDRESS applies to SOURCE)
 * @param {() => void} props.onBack
 */
export function AddressPreferencesForm({ walletId, chainId: initialChainId, address, onBack }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);

    const {
        chainId,
        setChainId,
        addressesByChain,
        loadError,
        fromAddress,
        setFromAddressId,
        chainsWithAddresses,
        descriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
    } = useActionForm({
        walletId,
        action: 'ADDRESS',
        submitMethods: { hw: 'addressPreferencesActionHw', software: 'addressPreferencesAction' },
        initialChainId,
        initialFromAddress: address,
        lockedToken: true,
        noAddressMessage: 'This wallet has no addresses on this network.',
    });

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    // The address whose preferences this form reads and writes: From, which
    // opens on the address the screen was opened for.
    const editedAddress = fromAddress?.address || address;
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // Keep the chain-required flag in every submit path without presenting a
    // protocol-fee choice for this feeless action.
    const nativeFee = nativeFeeForFeelessAction(coinTicker);

    const [stage, setStage] = useState(/** @type {'form'|'review'|'submitting'|'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [formErrorDetail, setFormErrorDetail] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any} */ (null));
    // Section open state, held above the picker page and the review
    // step. Address Info (which address the preferences belong to) and
    // the Protocol fee section start open.
    const formSections = useFormSections({
        from: true, protocolFee: true, incoming: false, dispensers: false, memo: false, fee: false,
    });
    // Which closed section holds the error Review refused on; each
    // attempt bumps the counter so that section reopens every time.
    const [errorAt, setErrorAt] = useState(/** @type {{ section: string | null, attempt: number }} */ ({ section: null, attempt: 0 }));
    const markError = (section) => setErrorAt((prev) => ({ section, attempt: prev.attempt + 1 }));

    // The three preferences as the WIRE values they will be written as.
    const [feePref, setFeePref] = useState(/** @type {'1' | '2'} */ ('2'));
    const [requireMemo, setRequireMemo] = useState(false);
    const [dispPref, setDispPref] = useState(/** @type {'1' | '2'} */ ('1'));
    const [memo, setMemo] = useState('');
    // Review awaits a baseline read; the memo can change during that wait, so
    // the post-read check reads the latest text here, not the click-time copy.
    const memoRef = useRef(memo);
    memoRef.current = memo;

    // Current on-chain values: loaded for the form prefill, then RE-FETCHED
    // at review entry (the confirm-time baseline the review compares against).
    const [currentError, setCurrentError] = useState(/** @type {string | null} */ (null));
    const [reviewBaseline, setReviewBaseline] = useState(/** @type {any} */ (null));
    // A ref closes the same-tick gap before React renders a new stage. Only one
    // baseline read may decide the values and comparison shown by Review.
    const reviewPending = useRef(false);
    const touched = useRef({ fee: false, requireMemo: false, dispenser: false });
    const initialPrefillOpen = useRef(true);
    // Each choice is independent: a slow read may still prefill untouched
    // fields, but it never overwrites a field the user has picked.
    const pick = (field, setter) => (value) => {
        touched.current[field] = true;
        setter(value);
    };
    // A different From is a different address with its own on-chain values:
    // forget the picks made for the old one so the new read prefills all three.
    function resetForNewAddress() {
        touched.current = { fee: false, requireMemo: false, dispenser: false };
        setFeePref('2');
        setRequireMemo(false);
        setDispPref('1');
        setFormError(null);
        setFormErrorDetail(null);
    }

    useEffect(() => {
        let cancelled = false;
        if (!chainId || !editedAddress) return undefined;
        // The prefill read is skipped for a demo wallet, which cannot submit
        // this form: a demo wallet's addresses never go to an explorer (issue #82).
        if (demoGuard.blocked) return undefined;
        initialPrefillOpen.current = true;
        setCurrentError(null);
        messaging.getAddressPreferences({ chainId, address: editedAddress })
            .then((prefs) => {
                if (cancelled) return;
                if (!initialPrefillOpen.current) return;
                // 0 and 2 share the donate-to-protocol effect; the form
                // writes the explicit value.
                if (!touched.current.fee) {
                    setFeePref(Number(prefs.feePreference) === 1 ? '1' : '2');
                }
                if (!touched.current.requireMemo) {
                    setRequireMemo(Number(prefs.requireMemo) === 1);
                }
                if (!touched.current.dispenser) {
                    setDispPref(Number(prefs.dispenserPreference) === 2 ? '2' : '1');
                }
            })
            .catch((err) => { if (!cancelled) setCurrentError(userFacingMessage(err, 'Could not load current preferences.')); });
        return () => { cancelled = true; };
    }, [messaging, chainId, editedAddress, demoGuard.blocked]);

    // Network fee plumbing (mirrors DestroyForm).
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

    const actionParams = useMemo(() => ({
        FEE_PREFERENCE: feePref,
        REQUIRE_MEMO: requireMemo ? '1' : '0',
        DISPENSER_PREFERENCE: dispPref,
        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
    }), [feePref, requireMemo, dispPref, memo]);
    const preferenceReviewComposed = useMemo(() => ({
        action: 'ADDRESS',
        chainId,
        protocolFeeKnownFree: true,
    }), [chainId]);

    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const ownerLane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: fromAddress,
        software: 'addressPreferencesAction',
        hardware: 'addressPreferencesActionHw',
    });

    // Review entry re-fetches the on-chain baseline so the "unchanged" rows
    // shown are the truth at sign time, not the load-time snapshot.
    // Shows the error and returns true for a memo Review refuses. | and ; are
    // the action line's field delimiters: a memo carrying one composes extra
    // fields into the ADDRESS write.
    function refuseMemo(value) {
        const trimmedMemo = value.trim();
        if (trimmedMemo.includes('|') || trimmedMemo.includes(';')) {
            setFormError('Memo cannot contain "|" or ";".');
            markError('memo');
            return true;
        }
        const memoError = memoLengthError(trimmedMemo);
        if (memoError) { setFormError(memoError); markError('memo'); return true; }
        return false;
    }

    async function handleReview(event) {
        event.preventDefault();
        if (reviewPending.current) return;
        setFormErrorDetail(null);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); markError('fee'); return; }
        setFormError(null);
        setErrorAt((prev) => (prev.section ? { ...prev, section: null } : prev));
        if (refuseMemo(memo)) return;
        reviewPending.current = true;
        initialPrefillOpen.current = false;
        try {
            const fresh = await messaging.getAddressPreferences({ chainId, address: editedAddress });
            // The memo stays editable during the read, so Review checks the
            // text the write carries, which is the latest one.
            if (refuseMemo(memoRef.current)) return;
            // Every ADDRESS write carries all three values. Refresh fields the
            // user did not touch so an external update is preserved.
            if (!touched.current.fee) {
                setFeePref(Number(fresh.feePreference) === 1 ? '1' : '2');
            }
            if (!touched.current.requireMemo) {
                setRequireMemo(Number(fresh.requireMemo) === 1);
            }
            if (!touched.current.dispenser) {
                setDispPref(Number(fresh.dispenserPreference) === 2 ? '2' : '1');
            }
            setReviewBaseline(fresh);
            setStage('review');
        } catch (err) {
            const lead = explorerReadFailure(err, 'load the current preferences')?.message
                || "Couldn't load the current preferences. Try again in a moment.";
            setFormError(lead + ' Review needs a live read, because every write resets all three preferences.');
            setFormErrorDetail(typeof err?.message === 'string' && err.message.trim()
                ? err.message.trim() : null);
        } finally {
            reviewPending.current = false;
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || ownerLane.composing) return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await ownerLane.run({
                actionData: { action: 'ADDRESS', params: actionParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                submitExtra: { params: actionParams },
            });
            setResult(res);
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) {
                setStage('review');
                return;
            }
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: humanizeError(err, 'address preferences').message,
                    }),
            );
            setStage('review');
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

    const header = (
        <PageHeader
            nested={stage === 'review'}
            onBack={stage === 'review' ? () => setStage('form') : onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review Preferences' : 'Address Preferences'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain || !chainId || !fromAddress) {
        return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);
    }

    if (ownerLane.open) {
        return (
            <ActionConfirmScreen
                {...ownerLane.confirmProps}
                summary={{
                    verb: t('components.confirmSummary.verbSetAddressPreferences'),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                feeEstimate={feeEstimate}
                signerReady={signerReady}
                hwSignerInfo={hwSignerInfo}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.queued) {
            return wrap(
                <ResultScreen
                    state="signed-not-broadcast"
                    onDone={onBack}
                    what="address preferences"
                    unsaved={result?.unsaved}
                />,
            );
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />,
            );
        }
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>Preferences written</h2>
                <p className={styles.hint}>
                    They take effect once the transaction confirms and indexes valid.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const rows = writtenRows(actionParams, reviewBaseline);
        return (
            <ConfirmActionModal
                phase={stage === 'submitting' || ownerLane.composing ? 'signing' : 'ready'}
                composed={preferenceReviewComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={stage === 'review' && !ownerLane.composing}
                onApprove={() => handleSubmit({ preventDefault() {} })}
                onReject={() => { setSubmitError(null); setStage('form'); }}
                decoded={null}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentialsReady
                credentials={isWatcherMode ? (
                    <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                ) : null}
                summary={{
                    verb: t('components.confirmSummary.verbSetAddressPreferences'),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: [
                        ...rows.map((row) => ({
                            label: row.label,
                            value: row.changed ? `${row.value} - changed` : `${row.value} (unchanged)`,
                        })),
                        ...(memo.trim() ? [{ label: 'Memo', value: memo.trim() }] : []),
                    ],
                    notice: 'All three preferences are written together. Unchanged values are re-written with their current setting.',
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
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
                onChainChange={(cid) => { setChainId(cid); setFromAddressId(null); resetForNewAddress(); }}
                onPick={(a) => {
                    if (a.id !== fromAddress?.id) resetForNewAddress();
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    const errorKey = (section) => (errorAt.section === section ? errorAt.attempt : 0);
    // The Wallet Form Standard. Address Info (open; closed it shows the
    // address shortened) holds the Network and the address whose
    // preferences are written; Protocol Fee Handling
    // is the main section (open); Incoming Sends and Dispensers are closed
    // required sections (every write carries all three values); Memo is an
    // optional closed section; then the one Network fee row and the status
    // slot above Update preferences.
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Address preferences"
            onSubmit={handleReview}
            status={formError ? (
                <>
                    <StatusMessage variant="error">{formError}</StatusMessage>
                    {formErrorDetail ? (
                        <DiagnosticDetails summary="Technical details" items={[formErrorDetail]} />
                    ) : null}
                </>
            ) : null}
            action={(
                <FormAction icon={<Icon.PencilIcon />}>Update Preferences</FormAction>
            )}
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    title={t('addressPreferences.addressInfo')}
                    icon={Icon.ReceiveIcon}
                    addressLabel={t('addressPreferences.address')}
                    summary={fromAddress.address ? <SummaryAddress address={fromAddress.address} /> : t('addressPreferences.notSet')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : [chainId]}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(cid) => { setChainId(cid); setFromAddressId(null); resetForNewAddress(); }}
                    networkHelp={t('addressPreferences.networkHelp')}
                    address={fromAddress.address}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp="The address whose preferences you set. It sends this action and pays the network fee. Once written, its preferences are visible to the whole network."
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
                    revealKey={errorKey('fee')}
                />
            )}
        >
            <FormSection
                id="protocol-fee"
                title="Protocol Fee Handling"
                icon={Icon.CoinsIcon}
                {...formSections.bind('protocolFee')}
                summary={feePref === '1' ? 'Destroy' : 'Donate (default)'}
            >
                {currentError ? (
                    <FieldNote variant="error">{currentError}</FieldNote>
                ) : null}
                {/* The choices below start at this address's current settings, so
                    there is no separate "Currently on the network" line. */}
                <IconSelect
                    label="How the protocol fee is handled"
                    help="When this address pays a protocol fee, donate it to protocol development (the default) or destroy it, which removes it from supply for good."
                    value={feePref}
                    onChange={pick('fee', setFeePref)}
                    options={[
                        { value: '2', label: 'Donate to protocol development', icon: <Icon.HandshakeIcon /> },
                        { value: '1', label: 'Destroy (reduces supply)', icon: <Icon.TrashIcon /> },
                    ]}
                />
            </FormSection>

            <FormSection
                id="incoming"
                title="Incoming Sends"
                icon={Icon.IncomingIcon}
                {...formSections.bind('incoming')}
                summary={requireMemo ? 'Memo required' : 'Any send'}
            >
                <p className={styles.hint}>Useful for an exchange or service that tells customers apart by memo.</p>
                <IconSelect
                    label="Require memo on incoming sends"
                    help="With Yes, the network refuses any send to this address that carries no memo."
                    value={requireMemo ? 'yes' : 'no'}
                    onChange={(v) => pick('requireMemo', setRequireMemo)(v === 'yes')}
                    options={[
                        { value: 'no', label: 'No', icon: <Icon.ThumbsDownIcon /> },
                        { value: 'yes', label: 'Yes', icon: <Icon.ThumbsUpIcon /> },
                    ]}
                />
            </FormSection>

            <FormSection id="dispensers" title="Dispensers" icon={Icon.DollarIcon} {...formSections.bind('dispensers')} summary={dispPref === '2' ? 'Anyone' : 'Only me'}>
                <IconSelect
                    label="Who may open dispensers"
                    help="By default only this address can open a dispenser that sells from its balance. Allowing anyone lets other addresses open a dispenser funded by this address."
                    value={dispPref}
                    onChange={pick('dispenser', setDispPref)}
                    options={[
                        { value: '2', label: 'Anyone', icon: <Icon.UsersIcon /> },
                        { value: '1', label: 'Only me', icon: <Icon.UserIcon /> },
                    ]}
                />
            </FormSection>

            {/* Memo is its own optional section holding only the memo, so the
                section title names the field and carries its count. The
                network fee is the one Network fee row. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={errorKey('memo')}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}
// The three write rows the review shows, each compared against the
// re-fetched baseline (never the load-time snapshot).
function writtenRows(params, baseline) {
    const base = baseline || {};
    const feeNow = Number(base.feePreference);
    const memoNow = Number(base.requireMemo);
    const dispNow = Number(base.dispenserPreference);
    return [
        {
            label: 'Protocol fee handling',
            value: feePreferenceLabel(params.FEE_PREFERENCE),
            // 0 and 2 share an effect, so rewriting a 0 as explicit 2 is not a change.
            changed: Number(params.FEE_PREFERENCE) !== (feeNow === 0 ? 2 : feeNow)
                && Number(params.FEE_PREFERENCE) !== feeNow,
        },
        {
            label: 'Incoming sends',
            value: requireMemoLabel(params.REQUIRE_MEMO),
            changed: Number(params.REQUIRE_MEMO) !== memoNow,
        },
        {
            label: 'Dispensers',
            value: dispenserPreferenceLabel(params.DISPENSER_PREFERENCE),
            changed: Number(params.DISPENSER_PREFERENCE) !== dispNow,
        },
    ];
}
