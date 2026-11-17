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
// Network, From and the fee selector render inside the standard
// FromSection and FeeSection.
import { Button, ChainBadge, FormPage, Icon, Input, ListPage, PageHeader, Screen, Select, StatusMessage } from '@xchain-wallet/core/ui';
import { InPageScreen } from '@xchain-wallet/core/ui/navHistory.js';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
// The Fees card renders inside the standard FeeSection.
import { useNativeFee } from '../hooks/useNativeFee.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import {
    NATIVE_FEE_WARNING,
    NATIVE_FEE_UNVERIFIED_NOTICE,
} from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { revealHiddenText } from '../utils/textHardening.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { extractSingle, sanitizeAbi, contractOwnerWithdraw } from './contractResponseShape.js';
import { contractFieldName, useContractTarget } from '../hooks/useContractTarget.js';
import { TargetField } from '../components/TargetField.jsx';
import { ContractsList } from './ContractsList.jsx';
import { OwnerWithdrawWarning } from '../components/OwnerWithdrawWarning.jsx';
import { permissionsToVerbs, bpsToPercent } from '../utils/contractConsentLabels.js';
import { preferredSourceId } from '../addressSelection.js';
import styles from './IssueTokenForm.module.css';
import contractStyles from './ContractScreens.module.css';
import { AmountField } from '../components/AmountField.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { compareDecimalStrings, formatWithThousands, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/execute.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/components.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
// Call contract is laid out on the Wallet Form Standard frame.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    useFormSections,
} from '../components/formStandard/index.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

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

function isPositiveDecimal(value) {
    const text = String(value).trim();
    return /^\d+(?:\.\d+)?$/.test(text) && /[1-9]/.test(text);
}

async function buildExecuteBatchParams({
    messaging,
    chainId,
    contractActionIndex,
    depositTick,
    depositQuantity,
    actionParams,
}) {
    const res = await messaging.buildBatchCommand({
        chainId,
        subActions: [
            {
                action: 'DEPOSIT',
                params: {
                    VERSION: '0',
                    CONTRACT_ACTION_INDEX: String(contractActionIndex),
                    TICK: depositTick.trim().toUpperCase(),
                    QUANTITY: depositQuantity.trim(),
                },
            },
            { action: 'EXECUTE', params: actionParams },
        ],
    });
    return { VERSION: '0', COMMAND: res.command };
}

function abiArgumentError(param, value, descriptor) {
    const name = param?.name || 'Argument';
    const type = String(param?.type || '').toLowerCase();
    const text = String(value ?? '').trim();
    if (!text) return `${name} is required.`;
    if (text.includes('|') || text.includes(';')) {
        return `${name} cannot contain "|" or ";".`;
    }
    if (type === 'amount' && !isPositiveDecimal(text)) {
        return `${name} must be a positive decimal amount.`;
    }
    if (type === 'amount') {
        const precisionError = tokenAmountPrecisionError(text, {
            divisibility: 8,
            noun: name,
        });
        if (precisionError) return precisionError;
    }
    if (type === 'address' && (!descriptor?.coin || !descriptor?.networkKind
        || !isValidAddressForChain(text, descriptor.coin, descriptor.networkKind))) {
        return `${name} must be a valid address for ${descriptor?.displayName || 'this network'}.`;
    }
    if (type === 'tick') {
        // A ticker a call names must be one the chain could have coined; a
        // stray space or comma would be sent as typed and the paid call would
        // fail at runtime.
        const tickError = tickerReferenceError(text, { noun: name, allowRef: true });
        if (tickError) return tickError;
    }
    if (type === 'number' && !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) {
        return `${name} must be a decimal number.`;
    }
    if (type === 'bool' && text !== 'true' && text !== 'false') {
        return `${name} must be true or false.`;
    }
    if (type === 'json') {
        try {
            JSON.parse(text);
        } catch (err) {
            return userFacingMessage(
                err,
                `${name} contains invalid JSON. Check the syntax and try again.`,
            );
        }
    }
    return null;
}

