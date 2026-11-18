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
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/execute.js';
import '../../i18n/locales/en/coSigner.js';
// Network, From and the fee selector come from the standard FromSection and
// FeeSection.
import { Button, FormPage, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { InPageScreen } from '@xchain-wallet/core/ui/navHistory.js';
// The Wallet Form Standard frame (From, main section, Network fee,
// status slot, one action).
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    useFormSections,
} from '../components/formStandard/index.js';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { compareDecimalStrings, formatWithThousands, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { permissionsToVerbs, bpsToPercent } from '../utils/contractConsentLabels.js';
import { preferredSourceId } from '../addressSelection.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { contractBalanceRows, contractBalanceOf, contractOwnerWithdraw, OWNER_WITHDRAW_DISABLED_REASON } from './contractResponseShape.js';
import { contractFieldName, useContractRow, useContractTarget } from '../hooks/useContractTarget.js';
import { TargetField } from '../components/TargetField.jsx';
import { ContractsList } from './ContractsList.jsx';
import { OwnerWithdrawWarning } from '../components/OwnerWithdrawWarning.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { useTokenInfo } from '../hooks/useTokenInfo.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

function isPositiveDecimal(value) {
    const text = String(value).trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') === 1;
}

function contractManifestFacts(manifest) {
    const permissions = manifest?.permissions ?? null;
    const status = manifest?.status ?? (Array.isArray(permissions) ? 'declared' : 'unavailable');
    if (status === 'unavailable') {
        return [{
            label: t('components.contractConsentPanel.permissionYouGrant'),
            value: t('components.contractConsentPanel.theWalletCouldnTLook'),
        }];
    }
    const permissionValue = status === 'unrestricted'
        ? t('components.contractConsentPanel.anythingByContinuingYouGrant')
        : (() => {
            const verbs = permissionsToVerbs(permissions);
            return verbs?.length
                ? verbs.map((verb) => `${t('components.contractConsentPanel.itCan')} ${verb}`).join(', ')
                : t('components.contractConsentPanel.youGrantNoActionPermissions');
        })();
    return [
        { label: t('components.contractConsentPanel.permissionYouGrant'), value: permissionValue },
        {
            label: t('components.contractConsentPanel.maxFeeItCanTake'),
            value: bpsToPercent(manifest?.maxTakeBps) ?? t('components.contractConsentPanel.noLimitOfItsOwn'),
        },
        {
            label: t('components.contractConsentPanel.whereThisComesFrom'),
            value: t('components.contractConsentPanel.reportedByTheXchainIndex'),
        },
    ];
}

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
export function ContractFundsForm({
    mode,
    walletId,
    chainId: openedChainId,
    contractActionIndex: openedContractActionIndex,
    onBack,
}) {
    // The contract starts as the one the opening page named; the Contract
    // field's list icon can pick another.
    const contractTarget = useContractTarget(openedChainId, openedContractActionIndex);
    const { chainId, contractActionIndex } = contractTarget;
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
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
    // The standard sections' open state, held above the picker pages
    // (early returns) so it survives them, and a count of Review presses so
    // the section holding the refused value reopens on every press.
    const formSections = useFormSections({ from: false, main: true, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [errorSection, setErrorSection] = useState(/** @type {'from' | 'main' | 'fee' | null} */ (null));

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
                    setLoadError('No address on this network. Use Receive to generate one first.');
                    return;
                }
                setFromAddressId(sourceId);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
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
    const tokenInfo = useTokenInfo({ chainId, tick, skip: !tick.trim() });
    const tokenDivisibility = tokenInfo?.divisibility ?? 8;

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

    // OWNER_WITHDRAW_OPT_IN: a WITHDRAW from a contract whose meta did not opt
    // in is refused by consensus after the fee is paid, so the form stops at a
    // one-line reason instead. A DEPOSIT into a contract whose deployer CAN
    // withdraw carries the warning. Null (loading, lookup failed, older
    // explorer) keeps the form exactly as it was.
    // One read of the contract row serves the owner-withdraw answer and the
    // name the Contract field shows.
    const contractRow = useContractRow({ messaging, chainId, contractActionIndex });
    const ownerWithdraw = contractOwnerWithdraw(contractRow);
    const withdrawRefused = !isDeposit && ownerWithdraw === false;

    // A different contract holds different tokens, so a picked contract
    // starts the token and quantity over.
    const contractIdentityRef = useRef(`${chainId}\0${contractActionIndex}`);
    useEffect(() => {
        const identity = `${chainId}\0${contractActionIndex}`;
        if (contractIdentityRef.current === identity) return;
        contractIdentityRef.current = identity;
        setTick('');
        setQuantity('');
        setFormError(null);
        setContractBalances(null);
    }, [chainId, contractActionIndex]);

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
            setFormError(submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || (verb + ' failed.'),
            }));
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
    const legacyComposed = useMemo(() => ({
        action: isDeposit ? 'DEPOSIT' : 'WITHDRAW',
        chainId,
    }), [chainId, isDeposit]);

    function handleReview(event) {
        event.preventDefault();
        // Every press counts, so the section that holds the refused
        // value opens again even after the user closed it.
        setReviewAttempt((n) => n + 1);
        setErrorSection('main');
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setErrorSection('fee'); setFormError(feeStop.formError); return; }
        // The refusal line is already on screen above the fields.
        if (withdrawRefused) return;
        if (!fromAddress) {
            setErrorSection('from');
            setFormError('No source address available.');
            return;
        }
        if (!/^[1-9]\d*$/.test(String(contractActionIndex ?? '').trim())) {
            setFormError('Contract ID must be a positive whole number.');
            return;
        }
        if (!tick.trim()) {
            setFormError('Token ticker is required.');
            return;
        }
        const q = String(quantity).trim();
        if (!isPositiveDecimal(q)) {
            setFormError('Quantity must be a positive decimal.');
            return;
        }
        const precisionError = tokenAmountPrecisionError(q, {
            divisibility: tokenDivisibility,
            tick,
            noun: 'Quantity',
        });
        if (precisionError) {
            setFormError(precisionError);
            return;
        }
        if (isDeposit && tickAmtBalance != null && compareDecimalStrings(q, tickAmtBalance) === 1) {
            setFormError(
                `Only ${formatWithThousands(tickAmtBalance)} `
                + `${String(tick).trim().toUpperCase()} is available to deposit.`,
            );
            return;
        }
        // D-23: refuse a withdrawal the contract cannot cover, rather than
        // paying a fee to learn it on-chain. Only gates when the custody is
        // actually known (null = unread, so the chain stays the judge).
        if (!isDeposit && heldByContract != null && compareDecimalStrings(q, heldByContract) === 1) {
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
                    : submitFailureMessage(err, {
                        chainId, coinTicker, fallback: err?.message || (verb + ' failed.'),
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
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            // A fixed title; the contract is the main section's first field.
            title={stage === 'review' || stage === 'submitting'
                    ? `Review ${verb}`
                    : (isDeposit ? 'Deposit to Contract' : 'Withdraw from Contract')}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>
    );

    if (loadError) {
        return wrap(
            <FormPage
                label={`${verb} ${preposition} contract #${contractActionIndex}`}
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }
    if (!addressesByChain) {
        return wrap(
            <FormPage label={`${verb} ${preposition} contract #${contractActionIndex}`}>
                <p className={styles.hint}>Loading addresses…</p>
            </FormPage>,
        );
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result?.unsaved} />);
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <FormPage
                label={`${verb} broadcast`}
                actions={<Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>}
            >
                <p className={styles.summary}>
                    {verb} broadcast. The network will credit the {isDeposit ? 'contract' : 'address'} shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'N/A')}</dd>
                </dl>
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
                onReject={() => { setStage('form'); setSubmitError(null); }}
                decoded={null}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: isDeposit ? t('execute.deposit') : t('coSigner.detail.withdraw'),
                    amount: actionParams.QUANTITY,
                    ticker: actionParams.TICK.toUpperCase(),
                    direction: isDeposit ? 'out' : 'in',
                    target: t('components.confirmSummary.contractTarget', { index: actionParams.CONTRACT_ACTION_INDEX }),
                    chainId,
                    address: fromAddress?.address,
                    facts: contractManifestFacts(manifest),
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
        // A deposit leaves the signer for the contract; a withdrawal comes back.
        const fundsSummary = {
            verb: isDeposit ? t('execute.deposit') : t('coSigner.detail.withdraw'),
            ...(actionParams.QUANTITY && actionParams.TICK
                ? { amount: actionParams.QUANTITY, ticker: actionParams.TICK.toUpperCase() }
                : {}),
            direction: isDeposit ? 'out' : 'in',
            target: t('components.confirmSummary.contractTarget', { index: actionParams.CONTRACT_ACTION_INDEX }),
            chainId,
            address: fromAddress?.address,
            facts: contractManifestFacts(manifest),
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={fundsSummary}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
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

    // The Contract field's list icon: the contracts list, rendered in place
    // of the form; opening a contract makes it the one this form acts on.
    if (contractTarget.pickerOpen) {
        return (
            <InPageScreen>
                <ContractsList
                    walletId={walletId}
                    onOpenContract={contractTarget.pick}
                    onBack={contractTarget.closePicker}
                />
            </InPageScreen>
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Token picker, rendered in place of the form. DEPOSIT lists the wallet's
    // spendable tokens on the contract's chain. D-23: WITHDRAW offers the
    // CONTRACT's holdings, not the wallet's, so it hands the standard picker the
    // custody rows with the amount the contract holds as each row's balance.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                // Both directions move a token in or out of contract custody; the network coin is not a token.
                kindFilter="tokens"
                kindLocked
                title="Select Token"
                rows={isDeposit ? undefined : contractBalanceRows(contractBalances).map((row) => ({
                    chainId,
                    tick: String(row.tick).toUpperCase(),
                    quantity: String(row.quantity),
                }))}
                emptyTitle="No contract tokens"
                emptyBody="Tokens held by this contract appear here."
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

    // Section helpers. The section holding the last refusal reopens
    // on every Review press; the main section summarises the move.
    const errorKey = (id) => (formError && errorSection === id ? reviewAttempt + 1 : 0);
    const tickUpper = String(tick || '').trim().toUpperCase();
    const mainSummary = quantity ? String(quantity) : (tickUpper || null);
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={`${verb} ${preposition} contract`}
            lead={isDeposit ? <OwnerWithdrawWarning ownerWithdraw={ownerWithdraw} /> : null}
            onSubmit={handleReview}
            data-form-standard={isDeposit ? 'contract-deposit' : 'contract-withdraw'}
            status={[
                withdrawRefused ? (
                    <StatusMessage key="refused" variant="error">
                        {OWNER_WITHDRAW_DISABLED_REASON}
                    </StatusMessage>
                ) : null,
                formError ? (
                    <StatusMessage key="error" variant="error">{formError}</StatusMessage>
                ) : null,
            ]}
            action={(
                <FormAction
                    icon={isDeposit ? <Icon.UploadIcon /> : <Icon.DownloadIcon />}
                    loading={actionConfirm.composing}
                    disabled={withdrawRefused || actionConfirm.composing}
                >
                    {verb}
                </FormAction>
            )}
            /* From holds the Network (fixed by the contract) and the
               address that signs and pays the fee; on a withdrawal the tokens
               also arrive there, which its help says. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp="The chain this contract lives on. It is fixed by the contract, so your address, the token and the fee are all on this network."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp={isDeposit
                        ? 'The address that sends the tokens to the contract and pays the network fee.'
                        : 'Your address that asks the contract to release the tokens and pays the network fee; the tokens arrive here.'}
                    revealKey={errorKey('from')}
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
                id="main"
                // The main section names the action as a noun, so its
                // header never reads the same as the Deposit / Withdraw button.
                title={isDeposit ? 'Token Deposit' : 'Token Withdrawal'}
                icon={isDeposit ? Icon.UploadIcon : Icon.DownloadIcon}
                {...formSections.bind('main')}
                revealKey={errorKey('main')}
                summary={mainSummary}
                summaryUnit={quantity && tickUpper ? tickUpper : undefined}
            >
            <TargetField
                label="Contract"
                help={isDeposit
                    ? 'The contract the tokens go to. Use the list icon to pick another contract.'
                    : 'The contract the tokens come out of. Use the list icon to pick another contract.'}
                name={contractFieldName(contractRow)}
                detail={`#${contractActionIndex}`}
                onPick={contractTarget.openPicker}
                pickLabel="Choose another contract"
            />
            <TokenField
                label="Token"
                help={isDeposit
                    ? 'The token to send into the contract. It leaves the From address and is held by the contract.'
                    : 'The token to pull out of the contract. It is paid to the To address, and only if the contract permits it.'}
                value={tick && chainId ? { chainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />
            <AmountField
                label="Quantity"
                help={isDeposit
                    ? 'Amount to send to the contract.'
                    : 'Amount to pull out of the contract. Only succeeds if the contract permits it.'}
                amount={quantity}
                tick={tick}
                divisibility={tokenDivisibility}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setQuantity(stripped);
                    // Editing the amount answers whatever the last error complained
                    // about; leaving "The contract only holds 300 XCHAIN." on screen
                    // next to a corrected 300 reads as a still-blocked form.
                    setFormError(null);
                }}
                onMax={spendableBalance && compareDecimalStrings(spendableBalance, '0') === 1
                    ? () => setQuantity(spendableBalance)
                    : undefined}
                maxDisabled={!spendableBalance}
                balanceText={spendableBalance != null && (tick)
                    ? `${formatWithThousands(spendableBalance)} ${String(tick).toUpperCase()} `
                        + `${isDeposit ? 'available' : 'held by the contract'}`
                    : null}
            />
            </FormSection>
        </FormFrame>,
    );
}
