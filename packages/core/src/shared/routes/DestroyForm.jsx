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
import { useEffect, useMemo, useRef, useState } from 'react';
// Network, From and the fee selector come from the Wallet Form Standard's
// FromSection and FeeSection.
import { Button, ChainBadge, FormNotice, FormPage, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
// Destroy is laid out on the Wallet Form Standard: From, Tokens to Destroy
// (Token, Amount), Network fee, status slot, Destroy.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    useFormSections,
} from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/routes.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { prebuiltPsbtFromComposed } from '../../flows/prebuiltPsbtFromComposed.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { AmountField } from '../components/AmountField.jsx';
import { useSourceTickBalance } from '../hooks/useSourceTickBalance.js';
import { recheckSourceTickBalance } from '../../flows/sourceTickBalance.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { amountEntryProblem, formatWithThousands, groupDecodedAmounts, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { compareDecimal, exceedsBalance } from '../utils/dividendPerUnit.js';
import { TokenField } from '../components/TokenField.jsx';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import { TokenPicker } from './TokenPicker.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { isExactTypedConfirmation } from '../../flows/typedConfirmation.js';
import { destroyRefusalFor } from '../../registry/destroyPolicy.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

/** The refusal raised at Approve when the source balance falls short of the amount or cannot be read. */
const DESTROY_BALANCE_REFUSED = 'DESTROY_BALANCE_REFUSED';

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Destroy form (§40.4).
 *
 * Burns `AMOUNT` of the caller's balance of `TICK`. Irreversible at
 * the protocol level: once broadcast and mined, the destroyed balance
 * is gone. The review screen leads with the decoder's "Destroy is
 * irreversible" warning, and signing requires an exact typed DESTROY
 * confirmation.
 *
 * Until the Token detail page (§40.5 context) ships, the ticker is
 * user-entered. From Token detail, callers will pass in a prefilled
 * ticker.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DestroyForm({ walletId, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);

    const lockedToken = !!(initialChainId && initialTick);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
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
        action: 'DESTROY',
        submitMethods: { hw: 'destroyAssetHw', software: 'destroyToken' },
        initialChainId,
        initialFromAddress,
        lockedToken,
        noAddressMessage:
            'No addresses on any network yet. Use Receive to generate one before destroying.',
    });


    // Typed-confirmation gate on the review stage. User must type
    // DESTROY before the Sign button enables, on top of the existing
    // password / HW gate. Reset on every stage transition so the
    // confirmation can't carry forward from a previously-cancelled
    // review.
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = isExactTypedConfirmation(typedConfirm, 'DESTROY');

    const [ticker, setTicker] = useState(initialTick || '');

    // Balance of the amount tick at the source address (Max + "available").
    // A failed or unparseable read is unknown, never zero. An Approve refusal
    // bumps the key, so the footer and Max show the balance that refused it.
    const [balanceReadKey, setBalanceReadKey] = useState(0);
    const sourceBalance = useSourceTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: ticker,
        refreshKey: balanceReadKey,
    });
    const tickAmtBalance = sourceBalance.amount;
    // Review waits on a balance read when the debounced one has not landed.
    const [checkingBalance, setCheckingBalance] = useState(false);
    const checkingBalanceRef = useRef(false);
    const tokenInfo = useTokenInfo({ chainId, tick: ticker, skip: !ticker.trim() });
    const [amount, setAmount] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    // The standard sections' open state, held above every early
    // return (pickers, review). Only the main section opens.
    const formSections = useFormSections({ from: false, destroy: true, fee: false });
    // Counts Destroy presses, so the section holding the error
    // reopens on every attempt even after the user closed it.
    const [reviewAttempt, setReviewAttempt] = useState(0);
    // Set by a Destroy press (G22): the button is always enabled, and each
    // required field still empty then shows red with its own message.
    const [attempted, setAttempted] = useState(false);

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

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

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // An amount refusal shows under the Amount field, which takes focus, so a
    // phone shows it beside the value to fix instead of above the fold.
    const [amountError, setAmountError] = useState(/** @type {string | null} */ (null));
    // The Amount field shows the chosen token's own format: "1" stays "1",
    // "1.5" pads to "1.50000000" for an 8-place token, and extra digits get
    // its own field error, which also holds the Destroy button.
    const amountDivisibility = amountPlacesFor(tokenInfo);
    // The field shows its own precision error and holds the last valid
    // amount, so a press while it shows refuses here (G22: never disabled).
    const [amountPrecisionError, setAmountPrecisionError] = useState(/** @type {string | null} */ (null));
    const amountInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const refuseAmount = (message) => {
        setFormError(null);
        setAmountError(message);
        amountInputRef.current?.focus();
    };
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // §5.6 slice 2 (actionForms): destroys go through the single-encode
    // confirm page (compose + tamper + sdk.preflight all host-side), hardware
    // included. Watcher mode keeps the legacy review stage: it
    // encodes, it never signs. The typed-DESTROY gate rides in the confirm
    // page's credentials block.
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

    const actionParams = useMemo(() => ({
        VERSION: '0',
        TICK: ticker.trim(),
        AMOUNT: String(amount).trim(),
    }), [ticker, amount]);

    const decoded = useMemo(() => {
        // residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only, which only watcher mode reaches. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review' && stage !== 'submitting') return null;
        return groupDecodedAmounts(decoderLib.decodeAction({
            action: 'DESTROY',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        }));
    }, [stage, confirmModalOpen, actionParams, chainId]);
    const legacyComposed = useMemo(() => (decoded ? {
        action: 'DESTROY',
        chainId,
        decoded,
        protocolFeeKnownFree: true,
    } : null), [chainId, decoded]);

    // A refusal before signing hands the composed inputs back to the encoder,
    // so the next compose is not refused over coins this one still holds.
    function releaseComposedInputs(composed) {
        const release = composed?.releaseEncoderInputs;
        const token = composed?.releaseEncoderInputsToken;
        const pending = typeof release === 'function'
            ? release()
            : (typeof token === 'string' && token ? messaging.releaseEncoderInputs?.({ token }) : null);
        Promise.resolve(pending).catch(() => {});
    }

    // Single-encode confirm (mirrors Send slice 1): compose + tamper-check +
    // pre-flight run HOST-side; Approve signs the byte-identical prebuilt
    // PSBT via destroyToken.prebuiltPsbt. Reject is a calm no-op back to
    // the form; real failures land in the form error banner.
    async function openConfirmModal() {
        const from = buildFrom();
        if (!chainId || !from) return;
        setSubmitError(null);
        setTypedConfirm('');
        try {
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: {
                    mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
                },
                compose: () => messaging.composeForConfirm(withAdvancedOptions({
                    walletId,
                    chainId,
                    from,
                    actionData: { action: 'DESTROY', params: actionParams },
                    // PC-51: the opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                })),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // §4.6: the input-liveness half of the Approve-time re-check,
                // the same one useActionConfirmFlow.run gives every migrated form.
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
                releaseEncoderInputs: (token) => messaging.releaseEncoderInputs({ token }),
                // §4.7: reserve the debited balance on the host-shared ledger,
                // so two windows cannot both approve against the same balance.
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // Re-price the native-coin protocol fee at Approve.
                // The output was sized at compose, and the amount consensus
                // requires moves inversely with the coin price, so a move while
                // the confirm screen sits open leaves it short - which the
                // chain rejects while keeping the fee.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                onApprove: async (_creds, composed) => {
                    // The burn is checked against a balance read at Approve, not the
                    // one from Review: another surface or a send can spend it while
                    // the confirm page is open, and a destroy is never undone.
                    const recheck = await recheckSourceTickBalance({
                        messaging, walletId, chainId, address: from.address,
                        tick: actionParams.TICK, amount: actionParams.AMOUNT,
                    });
                    if (!recheck.ok) {
                        releaseComposedInputs(composed);
                        const refusal = new Error(recheck.reason === 'short'
                            ? t('send.destroy.balanceShort', {
                                balance: formatWithThousands(recheck.balance),
                                amount: formatWithThousands(actionParams.AMOUNT),
                                tick: actionParams.TICK,
                            })
                            : t('send.destroy.balanceUnread', { tick: actionParams.TICK }));
                        refusal.code = DESTROY_BALANCE_REFUSED;
                        refusal.reason = recheck.reason;
                        throw refusal;
                    }
                    return submit({
                        params: actionParams,
                        password: passwordValueRef.current,
                        extraBase: {
                            payFeeInNativeCoin: nativeFee.flag,
                            ...(feePerKb != null ? { feePerKb } : {}),
                            // The shared mapping, envelope and deferred outputs included.
                            prebuiltPsbt: prebuiltPsbtFromComposed(composed),
                        },
                    });
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            if (err && err.code === DESTROY_BALANCE_REFUSED) {
                setPassword('');
                setBalanceReadKey((n) => n + 1);
                if (err.reason === 'short') refuseAmount(err.message);
                else setFormError(err.message);
                return;
            }
            console.error('Destroy (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: humanizeError(err, 'destroy').message,
            }));
        }
    }

    async function handleReview(event) {
        event.preventDefault();
        if (checkingBalanceRef.current) return;
        setReviewAttempt((n) => n + 1);
        setAttempted(true);
        // G22: an empty required field is marked on the field itself and
        // takes the cursor; nothing else is checked until it is filled.
        const firstMissing = !ticker.trim() ? 'destroy-token'
            : (!String(amount).trim() || amountPrecisionError) ? 'destroy-amount' : null;
        if (firstMissing) {
            setFormError(null);
            setTimeout(() => document.getElementById(firstMissing)?.focus(), 0);
            return;
        }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!ticker.trim()) {
            setFormError('Ticker is required.');
            return;
        }
        const tickerError = tickerReferenceError(ticker);
        if (tickerError) {
            setFormError(tickerError);
            return;
        }
        const destroyRefusal = destroyRefusalFor({
            tick: ticker,
            sourceCoin: chainRegistry.get(chainId)?.coin,
        });
        if (destroyRefusal) {
            setFormError(destroyRefusal.reason);
            return;
        }
        const amt = String(amount).trim();
        // Digits, not a float: Number('.') is NaN and slips past a <= 0 test.
        const amountProblem = amountEntryProblem(amt);
        if (amountProblem === 'shape') {
            refuseAmount('Write the amount with digits on both sides of the decimal point, such as 0.5.');
            return;
        }
        if (amountProblem) {
            refuseAmount('Amount must be a positive number.');
            return;
        }
        // Keep the burn within the token's on-chain decimal scale.
        const precisionError = tokenAmountPrecisionError(amt, {
            divisibility: tokenInfo?.divisibility,
            tick: ticker,
        });
        if (precisionError) {
            refuseAmount(precisionError);
            return;
        }
        setAmountError(null);
        const TICK = ticker.trim();
        // A burn is judged only against a balance the wallet read and parsed:
        // one still loading is read here, and one that cannot be read stops it.
        let balance = tickAmtBalance;
        if (balance == null) {
            checkingBalanceRef.current = true;
            setCheckingBalance(true);
            let read;
            try {
                read = await recheckSourceTickBalance({
                    messaging, walletId, chainId, address: fromAddress.address, tick: TICK, amount: amt,
                });
            } finally {
                checkingBalanceRef.current = false;
                setCheckingBalance(false);
            }
            if (read.reason === 'unread') {
                setFormError(t('send.destroy.balanceUnread', { tick: TICK }));
                return;
            }
            balance = read.balance;
        }
        // Refuse a burn the selected source address cannot fund.
        if (exceedsBalance(amt, balance)) {
            refuseAmount(
                `This address holds only ${formatWithThousands(balance)} ${TICK}. `
                + 'Enter an amount at or below that balance.',
            );
            return;
        }
        setFormError(null);
        // Software and hardware signers both go straight to the single-encode
        // confirm page; only watcher mode, which builds an unsigned
        // transaction, reaches the legacy review stage.
        if (!isWatcherMode) {
            openConfirmModal();
            return;
        }
        setStage('review');
    }

    // §18.4 / Cluster N: HW signer info threads into <SignCredentials>.
    // `isHwSource` + `fromAddress` come from the shared hook.
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });

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
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
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
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Destroy failed.',
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
        setAttempted(false); // a fresh form opens with no G22 marks
        setSubmitError(null);
        setStage('form');
    }
    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review Destroy'
                    : `Destroy`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Destroy token"
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(<FormPage demoGuard={demoGuard} label="Destroy token"><p className={styles.hint}>Loading…</p></FormPage>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <FormPage demoGuard={demoGuard} label="Unsigned destroy transaction">
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={handleBuildAnother}
                        onDone={onBack}
                    />
                </FormPage>,
            );
        }
        // Signed but not broadcast. Nothing has been destroyed yet.
        if (result?.queued) {
            return wrap(
                <FormPage demoGuard={demoGuard} label="Queued destroy transaction">
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} what="destroy" unsaved={result.unsaved} />
                </FormPage>,
            );
        }
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Destroy result"
                actions={<Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>}
            >
                <h2 className={styles.successTitle}>Destroyed</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
            </FormPage>,
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
                onReject={() => { setSubmitError(null); setTypedConfirm(''); setStage('form'); }}
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentialsReady={typedConfirmOk}
                credentials={(
                    <>
                        <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                        <Input
                            label='Type "DESTROY" to confirm'
                            help={t('common.typedConfirmationHint', { word: 'DESTROY' })}
                            value={typedConfirm}
                            onChange={(event) => setTypedConfirm(event.target.value)}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    </>
                )}
                summary={{
                    verb: t('routes.manageToken.destroy'),
                    amount: actionParams.AMOUNT,
                    ticker: actionParams.TICK.toUpperCase(),
                    chainId,
                    direction: 'out',
                    address: fromAddress?.address,
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // The confirm page renders in place of the form (an overlay modal did not
    // fit small viewports); other form state stays intact behind it. The
    // typed-DESTROY gate rides in the credentials block.
    if (confirmModalOpen) {
        // The hero states the composed action: the amount leaving supply,
        // from the address that signs it.
        const destroySummary = {
            verb: t('routes.manageToken.destroy'),
            amount: actionParams.AMOUNT,
            ticker: actionParams.TICK.toUpperCase(),
            chainId,
            direction: 'out',
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                summary={destroySummary}
                screenVariant={variant}
                chainLabel={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                // Fallback only: the composed PSBT's exact fee wins (§5.2.5).
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // The typed-DESTROY gate is ANDed onto whichever credential the
                // source needs: a password, or an available device.
                credentialsReady={(isHwSource
                    ? hwStatus === 'available'
                    : (signerReady || password.length > 0)) && typedConfirmOk}
                extraCredentials={(
                    <Input
                        label='Type "DESTROY" to confirm'
                        help={t('common.typedConfirmationHint', { word: 'DESTROY' })}
                        value={typedConfirm}
                        onChange={(e) => setTypedConfirm(e.target.value)}
                        autoComplete="off"
                    />
                )}
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

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                // DESTROY burns token supply; the network coin is not a token.
                kindFilter="tokens"
                kindLocked
                title="Select Token"
                onSelect={(sel) => {
                    setTicker(String(sel.tick || ''));
                    // The Token field is live with a preset token
                    // too, so a pick on another chain re-targets the form.
                    if (sel.chainId) setChainId(sel.chainId);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // Which standard section the current error belongs to, and the
    // closed sections' one-line summaries.
    const errorSection = (() => {
        if (!formError) return null;
        if (/source address/i.test(formError)) return 'from';
        // A custom fee refusal (the review's fee stop) belongs to Network fee.
        const feeStopNow = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStopNow && feeStopNow.formError === formError) return 'fee';
        return 'destroy';
    })();
    // G22 marks: shown once Destroy was pressed, cleared as soon as filled.
    const tokenMark = attempted && !ticker.trim() ? 'Pick the token to destroy.' : undefined;
    const amountMark = attempted && !String(amount).trim() ? 'Enter how much to destroy.' : undefined;
    const sectionErrorKey = (id) => (
        errorSection === id || (id === 'destroy' && (tokenMark || amountMark)) ? reviewAttempt + 1 : 0
    );
    const tickUpper = String(ticker || '').trim().toUpperCase();
    const destroySummary = [amount ? formatWithThousands(amount) : null, tickUpper].filter(Boolean).join(' ') || null;
    const sourceMissing = Boolean(addressesByChain) && !fromAddress
        && (addressesByChain[chainId] || []).length === 0;
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Destroy token"
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    icon={<Icon.TrashIcon />}
                    loading={confirmAction.composing || checkingBalance}
                    disabled={confirmAction.composing || checkingBalance}
                >
                    Destroy
                </FormAction>
            )}
            from={(
                // Network and From live in the closed From section.
                // The picked token decides the network (its picker lists every
                // chain and moves the form), so Network locks once a token is set.
                <FromSection
                    {...formSections.bind('from')}
                    revealKey={sectionErrorKey('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={setChainId}
                    lockNetwork={Boolean(ticker)}
                    networkHelp="The chain the destroy is recorded on. Your From address, token balance, and network fee are on this network."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp="The address whose balance is burned. It signs this destroy and pays the network fee."
                    missing={sourceMissing ? (
                        <FormNotice variant="error">
                            {t('send.source.noAddress')}
                        </FormNotice>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    revealKey={sectionErrorKey('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                />
            )}
        >
            <FormSection
                id="destroy"
                // The main section names the action without repeating
                // the Destroy button's own name.
                title="Tokens to Destroy"
                icon={Icon.TrashIcon}
                {...formSections.bind('destroy')}
                revealKey={sectionErrorKey('destroy')}
                summary={destroySummary}
            >
            {/* Always the standard Token field, even when the token
                arrives already chosen; the preset token simply fills it. */}
            {(
                <TokenField
                    id="destroy-token"
                    error={tokenMark}
                    label="Token"
                    help="The token balance you are permanently destroying. Only tokens available to send from this wallet are listed."
                    value={ticker && chainId ? { chainId, tick: ticker } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}
            <AmountField
                label="Amount"
                help="How much to destroy."
                id="destroy-amount"
                amount={amount}
                tick={ticker}
                divisibility={amountDivisibility}
                inputRef={amountInputRef}
                error={amountError || amountMark}
                onValidationError={setAmountPrecisionError}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmount(stripped);
                    setAmountError(null);
                }}
                onMax={compareDecimal(tickAmtBalance, '0') === 1
                    ? () => { setAmount(tickAmtBalance); setAmountError(null); }
                    : undefined}
                maxDisabled={!tickAmtBalance}
                balanceText={tickAmtBalance != null && (ticker)
                    ? `${formatWithThousands(tickAmtBalance)} ${String(ticker)} available`
                    : (sourceBalance.unreadable && ticker ? t('send.balance.unknown') : null)}
            />
            </FormSection>
            {/* The fee selector lives in the Network fee section. */}
        </FormFrame>,
    );
}

/**
 * The chosen token's decimal places for the Amount field, or undefined while
 * the token record is unknown. A missing value must stay undefined: the field
 * reads Number(null) as 0 and would refuse every decimal.
 *
 * @param {{ divisibility?: unknown } | null | undefined} info
 * @returns {number | undefined}
 */
function amountPlacesFor(info) {
    const raw = info?.divisibility;
    if (raw === null || raw === undefined || raw === '') return undefined;
    const places = Number(raw);
    return Number.isInteger(places) && places >= 0 ? places : undefined;
}