/**
 * EXECUTE contract method form (§42.4).
 *
 * The method is always picked from the contract's declared list
 * (xchain-documentation/protocol/Contract_ABI.md, surfaced by the explorer
 * on /api/contract/{idx}): a method selector plus one typed input per
 * declared param. There is no free-text method field; when the list cannot
 * load (lookup error, no abi, no methods) the form shows an error with Try
 * Again and Execute stays disabled.
 *
 * Inputs split the pipe-delimited parameter string into an array on
 * submit. The SDK validator expects PARAMS as an array, not a single
 * string, and enforces no-pipe-or-semicolon inside each element.
 *
 * There is no gas-limit input: EXECUTE v0 carries no GAS_LIMIT slot on
 * the wire (a top-level call runs at the protocol gas ceiling), so any
 * such field would either be silently discarded or, under the SDK's
 * leg-field guard, block the compose outright.
 *
 * An optional deposit turns the call into a two-step BATCH (DEPOSIT, then
 * EXECUTE, same contract) signed through the advancedAction path. EXECUTE
 * carries no amount, so a method that expects payment (a loan's fundLoan)
 * only sees tokens deposited ahead of it in the same transaction; without
 * this lane the form could not fund such a call at all, and a tester's bare
 * fundLoan reverted. The token picker is locked to the contract's chain,
 * because a contract only sees balances on its own chain.
 *
 * The initial* props prefill the form from an xchain:{COIN}/execute deep
 * link (explorer Write-tab handoff); all optional.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.contractActionIndex
 * @param {string} [props.initialMethod]
 * @param {string} [props.initialParamsText]
 * @param {() => void} props.onBack
 */
export function ExecuteContractForm({
    walletId,
    chainId: openedChainId,
    contractActionIndex: openedContractActionIndex,
    initialMethod,
    initialParamsText,
    onBack,
}) {
    // The contract starts as the one the opening page named; the Contract
    // field's list icon can pick another, which resets the call below.
    const contractTarget = useContractTarget(openedChainId, openedContractActionIndex);
    const { chainId, contractActionIndex } = contractTarget;
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [method, setMethod] = useState(initialMethod || '');
    const [paramsText, setParamsText] = useState(initialParamsText || '');
    const [password, setPassword] = useState('');
    // Optional deposit sent ahead of the call; both blank means a plain EXECUTE.
    const [depositTick, setDepositTick] = useState('');
    const [depositQuantity, setDepositQuantity] = useState('');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);

    // Method list state: the contract's declared methods (null until loaded),
    // whether the lookup is loading, ready or failed, a counter that Try Again
    // bumps to re-read, a prefill refusal, and per-param values for the
    // selected method (joined into paramsText, which stays the single source
    // of truth for submit).
    const [contractAbi, setContractAbi] = useState(/** @type {{version: number, methods: Record<string, any>} | null} */ (null));
    const [abiStatus, setAbiStatus] = useState(/** @type {'loading' | 'ready' | 'error'} */ ('loading'));
    const [abiLoadError, setAbiLoadError] = useState(/** @type {string | null} */ (null));
    const [abiAttempt, setAbiAttempt] = useState(0);
    const [linkError, setLinkError] = useState(/** @type {string | null} */ (null));
    const [abiParamValues, setAbiParamValues] = useState(/** @type {string[]} */ ([]));
    // OWNER_WITHDRAW_OPT_IN off the same contract row: a swap or add-liquidity
    // call hands tokens to a contract whose deployer may be able to pull them
    // out, so true carries the warning. Null (no field, no row) shows nothing.
    const [ownerWithdraw, setOwnerWithdraw] = useState(/** @type {boolean | null} */ (null));
    // The same row's exported name, for the Contract field.
    const [contractRow, setContractRow] = useState(/** @type {any | null} */ (null));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // The standard section a Call refusal belongs to, and a counter
    // bumped on every attempt, so that section reopens each time.
    const [formErrorSection, setFormErrorSection] = useState(/** @type {string | null} */ (null));
    const [reviewAttempt, setReviewAttempt] = useState(0);
    // Open state held above the picker and review early returns.
    // From starts closed, Call open, Deposit and the fee closed.
    const formSections = useFormSections({ from: false, call: true, deposit: false, fee: false });
    const failIn = (section, message) => {
        setFormError(message);
        setFormErrorSection(section);
    };
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);
    const contractIdentityRef = useRef(`${chainId}\0${contractActionIndex}`);

    useEffect(() => {
        let cancelled = false;
        setAddressesByChain(null);
        setFromAddressId(null);
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
                // Execute from the chain's active address (else newest HD
                // external), matching Send so the action's SOURCE is the
                // operating address.
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this network can call the contract. Use Receive to generate one first.');
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

    // Fetch the contract's declared methods (same explorer row ContractDetail
    // reads). The method is always picked from this list, so a failed lookup,
    // an absent abi or no declared methods leaves the form in an error state
    // with Try Again and Execute disabled. A deep-link prefill that names a
    // method the list knows preselects it and seeds its inputs; one the list
    // does not know is refused with a clear message.
    useEffect(() => {
        let cancelled = false;
        const contractIdentity = `${chainId}\0${contractActionIndex}`;
        setAbiStatus('loading');
        setAbiLoadError(null);
        setLinkError(null);
        if (contractIdentityRef.current !== contractIdentity) {
            contractIdentityRef.current = contractIdentity;
            setContractAbi(null);
            setOwnerWithdraw(null);
            setContractRow(null);
            setMethod(initialMethod || '');
            setParamsText(initialParamsText || '');
            setAbiParamValues([]);
            setDepositTick('');
            setDepositQuantity('');
            setFormError(null);
            setSubmitError(null);
            setResult(null);
            setStage('form');
        }
        if (typeof messaging.getContractByActionIndex !== 'function') {
            setAbiLoadError(t('execute.methodsLoadFailed'));
            setAbiStatus('error');
            return undefined;
        }
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => {
                if (cancelled) return;
                const row = extractSingle(resp);
                setContractRow(row || null);
                setOwnerWithdraw(contractOwnerWithdraw(row));
                // sanitizeAbi guarantees every kept method has an array `params`,
                // so the .map sites below (and at render) can never throw on a
                // malformed/hostile abi. Null means the contract declares none.
                const abi = sanitizeAbi(row && row.abi);
                const names = abi ? Object.keys(abi.methods) : [];
                if (!abi || names.length === 0) {
                    setAbiLoadError(t('execute.noMethods'));
                    setAbiStatus('error');
                    return;
                }
                setContractAbi(abi);
                setAbiStatus('ready');
                if (initialMethod && names.includes(initialMethod)) {
                    const declared = abi.methods[initialMethod].params || [];
                    const givenText = initialParamsText || '';
                    const given = givenText === '' ? [] : givenText.split('|');
                    if (given.length > declared.length) {
                        // Hiding arguments the method does not declare would
                        // change the call, so the link is refused instead.
                        setMethod('');
                        setAbiParamValues([]);
                        setParamsText('');
                        setLinkError(t('execute.linkTooManyArgs', { method: initialMethod, count: declared.length }));
                        return;
                    }
                    const declaredValues = declared.map((p, i) => (given[i] !== undefined ? given[i] : ''));
                    setMethod(initialMethod);
                    setAbiParamValues(declaredValues);
                    setParamsText(declaredValues.join('|'));
                } else if (initialMethod) {
                    setMethod('');
                    setAbiParamValues([]);
                    setParamsText('');
                    setLinkError(t('execute.linkUnknownMethod', { method: initialMethod }));
                } else {
                    const first = names[0];
                    setMethod(first);
                    setAbiParamValues(new Array((abi.methods[first].params || []).length).fill(''));
                    setParamsText('');
                }
            })
            .catch((err) => {
                if (cancelled) return;
                setAbiLoadError(userFacingMessage(err, t('execute.methodsLoadFailed')));
                setAbiStatus('error');
            });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- initial* are mount-time prefill constants
    }, [chainId, contractActionIndex, messaging, abiAttempt]);

    const descriptor = chainRegistry.get(chainId);
    const coinTicker = protocolCoinTickerFor(descriptor || chainId);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // EXECUTE is fee-bearing, and this form had no fee lane at all
    // because BTC could always settle the protocol fee from an XCHAIN balance.
    // On every other protocol coin there is no XCHAIN lane, so the hook forces
    // the native output on rather than offering a choice that does not exist.
    // The quote behind it is that schedule price, which carries no verdict
    // (`valid:null`), hence `unverified` on the row: the amount is exact, the
    // acceptance is not pre-judged, and the fee is spent either way.
    const nativeFee = useNativeFee(chainId);

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
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
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
        software: 'executeAction',
        hardware: 'executeActionHw',
    });
    // A call with a deposit is a BATCH, which signs through the generic path.
    const submitBatchConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'advancedAction',
        hardware: 'advancedActionHw',
    });

    const hasDeposit = depositTick.trim() !== '' || depositQuantity.trim() !== '';
    const depositBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: depositTick,
    });
    const depositTokenInfo = useTokenInfo({
        chainId,
        tick: depositTick,
        skip: !depositTick.trim(),
    });
    const depositDivisibility = depositTokenInfo?.divisibility ?? 8;

    // DEPOSIT first: the contract checks its balance rose when the call runs.
    async function composeBatchParams() {
        return buildExecuteBatchParams({
            messaging,
            chainId,
            contractActionIndex,
            depositTick,
            depositQuantity,
            actionParams,
        });
    }

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
            if (hasDeposit) {
                const batchParams = await composeBatchParams();
                const res = await actionConfirm.run({
                    chainId,
                    from,
                    actionData: { action: 'BATCH', params: batchParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    onApprove: (prebuiltPsbt) => submitBatchConfirmed({
                        walletId,
                        chainId,
                        from,
                        action: 'BATCH',
                        params: batchParams,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    }),
                });
                setResult(res);
                setPassword('');
                setStage('done');
                return;
            }
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'EXECUTE', params: actionParams },
                // The fee mode must reach COMPOSE, not just submit: the
                // FEE_DESTINATION output has to be inside the PSBT the user
                // approves and the tamper check verifies.
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    payFeeInNativeCoin: nativeFee.flag,
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
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: 'Contract call failed.',
            }));
        }
    }

    // Phase F: permissions-manifest consent disclosure, shown inline in
    // the review `<dl>`. Deferred via `skip` until the user reaches the
    // review stage so we don't fetch a manifest the user may never see.
    const manifest = useContractManifest({
        chainId,
        contractActionIndex,
        skip: stage !== 'review' && stage !== 'submitting',
    });

    const paramsArray = useMemo(
        () => paramsText.split('|').map((s) => s.trim()).filter((s) => s !== ''),
        [paramsText],
    );

    // ABI lane derivations. Params are positional on the wire, so a blank
    // middle value would silently shift later args after the empty-filter in
    // paramsArray; the lane therefore requires every declared param filled
    // before the action enables.
    const abiActive = Boolean(contractAbi) && abiStatus === 'ready';
    const abiSpec = abiActive && method && contractAbi.methods[method] ? contractAbi.methods[method] : null;
    const abiParams = Array.isArray(abiSpec?.params) ? abiSpec.params : [];
    const abiArgumentErrors = abiParams.map((param, index) => abiArgumentError(
        param,
        abiParamValues[index],
        descriptor,
    ));
    function selectAbiMethod(name) {
        setMethod(name);
        const count = ((contractAbi.methods[name] || {}).params || []).length;
        setAbiParamValues(new Array(count).fill(''));
        setParamsText('');
        setFormError(null);
        setLinkError(null);
    }

    function setAbiParam(i, value) {
        const next = abiParamValues.slice();
        next[i] = value;
        setAbiParamValues(next);
        setParamsText(next.join('|'));
        setFormError(null);
    }

    // Placeholder text per declared param type; purely an input hint, the
    // wire value is always a string.
    function abiPlaceholder(type) {
        switch (type) {
            case 'number': return 'e.g. 42';
            case 'amount': return 'e.g. 1.50000000';
            case 'address': return 'address';
            case 'tick': return 'e.g. XCHAIN';
            case 'bool': return 'true or false';
            case 'json': return '{"key":"value"}';
            default: return '';
        }
    }

    const actionParams = useMemo(() => {
        /** @type {Record<string, any>} */
        const p = {
            VERSION: '0',
            CONTRACT_ACTION_INDEX: String(contractActionIndex),
            METHOD: method.trim(),
        };
        if (paramsArray.length > 0) p.PARAMS = paramsArray;
        return p;
    }, [contractActionIndex, method, paramsArray]);
    const executeQuoteInputsValid = useMemo(() => {
        if (!fromAddress?.address || !/^[1-9]\d*$/.test(String(contractActionIndex ?? '').trim())) return false;
        if (!abiSpec) return false;
        if (!method.trim() || method.includes('|') || method.includes(';')) return false;
        if (actionTextSafetyError(method, 'Method')) return false;
        if (abiArgumentErrors.some(Boolean)) return false;
        if (paramsArray.some((param) => actionTextSafetyError(param, 'Parameter') || param.includes(';'))) {
            return false;
        }
        if (hasDeposit) {
            const quantity = depositQuantity.trim();
            if (!depositTick.trim() || !isPositiveDecimal(quantity)) return false;
            if (tokenAmountPrecisionError(quantity, {
                divisibility: depositDivisibility,
                tick: depositTick,
                noun: 'Deposit amount',
            })) return false;
            if (depositBalance != null && compareDecimalStrings(quantity, depositBalance) === 1) return false;
        }
        return true;
    }, [fromAddress?.address, contractActionIndex, method, abiSpec, abiArgumentErrors,
        paramsText, paramsArray, hasDeposit, depositQuantity, depositTick, depositDivisibility,
        depositBalance]);
    const [quoteBatchParams, setQuoteBatchParams] = useState(null);
    useEffect(() => {
        let cancelled = false;
        setQuoteBatchParams(null);
        if (!executeQuoteInputsValid || !hasDeposit
            || typeof messaging.quoteProtocolFee !== 'function') return () => { cancelled = true; };
        buildExecuteBatchParams({
            messaging,
            chainId,
            contractActionIndex,
            depositTick,
            depositQuantity,
            actionParams,
        }).then((params) => {
            if (!cancelled) setQuoteBatchParams(params);
        }).catch(() => {
            if (!cancelled) setQuoteBatchParams(null);
        });
        return () => { cancelled = true; };
    }, [executeQuoteInputsValid, hasDeposit, messaging, chainId, contractActionIndex,
        depositTick, depositQuantity, actionParams]);
    const executeQuoteActionData = useMemo(() => {
        if (!executeQuoteInputsValid) return null;
        if (hasDeposit) return quoteBatchParams
            ? { action: 'BATCH', params: quoteBatchParams }
            : null;
        return { action: 'EXECUTE', params: actionParams };
    }, [executeQuoteInputsValid, hasDeposit, quoteBatchParams, actionParams]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: executeQuoteActionData,
    });
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyDecoded = useMemo(() => ({
        summary: t('execute.callContract'),
        details: [],
        warnings: nativeFee.payFeeInNativeCoin
            ? [NATIVE_FEE_WARNING, NATIVE_FEE_UNVERIFIED_NOTICE]
            : [],
    }), [nativeFee.payFeeInNativeCoin]);
    const legacyComposed = useMemo(() => ({
        action: hasDeposit ? 'BATCH' : 'EXECUTE',
        chainId,
        decoded: legacyDecoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    }), [chainId, hasDeposit, legacyDecoded, protocolFeeQuote, quotedProtocolFee.free, quotedProtocolFee.known]);

    function handleReview(event) {
        event.preventDefault();
        // Each attempt may reopen the section holding the refusal;
        // failIn names it (From, Call, Deposit or the fee).
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { failIn('fee', feeStop.formError); return; }
        // EXECUTE is signed from an address on this chain; without one there is
        // nothing to pay the call's fee from.
        if (!fromAddress) {
            failIn('from', 'No source address available.');
            return;
        }
        if (!/^[1-9]\d*$/.test(String(contractActionIndex ?? '').trim())) {
            failIn('call', 'Contract ID must be a positive whole number.');
            return;
        }
        // The method comes only from the contract's declared list.
        if (!abiActive) {
            failIn('call', abiLoadError || t('execute.methodsLoading'));
            return;
        }
        if (!abiSpec) {
            failIn('call', linkError || t('execute.chooseMethod'));
            return;
        }
        if (method.includes('|') || method.includes(';')) {
            failIn('call', 'Method name cannot contain "|" or ";".');
            return;
        }
        const methodSafetyError = actionTextSafetyError(method, 'Method');
        if (methodSafetyError) {
            failIn('call', methodSafetyError);
            return;
        }
        const argumentError = abiArgumentErrors.find(Boolean);
        if (argumentError) {
            failIn('call', argumentError);
            return;
        }
        // Validator forbids pipes/semicolons inside each PARAM, which
        // our split eliminates; it also forbids them at the field
        // boundaries. Nothing we can do about those except surface
        // clearly below.
        for (const p of paramsArray) {
            const parameterSafetyError = actionTextSafetyError(p, 'Parameter');
            if (parameterSafetyError) {
                failIn('call', parameterSafetyError);
                return;
            }
            if (p.includes(';')) {
                failIn('call', `Parameter "${p}" contains a semicolon, which is not allowed in parameters.`);
                return;
            }
        }
        // A half-filled deposit is a mistake either way: a token with no
        // amount, or an amount with no token, has nothing it could send.
        if (hasDeposit) {
            if (!depositTick.trim()) {
                failIn('deposit', 'Choose the token to deposit, or clear the deposit amount.');
                return;
            }
            const q = depositQuantity.trim();
            if (!isPositiveDecimal(q)) {
                failIn('deposit', 'Deposit amount must be a positive number.');
                return;
            }
            const precisionError = tokenAmountPrecisionError(q, {
                divisibility: depositDivisibility,
                tick: depositTick,
                noun: 'Deposit amount',
            });
            if (precisionError) {
                failIn('deposit', precisionError);
                return;
            }
            if (depositBalance != null && compareDecimalStrings(q, depositBalance) === 1) {
                failIn(
                    'deposit',
                    `Deposit amount exceeds the ${formatWithThousands(depositBalance)} `
                    + `${depositTick.trim().toUpperCase()} available.`,
                );
                return;
            }
        }
        setFormError(null);
        setFormErrorSection(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submitInFlightRef.current) return;
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
                params: actionParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (hasDeposit) {
                const batchParams = await composeBatchParams();
                const batch = { ...base, action: 'BATCH', params: batchParams };
                if (isWatcherMode) {
                    res = await messaging.buildActionPsbtRequest({
                        chainId,
                        from: base.from,
                        actionData: { action: 'BATCH', params: batchParams },
                        // Same fee output as the plain call: the signer wallet
                        // signs this PSBT blind, so the flag has to be in it.
                        encoderOpts: {
                            payFeeInNativeCoin: nativeFee.flag,
                            ...(feePerKb != null ? { feePerKb } : {}),
                        },
                    });
                } else if (isHwSource) {
                    res = await messaging.advancedActionHw({ ...batch, signerId: fromAddress.signerId });
                } else {
                    res = await messaging.advancedAction({ ...batch, password });
                }
            } else if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'EXECUTE', params: actionParams },
                    // The watcher lane builds the PSBT the signer wallet will
                    // sign blind, so the fee output has to be in it here.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.executeActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.executeAction({ ...base, password });
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
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: 'Contract call failed.',
                    }),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitInFlightRef.current = false;
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
            // A fixed title; the contract is the Method section's first field.
            title={stage === 'review' || stage === 'submitting'
                    ? t('execute.review.title')
                    : t('execute.title')}
        />
    );
    // The review always opens at its top instead of inheriting how far the
    // form was scrolled; the form keeps its own position for Back.
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>
    );

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain) {
        return wrap(<ListPage><p>{t('execute.loadingAddresses')}</p></ListPage>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} />);
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
            <ListPage>
                <p className={styles.summary}>{t('execute.success')}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>{t('send.txid')}</dt>
                    <dd className={styles.detailsValue}>{String(txid || '(none)')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>{t('common.done')}</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const callTarget = method
            ? t('components.confirmSummary.contractMethodTarget', { index: String(contractActionIndex), method })
            : t('components.confirmSummary.contractTarget', { index: String(contractActionIndex) });
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
                decoded={legacyDecoded}
                headline={t('execute.callContract')}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('execute.callContract'),
                    target: callTarget,
                    ...(hasDeposit && depositTick.trim() && depositQuantity.trim()
                        ? { amount: depositQuantity.trim(), ticker: depositTick.trim().toUpperCase(), direction: 'out' }
                        : { direction: 'none' }),
                    chainId,
                    address: fromAddress?.address,
                    facts: [
                        ...paramsArray.map((param, index) => ({
                            label: `${t('execute.params')} ${index + 1}`,
                            value: revealHiddenText(param),
                        })),
                        ...contractManifestFacts(manifest),
                    ],
                    ...(!nativeFee.flag && quotedProtocolFee.known ? {
                        protocolFee: {
                            amount: quotedProtocolFee.free ? '0' : String(quotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
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
        // The contract and method called; a deposit sent with the call is
        // the amount leaving the signer.
        const callTarget = method
            ? t('components.confirmSummary.contractMethodTarget', { index: String(contractActionIndex), method })
            : t('components.confirmSummary.contractTarget', { index: String(contractActionIndex) });
        const callSummary = {
            verb: t('execute.callContract'),
            target: callTarget,
            ...(hasDeposit && depositTick.trim() && depositQuantity.trim()
                ? { amount: depositQuantity.trim(), ticker: depositTick.trim().toUpperCase(), direction: 'out' }
                : { direction: 'none' }),
            chainId,
            address: fromAddress?.address,
            facts: [
                ...paramsArray.map((param, index) => ({
                    label: `${t('execute.params')} ${index + 1}`,
                    value: revealHiddenText(param),
                })),
                ...contractManifestFacts(manifest),
            ],
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={callSummary}
                screenVariant={variant}
                chainLabel={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? t('send.networkFeeValue', {
                        amount: feeEstimate.coinAmount,
                        ticker: coinTicker,
                    }).trim()
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

    // Locked to the contract's chain: tokens held on another chain can't pay it.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                // The deposit rides a DEPOSIT action, which moves tokens only.
                kindFilter="tokens"
                kindLocked
                title={t('execute.tokenToDeposit')}
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setDepositTick(String(sel.tick || '').toUpperCase());
                    setTokenPickerOpen(false);
                    setFormError(null);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // The Contract field's list icon: the contracts list, rendered in place
    // of the form; opening a contract makes it the one this form calls.
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
                title={t('send.fromAddress')}
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Reveal keys and closed summaries of the standard sections.
    const sectionErrorKey = (section) => (formError && formErrorSection === section && reviewAttempt > 0 ? reviewAttempt : 0);
    const callSummary = method.trim()
        ? `${method.trim()}(${paramsArray.join(', ')})`
        : 'No method yet';
    const depositSummary = depositTick
        ? (depositQuantity.trim() ? `${depositQuantity.trim()} ${depositTick.toUpperCase()}` : depositTick.toUpperCase())
        : t('execute.noDeposit');

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={t('execute.callContract')}
            lead={<OwnerWithdrawWarning ownerWithdraw={ownerWithdraw} />}
            onSubmit={handleReview}
            noValidate
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    icon={<Icon.ContractIcon />}
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing || !abiActive}
                >
                    {t('execute.callContract')}
                </FormAction>
            )}
            from={(
                /* The target contract pins the network, so From shows
                   it locked; the caller is the From address. */
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={[chainId]}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={t('execute.networkHelp')}
                    address={fromAddress?.address || null}
                    addressLabel={t('execute.caller')}
                    addressHelp={t('execute.callerHelp')}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel={t('send.source.choose')}
                    revealKey={sectionErrorKey('from')}
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
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        children: <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} unverified />,
                    }}
                />
            )}
        >
            {/* The main section holds the method and its arguments;
                the owner-withdraw warning leads the form, above From. */}
            <FormSection
                id="call"
                // "Method", so the header never reads as the Call action.
                title={t('execute.method')}
                icon={Icon.ContractIcon}
                {...formSections.bind('call')}
                revealKey={sectionErrorKey('call')}
                summary={callSummary}
            >
            <TargetField
                label={t('execute.contract')}
                help={t('execute.contractHelp')}
                name={contractFieldName(contractRow)}
                detail={`#${contractActionIndex}`}
                onPick={contractTarget.openPicker}
                pickLabel={t('execute.pickContract')}
            />
            {abiActive ? (
                <>
                    {linkError ? <StatusMessage variant="error">{linkError}</StatusMessage> : null}
                    <Select
                        label={t('execute.method')}
                        help={(abiSpec ? [abiSpec.summary, abiSpec.view ? '(declared read-only)' : null].filter(Boolean).join(' ') : '') || t(
                            'execute.methodHelp'
                        )}
                        value={method}
                        onChange={(e) => e.target.value && selectAbiMethod(e.target.value)}
                    >
                        {method === '' ? <Select.Option value="" icon={<Icon.ListIcon />}>{t('execute.chooseMethod')}</Select.Option> : null}
                        {Object.keys(contractAbi.methods).map((name) => (
                            <Select.Option key={name} value={name} icon={<Icon.ContractIcon />}>{name}</Select.Option>
                        ))}
                    </Select>
                    {abiParams.map((p, i) => (
                        <div key={`${method}:${p.name}`} className={contractStyles.abiField}>
                            <Input
                                label={`${p.name} (${p.type})`}
                                help={p.description || p.summary || t('execute.paramHelp', { name: p.name, type: p.type })}
                                placeholder={abiPlaceholder(p.type)}
                                inputMode={p.type === 'number' || p.type === 'amount' ? 'decimal' : undefined}
                                value={abiParamValues[i] || ''}
                                onChange={(e) => setAbiParam(i, e.target.value)}
                                error={abiParamValues[i] ? abiArgumentErrors[i] || undefined : undefined}
                                className={contractStyles.monospaceInput}
                                autoComplete="off"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                        </div>
                    ))}
                </>
            ) : abiStatus === 'error' ? (
                <StatusMessage
                    variant="error"
                    recovery={{
                        label: t('common.tryAgain'),
                        onAction: () => setAbiAttempt((n) => n + 1),
                    }}
                >
                    {abiLoadError}
                </StatusMessage>
            ) : (
                <p>{t('execute.methodsLoading')}</p>
            )}
            </FormSection>

            {/* The optional deposit sent ahead of the call is its own
                closed Optional section; the Token field drops its own tag. */}
            <FormSection
                id="deposit"
                title={t('execute.deposit')}
                icon={Icon.CoinsIcon}
                optional
                {...formSections.bind('deposit')}
                revealKey={sectionErrorKey('deposit')}
                summary={depositSummary}
            >
            <TokenField
                label={t('execute.tokenLabel')}
                help={t('execute.depositTokenHelp')}
                value={depositTick && chainId ? { chainId, tick: depositTick } : null}
                placeholder={t('execute.noDeposit')}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />
            {depositTick ? (
                <>
                    <AmountField
                        label={t('execute.depositAmount')}
                        help={t('execute.depositHint', {
                            contract: contractActionIndex,
                            chain: t('send.rbf.thisChain'),
                        })}
                        amount={depositQuantity}
                        tick={depositTick}
                        divisibility={depositDivisibility}
                        onAmountFieldChange={(rawValue) => {
                            const stripped = String(rawValue).replace(/,/g, '');
                            if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                            setDepositQuantity(stripped);
                            setFormError(null);
                        }}
                        onMax={depositBalance && Number(depositBalance) > 0
                            ? () => setDepositQuantity(depositBalance)
                            : undefined}
                        maxDisabled={!depositBalance}
                        balanceText={depositBalance != null
                            ? t('execute.balanceAvailable', {
                                amount: formatWithThousands(depositBalance),
                                tick: depositTick.toUpperCase(),
                            })
                            : null}
                    />
                    <Button
                        type="button"
                        variant="danger"
                        icon={<Icon.TrashIcon />}
                        onClick={() => { setDepositTick(''); setDepositQuantity(''); setFormError(null); }}
                    >
                        {t('execute.removeDeposit')}
                    </Button>
                </>
            ) : null}
            </FormSection>
        </FormFrame>,
    );
}
