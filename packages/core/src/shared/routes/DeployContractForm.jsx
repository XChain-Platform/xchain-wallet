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
import { t } from '../../i18n/index.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Network, From and the fee selector render inside the standard
// FromSection and FeeSection.
import { Button, ChainBadge, FieldIconButton, FieldNote, FormNotice, FormPage, Icon, InfoTip, Input, ListPage, PageHeader, Screen, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/components.js';
import { normalizeConstructorParams } from '../../flows/deployChunked.js';
import { DEPLOY_ARGUMENT_WORDS, deployActionFit, variadicSizeMessage } from '../../flows/variadicActionSize.js';
import { indexerWaitMessage } from '../../flows/deployLegWait.js';
import { normalizeMetaRead, CONTRACT_META_REQUIRED } from '../../flows/contractMetaPreflight.js';
import { neutralizeControlText, revealHiddenText } from '../utils/textHardening.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { isHwSignBack } from '../../signers/hardwareSession.js';
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
import { humanizeDeployDiagnostic, humanizeGasRationale } from '../utils/deployDiagnostic.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import contractStyles from './ContractScreens.module.css';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { formatBytes } from '../utils/formatBytes.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
import { sumDecimalStrings, trimAmountTail } from '../utils/amountFormat.js';
// Publish contract is laid out on the Wallet Form Standard frame.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    useFormSections,
} from '../components/formStandard/index.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

/** Why a resumed publish's gas, constructor and staking fields cannot be edited. */
const RESUME_FIELD_HINT = 'Fixed when this publish started. Discard it to change this.';

/** How often a running chunked deploy's record is re-read for an indexer wait. */
const INDEXER_WAIT_POLL_MS = 5000;

/** How long typing must pause before the code source is checked. */
const CODE_CHECK_DELAY_MS = 500;

/**
 * The protocol's code size limit in bytes (the SDK's MAX_CODE_SIZE), used
 * until the SDK's own size answer, which carries the limit, comes back.
 */
const DEFAULT_CODE_SIZE_LIMIT = 65536;

const utf8 = new TextEncoder();

// Sizes read through the shared formatBytes: the source rounds up, the
// limit rounds down, so a source just over the limit never reads as under it.

// Which chains this form may deploy on, asked of the LIVE registry inside the
// component (useSupportedChains, filtered on supportedActions.includes('DEPLOY'))
// instead of pinned to a coin here or snapshotted at import. The gate has ONE
// home, the descriptor's supportedActions as registry/actions.js builds it:
// DEPLOY sits in COMMON_ACTIONS today, so the registry advertises it on all
// nine bundled chains (BTC / LTC / DOGE x mainnet / testnet / regtest), and a
// second hard-coded copy in this form would silently disagree the next time
// that list moves. Same descriptor-driven pattern as StakingList and
// BetFeedsList.

/** Coin ids read as 'bitcoin'; users read "Bitcoin". */
function coinLabel(c) {
    return String(c).charAt(0).toUpperCase() + String(c).slice(1);
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}

function diagnosticLocation(value, message) {
    const object = value && typeof value === 'object' ? value : {};
    const location = object.location?.start || object.loc?.start || object.location || object.loc || {};
    let line = positiveInteger(object.line ?? location.line);
    let column = nonNegativeInteger(object.column ?? object.col ?? location.column);
    if (!line) {
        const words = message.match(/\bline\s+(\d+)(?:\D+column\s+(\d+))?/i);
        const parser = message.match(/\((\d+):(\d+)\)/);
        line = positiveInteger(words?.[1] ?? parser?.[1]);
        column = column ?? nonNegativeInteger(words?.[2] ?? parser?.[2]);
    }
    return { line, column };
}

function normalizeValidationDiagnostics(value) {
    const entries = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return entries.map((entry) => {
        const object = entry && typeof entry === 'object' ? entry : {};
        const message = humanizeDeployDiagnostic(entry).message;
        const { line, column } = diagnosticLocation(entry, message);
        const identifier = object.ruleId || object.rule || object.code || null;
        const identifierLabel = object.ruleId || object.rule ? 'Rule' : (object.code ? 'Code' : null);
        return { message, line, column, identifier, identifierLabel };
    }).filter((entry) => entry.message);
}

/**
 * Chunk transactions of an unfinished publish that are already sent, counted on
 * the txid as well as the action_index: the index is written after the indexer
 * answers, the txid at broadcast.
 */
function sentChunkCount(record) {
    return (record.chunks || []).filter((c) => c.actionIndex || c.txid).length;
}

function countLabel(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * DEPLOY authoring form: §42.6.
 *
 * Surface:
 *
 *   Contract identity:  Name / Version / Description, READ-ONLY, parsed
 *                       from the pasted source
 *   Code source:        [ textarea (multi-line JS) ]
 *   Gas limit:          [ input, auto-suggested ]
 *   Constructor params: [ pipe-delimited ]
 *
 *   About 500 ms after typing stops in Code source, the form checks the code
 *   by itself, with no buttons:
 *     validation   sdk.validateContract (legacy: sdk.contracts.validate)
 *     size         sdk.contracts.checkCodeSize
 *     gas          sdk.contracts.suggestGasLimit, once the code is valid; it
 *                  fills Gas limit unless the user typed their own value, and
 *                  the icon in the Gas limit field puts it back.
 *
 *   [Preview] [Sign]
 *
 * The spec calls for Monaco for JavaScript authoring; Phase 4 Step 4
 * ships a plain textarea as the minimal authoring surface, routes the
 * validate / size / suggest-gas helpers through the SDK, and defers
 * the Monaco editor integration (its bundle weight + CDN trust
 * posture need their own discussion) to a follow-up.
 *
 * Hex-encoding of the source happens inside the SDK validator chain;
 * callers pass raw UTF-8 as `params.CODE`. GAS_LIMIT is a decimal
 * string per the protocol. CONSTRUCTOR_PARAMS is optional.
 *
 * THE NAME FIELD IS GONE. It used to be a device-local label, because no
 * DEPLOY version carries a NAME slot on the wire; under
 * CONTRACT_META_REQUIRED a contract's name, description and version are an
 * export of its own source, so asking the user to type one would invite them
 * to name a contract something the chain will not record. The form instead
 * shows what the chain is about to record, read-only, parsed out of the
 * pasted source by `sdk.contracts.getExportedMeta` through the messaging
 * layer.
 *
 * FEATURE-DETECTED BY RESULT SHAPE. The published SDK the wallet pins today
 * predates the check, and a shell may not relay it at all, so the panel shows
 * NOTHING rather than a stale or invented label unless a real answer comes
 * back. `normalizeMetaRead` is the same check the deploy flows apply
 * host-side; a `typeof` probe would pass against the web dev-shell's Proxy
 * mock, which answers every `get*` name.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DeployContractForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const supportedChains = useSupportedChains(chainRegistry);
    const deployChains = useMemo(
        () => supportedChains.filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes('DEPLOY')),
        [supportedChains],
    );
    const deployChainIds = useMemo(() => deployChains.map((d) => d.id), [deployChains]);
    const deployChainCoins = useMemo(
        () => [...new Set(deployChains.map((d) => d.coin))].map(coinLabel),
        [deployChains],
    );

    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    const [code, setCode] = useState('');
    const [gasLimit, setGasLimit] = useState('');
    const [constructorParams, setConstructorParams] = useState('');
    // DEPLOY v1: optional staking config. Leaving cooldownBlocks blank deploys a
    // non-stakeable contract (DEPLOY v0 behavior). Setting it opts into contract-staking;
    // slashDestination defaults to 'BURN' when cooldown is set but destination is blank.
    const [cooldownBlocks, setCooldownBlocks] = useState('');
    const [slashDestination, setSlashDestination] = useState('');
    const [password, setPassword] = useState('');

    const [validation, setValidation] = useState(
        /** @type {{ ok: boolean, msg: string, warnings: object[], errors: object[] } | null} */ (null),
    );
    const codeRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
    const latestCodeRef = useRef(code);
    latestCodeRef.current = code;
    const validationRequestRef = useRef(0);
    const sizeRequestRef = useRef(0);
    const gasRequestRef = useRef(0);
    // True while Gas limit holds a value the user typed (or a resumed run
    // restored), which the automatic suggestion never overwrites.
    const gasTypedRef = useRef(false);
    const [sizeInfo, setSizeInfo] = useState(
        /** @type {{ bytes: number, withinLimit: boolean, limit?: number } | null} */ (null),
    );
    // Size of the source as the network counts it (UTF-8 bytes), live while
    // typing; the SDK's answer replaces it once the check has run.
    const localCodeBytes = useMemo(() => utf8.encode(code).length, [code]);
    const codeBytes = sizeInfo ? sizeInfo.bytes : localCodeBytes;
    const codeSizeLimit = sizeInfo && Number.isFinite(sizeInfo.limit) && sizeInfo.limit > 0
        ? sizeInfo.limit
        : DEFAULT_CODE_SIZE_LIMIT;
    const codeOverLimit = codeBytes > codeSizeLimit || sizeInfo?.withinLimit === false;
    const [suggestedGas, setSuggestedGas] = useState(/** @type {number | null} */ (null));
    // The one gas value the form checks, plans with and composes: the typed
    // field with its spaces trimmed, else the suggestion. Validating one string
    // and sending another let " 250000 " pass review and reach the encoder padded.
    const effectiveGasLimit = String(gasLimit).trim() || (suggestedGas ? String(suggestedGas) : '');
    const [suggestedRationale, setSuggestedRationale] = useState(/** @type {string | null} */ (null));
    // The contract's own identity, as the SDK reads it out of the pasted
    // source. Null means "no answer" (an SDK or a shell without the check), and
    // renders nothing at all rather than a guess.
    const [metaRead, setMetaRead] = useState(
        /** @type {{ status: string, name?: string, description?: string, version?: string, computed?: string[] } | null} */ (null),
    );
    const metaAbsent = metaRead?.status === 'absent';

    // PC-38: the SDK's audited template library. Sync + no network host-side,
    // so this is a cheap one-shot load per chain.
    const [templates, setTemplates] = useState(
        /** @type {{ templates: string[], patterns: string[] } | null} */ (null),
    );
    // PC-38: single-shot vs chunked. A contract past one action's capacity
    // deploys as N carrier transactions plus an assembling one, each with its
    // own fee, so the user sees the shape BEFORE signing anything.
    const [plan, setPlan] = useState(
        /** @type {{ single: boolean, totalChunks: number, codeHash: string } | null} */ (null),
    );
    const [planError, setPlanError] = useState(/** @type {string | null} */ (null));
    // PC-38: chunk-by-chunk progress for the multi-leg run.
    const [chunkProgress, setChunkProgress] = useState(
        /** @type {{ done: number, total: number, phase: string } | null} */ (null),
    );
    // The leg a running chunked deploy is waiting on the indexer for, as the
    // run notes it on its pendingDeploy record; null while nothing is waiting.
    const [indexerWait, setIndexerWait] = useState(
        /** @type {{ leg: number|null, total: number, chainState: string } | null} */ (null),
    );
    // PC-38: interrupted runs whose chunks are already paid for on chain.
    const [resumable, setResumable] = useState(/** @type {any[]} */ ([]));
    const [resumeId, setResumeId] = useState(/** @type {string | null} */ (null));
    // The id of the resumed run whose phase-2 fields came from its own record.
    // The flow assembles from that record, so while it is the run being
    // resumed those fields are fixed: an edit would change the review and not
    // the transaction.
    const [resumeFieldsFrom, setResumeFieldsFrom] = useState(/** @type {string | null} */ (null));
    const assembleLocked = resumeId !== null && resumeId === resumeFieldsFrom;
    // Read by the automatic gas fill, which runs after an await.
    const assembleLockedRef = useRef(assembleLocked);
    assembleLockedRef.current = assembleLocked;

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // The standard section a Publish refusal belongs to, and a counter
    // bumped on every attempt, so that section reopens each time.
    const [formErrorSection, setFormErrorSection] = useState(/** @type {string | null} */ (null));
    const [reviewAttempt, setReviewAttempt] = useState(0);
    // Open state held above the picker and review early returns.
    // From starts closed, Contract open, the rest closed.
    const formSections = useFormSections({ from: false, contract: true, constructor: false, staking: false, fee: false });
    const failIn = (section, message) => {
        setFormError(message);
        setFormErrorSection(section);
    };
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [toolBusy, setToolBusy] = useState(/** @type {string | null} */ (null));
    const confirmDialog = useConfirmModal();
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);

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
                setActiveByChain(active || {});
                const firstDeployable = deployChainIds.find(
                    (cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0,
                );
                if (!firstDeployable) {
                    // Names the chains the registry actually allows, so the
                    // sentence stays true the day that list grows.
                    const where = deployChainCoins.join(' or ');
                    setLoadError(
                        `Contracts can only be published on ${where}. Use Receive on one of those `
                        + 'networks to generate an address before publishing.',
                    );
                    return;
                }
                setChainId(firstDeployable);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, deployChainIds, deployChainCoins]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        // Deploy from the chain's active address (else newest HD external),
        // matching Send.
        setFromAddressId(preferredSourceId(addressesByChain[chainId] || [], activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = protocolCoinTickerFor(descriptor || chainId);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // DEPLOY is fee-bearing, and this form had no fee lane at all
    // because BTC could always settle the protocol fee from an XCHAIN balance.
    // On every other protocol coin there is no XCHAIN lane, so the hook forces
    // the native output on rather than offering a choice that does not exist.
    // The quote behind it is that schedule price, which carries no verdict
    // (`valid:null`), hence `unverified` on the row: the amount is exact, the
    // acceptance is not pre-judged, and the fee is spent either way.
    const nativeFee = useNativeFee(chainId);
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

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

    const deployChainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return deployChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0);
    }, [deployChainIds, addressesByChain]);

    const isHwSource = isDeviceAddressSource(fromAddress?.source);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const hasCooldown = cooldownBlocks.trim() !== '';
        const p = {
            // Bump to v1 when the user opts into contract-staking metadata; otherwise stay on v0.
            VERSION: hasCooldown ? '1' : '0',
            CODE: code,
            GAS_LIMIT: effectiveGasLimit,
        };
        // PC-38: CONSTRUCTOR_PARAMS is a REST field on the non-stakeable
        // formats (`...CONSTRUCTOR_PARAMS` on v0/v2), so the wire wants the
        // ARRAY and emits one segment per entry. Sending the raw pipe-delimited
        // STRING made the SDK reject every multi-argument constructor
        // ("CONSTRUCTOR_PARAMS[0] cannot contain pipe"), i.e. this form could
        // not deploy a contract taking more than one argument. The stakeable
        // formats (v1/v3) carry ONE plain field instead and accept a single
        // entry, so they keep the scalar.
        const ctorParts = normalizeConstructorParams(constructorParams);
        if (ctorParts.length > 0) {
            p.CONSTRUCTOR_PARAMS = hasCooldown ? ctorParts[0] : ctorParts;
        }
        if (hasCooldown) {
            p.COOLDOWN_BLOCKS = /^\d+$/.test(cooldownBlocks.trim()) ? String(Number(cooldownBlocks.trim())) : cooldownBlocks.trim();
            // Default to BURN if cooldown is set but destination is blank; the indexer
            // applies the same default, but surfacing it here makes review honest.
            p.SLASH_DESTINATION = slashDestination.trim() || 'BURN';
        }
        return p;
    }, [code, effectiveGasLimit, constructorParams, cooldownBlocks, slashDestination]);

    const deployQuoteActionData = useMemo(() => {
        if (!fromAddress?.address || !chainId || !code.trim()) return null;
        if (!/^\d+$/.test(effectiveGasLimit) || !/[1-9]/.test(effectiveGasLimit)) return null;
        if (validation?.ok === false || metaAbsent) return null;
        const cooldownText = cooldownBlocks.trim();
        if (cooldownText) {
            const cooldown = Number(cooldownText);
            if (!/^\d+$/.test(cooldownText) || !Number.isInteger(cooldown)
                || cooldown < 1 || cooldown > 100000) return null;
        } else if (slashDestination.trim()) {
            return null;
        }
        const slashTo = slashDestination.trim();
        if (slashTo && slashTo !== 'BURN' && (!descriptor?.coin || !descriptor?.networkKind
            || !isValidAddressForChain(slashTo, descriptor.coin, descriptor.networkKind))) return null;
        const constructorParts = String(constructorParams).split('|').map((part) => part.trim());
        if (constructorParams.trim() && constructorParts.some((part) => part === '')) return null;
        if (constructorParts.some((part) => part.includes(';'))) return null;
        if (cooldownText && constructorParts.filter(Boolean).length > 1) return null;
        if (!cooldownText && variadicSizeMessage(deployActionFit({
            code,
            gasLimit: effectiveGasLimit,
            constructorParams: normalizeConstructorParams(constructorParams),
        }), DEPLOY_ARGUMENT_WORDS)) return null;
        return { action: 'DEPLOY', params: actionParams };
    }, [fromAddress?.address, chainId, code, effectiveGasLimit, validation?.ok, metaAbsent,
        cooldownBlocks, slashDestination, descriptor, constructorParams, actionParams]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: deployQuoteActionData,
    });
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyDecoded = useMemo(() => ({
        summary: t('components.confirmSummary.verbDeployContract'),
        details: [],
        warnings: [
            ...(nativeFee.payFeeInNativeCoin ? [NATIVE_FEE_WARNING, NATIVE_FEE_UNVERIFIED_NOTICE] : []),
            ...((validation?.warnings || []).map((warning) => humanizeDeployDiagnostic(warning).message)),
        ],
    }), [nativeFee.payFeeInNativeCoin, validation?.warnings]);
    const legacyComposed = useMemo(() => ({
        action: 'DEPLOY',
        chainId,
        decoded: legacyDecoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    }), [chainId, legacyDecoded, protocolFeeQuote, quotedProtocolFee.free, quotedProtocolFee.known]);
    const deployNetworkFeeAmount = useMemo(() => {
        if (!feeEstimate?.coinAmount) return null;
        const transactionCount = plan && plan.single === false ? plan.totalChunks + 1 : 1;
        return trimAmountTail(sumDecimalStrings(
            new Array(transactionCount).fill(String(feeEstimate.coinAmount)),
        ));
    }, [feeEstimate?.coinAmount, plan]);

    // PC-38: load the template list + any resumable run once the chain is known.
    useEffect(() => {
        let cancelled = false;
        if (!chainId) return undefined;
        if (typeof messaging.listContractTemplates === 'function') {
            messaging.listContractTemplates({ chainId })
                .then((t) => { if (!cancelled) setTemplates(t); })
                .catch(() => { if (!cancelled) setTemplates(null); });
        }
        if (typeof messaging.listPendingDeploys === 'function') {
            messaging.listPendingDeploys({ walletId })
                .then((rows) => {
                    if (cancelled) return;
                    setResumable((rows || []).filter((r) => r.stage !== 'done' && r.chainId === chainId));
                })
                .catch(() => { if (!cancelled) setResumable([]); });
        }
        return () => { cancelled = true; };
    }, [messaging, chainId, walletId]);

    // While a chunked run is in flight, read the run's own record for a leg
    // that is on chain but not yet indexed. The run lives in the host and
    // sends no progress events, so its pendingDeploy record is the only
    // place that state is visible from here.
    const chunkRunActive = stage === 'submitting' && chunkProgress !== null;
    const planHash = plan ? plan.codeHash : null;
    useEffect(() => {
        setIndexerWait(null);
        if (!chunkRunActive || typeof messaging.listPendingDeploys !== 'function') return undefined;
        let cancelled = false;
        const read = () => {
            messaging.listPendingDeploys({ walletId })
                .then((rows) => {
                    if (cancelled) return;
                    const run = (rows || []).find((r) => r && r.stage !== 'done' && r.chainId === chainId
                        && (resumeId ? r.id === resumeId : r.codeHash === planHash));
                    setIndexerWait(run && run.indexerWait ? run.indexerWait : null);
                })
                .catch(() => {});
        };
        read();
        const timer = setInterval(read, INDEXER_WAIT_POLL_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [chunkRunActive, messaging, walletId, chainId, resumeId, planHash]);

    // PC-38: re-plan whenever the source or the fields that share the action's
    // byte budget change. The plan is what decides which submit lane runs.
    useEffect(() => {
        let cancelled = false;
        setPlan(null);
        setPlanError(null);
        if (!chainId || !code.trim()) return undefined;
        if (typeof messaging.planDeploy !== 'function') return undefined;
        messaging.planDeploy({
            chainId,
            code,
            gasLimit: effectiveGasLimit,
            constructorParams: constructorParams.trim() || undefined,
            ...(actionParams.COOLDOWN_BLOCKS ? {
                cooldownBlocks: actionParams.COOLDOWN_BLOCKS,
                slashDestination: actionParams.SLASH_DESTINATION,
            } : {}),
        })
            .then((p) => { if (!cancelled) setPlan(p); })
            // The planner reports an over-budget contract as
            // "…exceeds MAX_DEPLOY_CHUNKS (16)"; deployDiagnostic restates the
            // SDK constant as a limit the author can act on.
            .catch((e) => { if (!cancelled) setPlanError(humanizeDeployDiagnostic(e).message || 'Could not size this contract.'); });
        return () => { cancelled = true; };
    }, [messaging, chainId, code, effectiveGasLimit, constructorParams, actionParams]);

    // Re-read the contract's identity whenever the source changes. Static and
    // host-side (an acorn walk, no network), so it rides the same edit cadence
    // as the deploy plan above rather than waiting for a button.
    useEffect(() => {
        let cancelled = false;
        setMetaRead(null);
        if (!chainId || !code.trim()) return undefined;
        if (typeof messaging.getContractExportedMeta !== 'function') return undefined;
        messaging.getContractExportedMeta({ chainId, code })
            // The shape check, not the call, is what decides whether there is an
            // answer here: a shell relaying a mock returns something for every
            // method name.
            .then((res) => { if (!cancelled) setMetaRead(normalizeMetaRead(res)); })
            .catch(() => { if (!cancelled) setMetaRead(null); });
        return () => { cancelled = true; };
    }, [messaging, chainId, code]);

    // Validate, size and suggest gas by themselves once typing pauses. A new
    // edit (or a chain switch) clears the pending run and bumps the request
    // counters, so an answer about older code is dropped when it lands.
    useEffect(() => {
        if (!chainId || !code.trim()) return undefined;
        const timer = setTimeout(() => { runCodeChecks(); }, CODE_CHECK_DELAY_MS);
        return () => {
            clearTimeout(timer);
            validationRequestRef.current += 1;
            sizeRequestRef.current += 1;
            gasRequestRef.current += 1;
        };
        // runCodeChecks reads this render's code and chain, the two deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chainId, code]);

    // What the chain will record, hardened for display: these are strings out
    // of a source the user may have pasted from anywhere, rendered on a
    // signing-adjacent screen.
    const metaName = metaRead?.status === 'present'
        ? neutralizeControlText(metaRead.name, { maxLength: 64 }) : '';
    const metaVersion = metaRead?.status === 'present'
        ? neutralizeControlText(metaRead.version, { maxLength: 32 }) : '';
    const metaDescription = metaRead?.status === 'present'
        ? neutralizeControlText(metaRead.description, { maxLength: 512 }) : '';
    // Proven absent: the chain refuses this deploy, so the form does too,
    // before anything is composed and therefore before any fee is spent. An
    // `undecidable` read (a computed meta) never refuses; the chain may accept
    // it, and refusing would block a legal deploy.
    async function handleUseTemplate(templateName) {
        if (!chainId || toolBusy) return;
        setToolBusy(`template:${templateName}`);
        setFormError(null);
        try {
            const { code: src } = await messaging.scaffoldContract({ chainId, name: templateName });
            setCode(src);
            setValidation(null);
            setSizeInfo(null);
        } catch (e) {
            setFormError(userFacingMessage(e, `Could not load the "${templateName}" template.`));
        } finally {
            setToolBusy(null);
        }
    }

    // The automatic checks, run once typing pauses. Size and validation run
    // side by side; gas is only suggested for code that validated.
    async function runCodeChecks() {
        handleCheckSize();
        if (await handleValidate()) await handleSuggestGas();
    }

    /** Validates this render's source; resolves true only when it is valid and still current. */
    async function handleValidate() {
        if (!chainId) return false;
        const source = code;
        const request = ++validationRequestRef.current;
        try {
            const res = await messaging.validateContractCode({ chainId, code: source });
            if (validationRequestRef.current !== request || latestCodeRef.current !== source) return false;
            // No yes-or-no answer (a shell relaying a mock answers every
            // method with {}) is no verdict, so it neither passes nor blocks.
            if (typeof res?.valid !== 'boolean') {
                setValidation(null);
                return false;
            }
            const warnings = normalizeValidationDiagnostics(res?.warnings);
            if (res.valid) {
                setValidation({ ok: true, msg: 'Valid', warnings, errors: [] });
                return true;
            } else {
                const rawErrors = Array.isArray(res?.errors) && res.errors.length > 0
                    ? res.errors
                    : res?.error;
                setValidation({
                    ok: false,
                    msg: 'Validation failed.',
                    warnings,
                    errors: normalizeValidationDiagnostics(rawErrors),
                });
                return false;
            }
        } catch (e) {
            if (validationRequestRef.current !== request || latestCodeRef.current !== source) return false;
            setValidation({
                ok: false,
                msg: 'Validation failed.',
                warnings: [],
                errors: normalizeValidationDiagnostics(e),
            });
            return false;
        }
    }

    function moveToCodeLine(line) {
        const textarea = codeRef.current;
        if (!textarea || !line) return;
        let offset = 0;
        for (let current = 1; current < line; current += 1) {
            const newline = code.indexOf('\n', offset);
            if (newline < 0) break;
            offset = newline + 1;
        }
        textarea.focus();
        textarea.setSelectionRange(offset, offset);
    }

    // The one status line under Code source once the checks have answered:
    // "Valid, 2.4 KB of 64 KB", the size refusal, or the first error with its
    // line (a link that puts the cursor there). Nothing while the box is empty
    // or the checks have not run yet.
    function renderCodeStatus() {
        if (!code.trim() || (!validation && !sizeInfo)) return null;
        const size = `${formatBytes(codeBytes)} of ${formatBytes(codeSizeLimit, { limit: true })}`;
        /** @type {{ tone: 'success' | 'error', text: string, line?: number | null } | null} */
        let status = null;
        if (codeOverLimit) {
            status = { tone: 'error', text: `Too large, ${size}` };
        } else if (validation && !validation.ok) {
            const first = validation.errors[0];
            const more = validation.errors.length > 1 ? ` (${countLabel(validation.errors.length - 1, 'more error')})` : '';
            status = first
                ? { tone: 'error', text: `${first.line ? `Line ${first.line}: ` : ''}${first.message}${more}`, line: first.line }
                : { tone: 'error', text: validation.msg };
        } else if (validation && validation.ok) {
            const warned = validation.warnings.length > 0 ? ` (${countLabel(validation.warnings.length, 'warning')})` : '';
            status = { tone: 'success', text: `Valid, ${size}${warned}` };
        }
        if (!status) return null;
        return (
            <FieldNote variant={status.tone} testId="deploy-code-status">
                {status.line ? (
                    <Button
                        type="button"
                        className={styles.validationLink}
                        icon={<Icon.ArrowRightIcon />}
                        onClick={() => moveToCodeLine(status.line)}
                    >
                        {/* A diagnostic sentence from the validator, not a
                            Title Case label, as in the warnings list. */}
                        <span className={styles.validationMessage}>{status.text}</span>
                    </Button>
                ) : status.text}
            </FieldNote>
        );
    }

    // The list of diagnostics alone, so the failing summary and its errors can
    // share one error box instead of stacking two.
    function renderDiagnosticList(entries, kind) {
        return (
            <ul aria-label={`Validation ${kind}s`}>
                {entries.map((entry, index) => {
                    const meta = [
                        entry.line ? `Line ${entry.line}` : null,
                        entry.column !== null ? `Column ${entry.column}` : null,
                        entry.identifier ? `${entry.identifierLabel} ${entry.identifier}` : null,
                    ].filter(Boolean).join(', ');
                    const content = (
                        <>
                            <span className={styles.validationMessage}>{entry.message}</span>
                            {meta ? <span className={styles.validationMeta}>{meta}</span> : null}
                        </>
                    );
                    return (
                        <li key={`${entry.message}-${index}`} className={styles.validationItem}>
                            {entry.line ? (
                                <Button
                                    type="button"
                                    className={styles.validationLink}
                                    icon={<Icon.ArrowRightIcon />}
                                    onClick={() => moveToCodeLine(entry.line)}
                                >
                                    {content}
                                </Button>
                            ) : (
                                <div className={styles.validationText}>{content}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        );
    }

    function renderDiagnostics(entries, kind) {
        if (entries.length === 0) return null;
        return (
            <StatusMessage variant={kind === 'error' ? 'error' : 'warning'} role={null}>
                {renderDiagnosticList(entries, kind)}
            </StatusMessage>
        );
    }

    // The automatic checks never clear the form error first: one landing
    // after a Publish click would erase the refusal the user is reading, and
    // typing in Code source already clears it.
    async function handleCheckSize() {
        if (!chainId) return;
        const source = code;
        const request = ++sizeRequestRef.current;
        try {
            const res = await messaging.checkContractCodeSize({ chainId, code: source });
            if (sizeRequestRef.current !== request || latestCodeRef.current !== source) return;
            // Only a real byte count is an answer; anything else leaves the
            // form's own UTF-8 count in place.
            if (res && Number.isFinite(res.bytes)) setSizeInfo(res);
        } catch (e) {
            if (sizeRequestRef.current !== request || latestCodeRef.current !== source) return;
            setFormError(userFacingMessage(e, 'Size check failed.'));
        }
    }

    async function handleSuggestGas() {
        if (!chainId) return;
        const source = code;
        const request = ++gasRequestRef.current;
        try {
            // sdk.contracts.suggestGasLimit returns { suggested, rationale };
            // pull the scalar out (rendering the object crashed the form).
            const res = await messaging.suggestContractGasLimit({ chainId, code: source });
            if (gasRequestRef.current !== request || latestCodeRef.current !== source) return;
            const suggested = Number(res?.suggested);
            if (!Number.isSafeInteger(suggested) || suggested <= 0) return;
            setSuggestedGas(suggested);
            setSuggestedRationale(res.rationale || null);
            // Fill the field unless it holds the user's own value or a
            // resumed run's fixed one.
            if (!gasTypedRef.current && !assembleLockedRef.current) setGasLimit(String(suggested));
        } catch (e) {
            if (gasRequestRef.current !== request || latestCodeRef.current !== source) return;
            setFormError(userFacingMessage(e, 'Gas suggestion failed.'));
        }
    }

    /** The icon in Gas limit: put the suggestion back over a typed value. */
    function handleUseSuggestedGas() {
        if (suggestedGas === null || assembleLocked) return;
        gasTypedRef.current = false;
        setGasLimit(String(suggestedGas));
        setFormError(null);
    }

    async function handleDiscardPending(id) {
        if (toolBusy) return;
        // The record is the only way back to the chunks already paid for, so
        // forgetting it is asked about first.
        const record = resumable.find((r) => r.id === id);
        const sent = record ? sentChunkCount(record) : 0;
        if (sent > 0) {
            const confirmed = await confirmDialog.confirm({
                title: 'Discard this unfinished publish?',
                message: `${sent} of ${record.totalChunks} chunk transactions are already sent and paid for. `
                    + 'Discarding forgets them, and publishing this contract again pays for every chunk again.',
                confirmLabel: 'Discard',
                danger: true,
            });
            if (!confirmed) return;
        }
        setToolBusy(`discard:${id}`);
        try {
            await messaging.clearPendingDeploy({ id });
            setResumable((rows) => rows.filter((x) => x.id !== id));
            if (resumeId === id) setResumeId(null);
        } catch (e) {
            setFormError(userFacingMessage(e, 'Could not discard the pending publish.'));
        } finally {
            setToolBusy(null);
        }
    }

    function handleReview(event) {
        event.preventDefault();
        // Each attempt may reopen the section holding the refusal;
        // failIn names it (From, Contract, Constructor, Staking or the fee).
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { failIn('fee', feeStop.formError); return; }
        if (!chainId || !fromAddress) {
            failIn('from', 'No address available to publish from on this network.');
            return;
        }
        if (!code.trim()) {
            failIn('contract', 'Contract source is required.');
            return;
        }
        if (codeOverLimit) {
            failIn('contract', `Contract source is ${formatBytes(codeBytes)}, over the ${formatBytes(codeSizeLimit, { limit: true })} limit. `
                + 'Shorten it before publishing.');
            return;
        }
        const gas = effectiveGasLimit;
        if (!/^\d+$/.test(gas) || !/[1-9]/.test(gas)) {
            failIn('contract', 'Gas limit must be a positive whole number. Tap "Use Suggested Gas" in the field for an estimate.');
            return;
        }
        if (validation?.ok === false) {
            failIn('contract', 'Fix the code error shown under Code source before publishing.');
            return;
        }
        if (metaAbsent) {
            failIn('contract', 'This contract exports no meta.name and meta.description, so the network '
                + `would reject the publication (${CONTRACT_META_REQUIRED}) after you paid for it. `
                + 'Add a meta block to the source and try again.');
            return;
        }
        if (cooldownBlocks.trim() !== '') {
            const cooldownText = cooldownBlocks.trim();
            const cb = Number(cooldownText);
            // Digits only: Number() also reads "1e3", "1.0" and "0x10" as whole
            // numbers, and the encoder is handed the text as typed.
            if (!/^\d+$/.test(cooldownText) || !Number.isInteger(cb) || cb < 1 || cb > 100000) {
                failIn('staking', 'Cooldown blocks must be an integer between 1 and 100000.');
                return;
            }
        } else if (slashDestination.trim() !== '') {
            failIn('staking', 'Slash destination requires a cooldown duration (otherwise the contract is not stakeable).');
            return;
        }
        const slashTo = slashDestination.trim();
        if (slashTo && slashTo !== 'BURN' && !isValidAddressForChain(
            slashTo,
            descriptor.coin,
            descriptor.networkKind,
        )) {
            failIn('staking', `Slash destination must be BURN or a valid address for ${descriptor.displayName || 'this network'}.`);
            return;
        }
        const constructorParts = String(constructorParams).split('|').map((part) => part.trim());
        if (constructorParams.trim() && constructorParts.some((part) => part === '')) {
            failIn('constructor', 'Constructor arguments cannot be blank between "|" separators.');
            return;
        }
        if (constructorParts.some((part) => part.includes(';'))) {
            failIn('constructor', 'Constructor arguments cannot contain ";".');
            return;
        }
        if (cooldownBlocks.trim() !== '' && constructorParts.filter(Boolean).length > 1) {
            failIn('constructor', 'A stake-enabled contract accepts one constructor argument. Pack multiple values into one argument or remove the staking settings.');
            return;
        }
        // The deploy's action ends in a repeating constructor-argument field, which
        // the wallet cannot verify once it passes 8192 compiled bytes. Refuse here,
        // before anything is composed or any chunk is paid for.
        if (cooldownBlocks.trim() === '') {
            const tooLarge = variadicSizeMessage(deployActionFit({
                code,
                gasLimit: String(gasLimit || suggestedGas || ''),
                constructorParams: normalizeConstructorParams(constructorParams),
            }), DEPLOY_ARGUMENT_WORDS);
            if (tooLarge) { failIn(constructorParams.trim() ? 'constructor' : 'contract', tooLarge); return; }
        }
        setFormError(null);
        setFormErrorSection(null);
        // The PLAN decides the lane, not just the wallet mode. `openConfirmScreen`
        // composes ONE `{ action: 'DEPLOY' }` and never consults `plan`, so routing
        // a chunked source there attempted a single-shot deploy of a source this
        // very form had just described as "N chunk transactions plus 1 assembling
        // transaction" - and the encoder refused it with "Combined compiled payload
        // (8194 bytes) exceeds maximum (8192)". That left PC-38's chunked lane
        // unreachable from BOTH sides: full mode never entered it, and watcher mode,
        // the only mode that reached `handleSubmit`, is refused inside it by design
        // because the legs must be signed one after another.
        // The review stage is the chunked lane's entry point and already renders
        // SignCredentials in full mode, so a chunked plan goes there instead.
        if (singleEncode && plan?.single !== false) { openConfirmScreen(); return; }
        setStage('review');
    }

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
        software: 'deployAction',
        hardware: 'deployActionHw',
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
                actionData: { action: 'DEPLOY', params: actionParams },
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
                fallback: userFacingMessage(err, 'Publish failed.'),
            }));
        }
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
            // PC-38: a source past one action's capacity deploys as N chunk
            // carriers plus an assembling DEPLOY. The legs are sequential by
            // consensus (each carrier must be indexed, at a lower action_index,
            // before the assembler runs), so this lane cannot be an encode-only
            // build: watcher mode is refused rather than half-served.
            if (plan && plan.single === false) {
                if (isWatcherMode) {
                    throw new Error(
                        `This contract needs ${plan.totalChunks} chunk transactions plus an assembling one, `
                        + 'each signed only after the previous is confirmed. A wallet that signs on another '
                        + 'phone cannot complete that sequence; publish it from the wallet holding the key.',
                    );
                }
                const chunkedBase = {
                    walletId,
                    chainId,
                    from: base.from,
                    code,
                    gasLimit: effectiveGasLimit,
                    // No name is passed: the flow labels the run with the
                    // contract's own `meta.name`, read off the same source.
                    constructorParams: constructorParams.trim() || undefined,
                    cooldownBlocks: cooldownBlocks.trim() || undefined,
                    slashDestination: slashDestination.trim() || undefined,
                    // Every leg of a chunked run is its own priced DEPLOY, so the
                    // flag rides the whole run rather than the assembler alone.
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    ...(resumeId ? { resumeId } : {}),
                };
                setChunkProgress({ done: 0, total: plan.totalChunks, phase: 'chunking' });
                res = isHwSource
                    ? await messaging.deployChunkedHw({ ...chunkedBase, signerId: fromAddress.signerId })
                    : await messaging.deployChunked({ ...chunkedBase, password });
                setChunkProgress(null);
                setResumeId(null);
            } else if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'DEPLOY', params: actionParams },
                    // The watcher lane builds the PSBT the signer wallet will
                    // sign blind, so the fee output has to be in it here.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.deployActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.deployAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            // Back on the hardware sign page returns to this review with no
            // error. Chunks signed before it stay paid for, so the resume
            // list below is still refreshed.
            const signBack = isHwSignBack(err);
            const isBadPassword = err?.name === 'InvalidPasswordError';
            const failure = isBadPassword
                ? 'Incorrect password.'
                : submitFailureMessage(err, {
                    chainId,
                    coinTicker,
                    mandatory: nativeFee.mandatory,
                    fallback: userFacingMessage(err, 'Publish failed.'),
                });
            setSubmitError(signBack ? null : failure);
            setChunkProgress(null);
            // PC-38: a failed chunked run leaves its record behind on purpose -
            // the chunks already on chain are paid for, so re-list so the resume
            // banner can offer to finish rather than restart.
            if (typeof messaging.listPendingDeploys === 'function') {
                messaging.listPendingDeploys({ walletId })
                    .then((rows) => setResumable((rows || []).filter((r) => r.stage !== 'done' && r.chainId === chainId)))
                    .catch(() => {});
            }
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    /**
     * Put a resumed deploy's phase-2 fields back on screen.
     *
     * The flow assembles from `record.assembleParams`, so the form must show the
     * same values or the review screen describes a different transaction than
     * the one being signed. Tolerant of an older record with no stored params:
     * it leaves the fields alone rather than clearing them.
     */
    function restoreAssembleFields(assembleParams) {
        if (!assembleParams || typeof assembleParams !== 'object') return;
        // Every field is set, a blank for one the record does not carry, so the
        // form shows exactly the plan the run will assemble and nothing typed
        // before Resume survives beside it.
        setGasLimit(assembleParams.GAS_LIMIT ? String(assembleParams.GAS_LIMIT) : '');
        // The run's own gas counts as typed: a suggestion never replaces it.
        gasTypedRef.current = Boolean(assembleParams.GAS_LIMIT);
        const ctor = assembleParams.CONSTRUCTOR_PARAMS;
        // v2 stores the REST field as an array, v3 as a single value; the
        // form collects both as one pipe-delimited string.
        setConstructorParams(ctor === undefined || ctor === null ? '' : (Array.isArray(ctor) ? ctor.join('|') : String(ctor)));
        setCooldownBlocks(assembleParams.COOLDOWN_BLOCKS ? String(assembleParams.COOLDOWN_BLOCKS) : '');
        // The form's convention is that a BLANK destination means BURN, and the
        // wire params spell BURN out, so map it back rather than typing the
        // literal into a field whose placeholder already means it.
        setSlashDestination(assembleParams.SLASH_DESTINATION && String(assembleParams.SLASH_DESTINATION) !== 'BURN'
            ? String(assembleParams.SLASH_DESTINATION) : '');
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
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review Publish'
                    : 'Publish Contract'}
        />
    );
    // The review always opens at its top instead of inheriting how far the
    // form was scrolled; the form keeps its own position for Back.
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
    if (!addressesByChain) {
        return wrap(<ListPage><p>Loading addresses…</p></ListPage>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<ListPage><ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} /></ListPage>);
        if (result?.psbtHex && !txid) {
            return wrap(
                <ListPage>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={handleBuildAnother}
                        onDone={onBack}
                    />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <p className={styles.summary}>
                    Contract published. The transaction was broadcast; the network will record it shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'N/A')}</dd>
                    {metaName ? (
                        <>
                            <dt className={styles.detailsLabel}>Contract</dt>
                            <dd className={styles.detailsValue}>
                                {metaName}{metaVersion ? ` v${metaVersion}` : ''}
                            </dd>
                        </>
                    ) : null}
                </dl>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const constructorValue = actionParams.CONSTRUCTOR_PARAMS
            ? (Array.isArray(actionParams.CONSTRUCTOR_PARAMS)
                ? actionParams.CONSTRUCTOR_PARAMS.map((value) => revealHiddenText(value)).join(', ')
                : revealHiddenText(actionParams.CONSTRUCTOR_PARAMS))
            : '';
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
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentialsReady={isWatcherMode || (isHwSource
                    ? hwStatus === 'available'
                    : (signerReady || password.length > 0))}
                credentials={(
                    <>
                        {isWatcherMode ? (
                            <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                        ) : (
                            <SignCredentials
                                unlocked={signerReady}
                                fromAddress={fromAddress}
                                chainId={chainId}
                                password={password}
                                onPasswordChange={(value) => { setPassword(value); if (submitError) setSubmitError(null); }}
                                onStatusChange={onHwStatusChange}
                                passwordRef={passwordRef}
                                submitError={submitError}
                                disabled={stage === 'submitting'}
                                getSignerStatus={messaging.getSignerStatus}
                            />
                        )}
                        {chunkProgress ? (
                            <p className={styles.summary} role="status">
                                Publishing {chunkProgress.total} chunk transactions, then the assembling one.
                                Each waits for confirmation before the next is signed. Leave the wallet open;
                                if interrupted, you can resume without paying again for chunks already sent.
                            </p>
                        ) : null}
                        {chunkProgress && indexerWaitMessage(indexerWait) ? (
                            <p className={styles.summary} role="status" data-testid="deploy-indexer-wait">
                                {indexerWaitMessage(indexerWait)}
                            </p>
                        ) : null}
                    </>
                )}
                summary={{
                    verb: t('components.confirmSummary.verbDeployContract'),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: [
                        { label: 'Name', value: metaName || 'Unnamed contract' },
                        ...(metaVersion ? [{ label: 'Version', value: metaVersion }] : []),
                        { label: 'Code', value: formatBytes(sizeInfo ? sizeInfo.bytes : new Blob([code]).size) },
                        { label: 'Gas limit', value: actionParams.GAS_LIMIT },
                        ...(constructorValue ? [{ label: 'Constructor', value: constructorValue }] : []),
                        ...(actionParams.COOLDOWN_BLOCKS ? [
                            { label: 'Cooldown', value: `${actionParams.COOLDOWN_BLOCKS} blocks` },
                            { label: 'Slash to', value: actionParams.SLASH_DESTINATION },
                        ] : []),
                        ...(plan && plan.single === false ? [{
                            label: 'Transactions',
                            value: `${plan.totalChunks} chunks and 1 assembling transaction`,
                        }] : []),
                    ],
                    ...(!nativeFee.flag && quotedProtocolFee.known ? {
                        protocolFee: {
                            amount: quotedProtocolFee.free ? '0' : String(quotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
                }}
                networkFee={deployNetworkFeeAmount ? {
                    amount: deployNetworkFeeAmount, ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: t('components.confirmSummary.verbDeployContract'),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
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
                onChainChange={setChainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Reveal keys and closed summaries of the standard sections.
    const sectionErrorKey = (section) => (formError && formErrorSection === section && reviewAttempt > 0 ? reviewAttempt : 0);
    const contractSummary = joinSummary(
        metaName || (code.trim() ? 'Custom source' : 'No source yet'),
        effectiveGasLimit ? `gas ${effectiveGasLimit}` : null,
    );
    const stakingSummary = cooldownBlocks.trim()
        ? joinSummary(`${cooldownBlocks.trim()} blocks cooldown`, `slash to ${slashDestination.trim() || 'BURN'}`)
        : 'Off';
    const chainRecords = addressesByChain && chainId ? (addressesByChain[chainId] || []) : null;

    return wrap(
        <>
        <FormFrame
            demoGuard={demoGuard}
            label="Publish contract"
            onSubmit={handleReview}
            status={[
                formError ? <StatusMessage key="form" variant="error">{formError}</StatusMessage> : null,
                // PC-38: resume an interrupted chunked deploy. Those chunks are
                // already on chain and already paid for; restarting re-pays.
                resumable.length > 0 ? (
                    <StatusMessage key="resume" variant="warning" role={null}>
                        {resumable.map((r) => {
                            // Count a chunk as SENT on its txid, not only on
                            // its action_index. The index is written after the
                            // indexer answers; the txid at broadcast. Counting
                            // indexes alone made the banner read "0 of 2" over a
                            // run whose first chunk was on chain and paid for -
                            // measured live - which is the one number a user reads
                            // to decide between finishing and starting over.
                            // "Sent" rather than "on chain" because a broadcast that
                            // never confirmed is still only sent; the resumed run
                            // re-checks each one against the chain and re-sends
                            // whatever is genuinely missing.
                            const done = sentChunkCount(r);
                            return (
                                <div key={r.id}>
                                    <p>
                                        Unfinished publish{r.name ? ` of "${r.name}"` : ''}: {done} of{' '}
                                        {r.totalChunks} chunk transactions have already been sent. Finishing
                                        costs only the remaining ones; starting over pays for all of them again.
                                    </p>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => {
                                                setCode(r.code);
                                                setResumeId(r.id);
                                                setValidation(null);
                                                setSizeInfo(null);
                                                // Restore the rest of the plan, not just the
                                                // source. The flow assembles phase 2 from the
                                                // record, so leaving these fields blank would show a
                                                // review screen that disagrees with the transaction
                                                // about to be signed - measured: the gas field came
                                                // back empty against an original 50000. `assembleParams`
                                                // is the record's copy of exactly these values.
                                                restoreAssembleFields(r.assembleParams);
                                                setResumeFieldsFrom(r.assembleParams && typeof r.assembleParams === 'object' ? r.id : null);
                                            }}
                                        >
                                            Resume Publishing
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="danger"
                                            onClick={() => handleDiscardPending(r.id)}
                                            loading={toolBusy === `discard:${r.id}`}
                                            disabled={toolBusy !== null}
                                        >
                                            Discard
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </StatusMessage>
                ) : null,
            ]}
            action={(
                <FormAction
                    icon={<Icon.UploadIcon />}
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing}
                >
                    Publish Contract
                </FormAction>
            )}
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={deployChainsWithAddresses.length ? deployChainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={setChainId}
                    networkHelp="The chain the contract is published on. The From address, the publishing fee and the network fee are on this network."
                    address={fromAddress?.address || null}
                    addressLabel="From"
                    addressHelp="The address that publishes the contract, pays the network and publishing fees, and becomes its owner."
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                    // Only once this network's addresses are known to be
                    // empty, so the moment before the source resolves does not
                    // open From for good.
                    missing={chainRecords && chainRecords.length === 0 ? (
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
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        children: <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} unverified />,
                    }}
                />
            )}
        >
            {/* The main section holds the contract itself: its
                identity, templates, source, the helper tools and their
                results, and the gas limit. */}
            <FormSection
                id="contract"
                title="Contract"
                icon={Icon.ContractIcon}
                {...formSections.bind('contract')}
                revealKey={sectionErrorKey('contract')}
                summary={contractSummary}
            >

            {/* Contract identity, READ-ONLY, off the source below. Nothing is
                rendered when the installed SDK or this shell cannot answer:
                showing an empty "Name" row would read as "this contract has no
                name", which is a different and possibly false claim. */}
            {metaRead && metaRead.status === 'present' ? (
                <dl className={styles.detailsList} aria-label="Contract identity">
                    <dt className={styles.detailsLabel}>Name</dt>
                    <dd className={styles.detailsValue}>{metaName || '(not a string literal)'}</dd>
                    {metaVersion ? (
                        <>
                            <dt className={styles.detailsLabel}>Version</dt>
                            <dd className={styles.detailsValue}>{metaVersion}</dd>
                        </>
                    ) : null}
                    {metaDescription ? (
                        <>
                            <dt className={styles.detailsLabel}>Description</dt>
                            <dd className={styles.detailsValue}>{metaDescription}</dd>
                        </>
                    ) : null}
                </dl>
            ) : null}
            {/* A computed name ('Escrow ' + xchain.getBlockHeight()) is legal
                and the chain evaluates it at deploy, so this advises rather
                than refusing: the wallet cannot show a value it cannot read. */}
            {metaRead && metaRead.status === 'undecidable' ? (
                <p className={styles.hint}>
                    This contract&apos;s name is computed rather than written out, so it can only be
                    read once the network evaluates it during publishing.
                </p>
            ) : null}
            {metaAbsent ? (
                <FieldNote variant="error">
                    This contract exports no name or description. The network rejects publication
                    without them, so add a meta block to the source before publishing.
                </FieldNote>
            ) : null}


            {/* PC-38: the SDK ships audited scaffolds; the wallet had no path to them. */}
            {templates && (templates.templates?.length || templates.patterns?.length) ? (
                <div style={{ marginBottom: '0.75rem' }}>
                    <p className={styles.detailsLabel}>
                        Start from an audited template{' '}
                        <InfoTip aria="About templates" label="Loading a template replaces the code source below. Review and customize it before publishing." />
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {[...(templates.templates || []), ...(templates.patterns || [])].map((t) => (
                            <Button
                                key={t}
                                type="button"
                                variant="ghost"
                                // A template name is data; the label lookup would
                                // give "validation" a check icon as if it were chosen,
                                // so every template carries the contract icon.
                                icon={<Icon.ContractIcon />}
                                onClick={() => handleUseTemplate(t)}
                                loading={toolBusy === `template:${t}`}
                                disabled={toolBusy !== null}
                            >
                                {t}
                            </Button>
                        ))}
                    </div>
                </div>
            ) : null}

            <Textarea
                label="Code source"
                help="The contract's JavaScript source. It must export a name and description, and is published exactly as written."
                ref={codeRef}
                value={code}
                onChange={(e) => {
                    setCode(e.target.value);
                    setValidation(null);
                    setSizeInfo(null);
                    validationRequestRef.current += 1;
                    sizeRequestRef.current += 1;
                    gasRequestRef.current += 1;
                    setFormError(null);
                }}
                // The source size against the limit, at the header's trailing
                // edge like the memo's character count.
                counter={code ? `${formatBytes(codeBytes)} / ${formatBytes(codeSizeLimit, { limit: true })}` : undefined}
                rows={10}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                wrap="off"
                placeholder="// JavaScript contract source…"
                className={contractStyles.codeSource}
            />

            {renderCodeStatus()}
            {validation ? renderDiagnostics(validation.warnings, 'warning') : null}

            {/* PC-38: how many transactions this deploy actually costs. */}
            {planError ? (
                <FieldNote variant="error">{planError}</FieldNote>
            ) : plan && plan.single ? (
                <p className={styles.summary}>Fits in a single transaction.</p>
            ) : plan ? (
                <FieldNote variant="warning" role={null}>
                    {`Too large for one transaction: publishing requires ${plan.totalChunks} chunk `
                        + `transactions plus 1 assembling transaction (${plan.totalChunks + 1} total, `
                        + 'each paying its own network fee). They are signed one at a time, and each '
                        + 'must confirm before the next is built, so keep the wallet open until it finishes. '
                        + 'If it is interrupted you can resume without re-paying for the chunks already sent.'}
                </FieldNote>
            ) : null}

            {/* PC-38: the run is host-side and does not stream per-leg events
                back here, so this states what is happening WITHOUT claiming a
                live count it cannot know (a frozen "0 of N" would read as a
                stall). Per-leg progress is recorded in the pendingDeploy
                record, which is what the resume banner reads. */}
            {suggestedGas !== null ? (
                <p className={styles.summary}>
                    Suggested gas limit: {suggestedGas}
                    {/* Compare what submit will send (trimmed field, else the
                        suggestion), the same fallback handleReview uses. */}
                    {(String(gasLimit).trim() || String(suggestedGas)) === String(suggestedGas)
                        ? ' (applied)'
                        : ' (not applied: your gas limit is used)'}
                    {/* The SDK's rationale is a raw count dump ("… 1 indexed
                        for, charged 2x/iteration …"); restate it in plain
                        counts, keeping the raw string when the shape moves
                        upstream. */}
                    {suggestedRationale ? ` (${humanizeGasRationale(suggestedRationale) || suggestedRationale})` : ''}
                </p>
            ) : null}

            <Input
                label="Gas limit"
                help="Maximum computation allowed when deploying or calling the contract."
                hint={assembleLocked ? RESUME_FIELD_HINT : undefined}
                disabled={assembleLocked}
                inputMode="numeric"
                value={gasLimit}
                onChange={(e) => {
                    gasTypedRef.current = e.target.value.trim() !== '';
                    setGasLimit(e.target.value);
                    setFormError(null);
                }}
                fieldAction={(
                    <FieldIconButton
                        icon={<Icon.RefreshIcon />}
                        label="Use Suggested Gas"
                        onClick={handleUseSuggestedGas}
                        disabled={suggestedGas === null}
                        lockedReason={assembleLocked ? RESUME_FIELD_HINT : undefined}
                    />
                )}
                autoComplete="off"
            />
            </FormSection>

            {/* Constructor arguments and the staking settings are optional
                closed sections; the sections carry the Optional tags. */}
            <FormSection
                id="constructor"
                title="Constructor"
                icon={Icon.PencilIcon}
                optional
                {...formSections.bind('constructor')}
                revealKey={sectionErrorKey('constructor')}
                summary={constructorParams.trim() || 'None'}
            >
            <Input
                label="Constructor params"
                help="Values passed to the contract when it is created. Separate them with |."
                hint={assembleLocked ? RESUME_FIELD_HINT : undefined}
                disabled={assembleLocked}
                value={constructorParams}
                onChange={(e) => { setConstructorParams(e.target.value); setFormError(null); }}
                className={contractStyles.monospaceInput}
                autoComplete="off"
            />
            </FormSection>

            <FormSection
                id="staking"
                title="Staking"
                icon={Icon.StakeIcon}
                optional
                {...formSections.bind('staking')}
                revealKey={sectionErrorKey('staking')}
                summary={stakingSummary}
            >
            <Input
                label="Cooldown blocks"
                help="Enables contract staking and sets the blocks between unstaking and token release. Leave blank to disable staking."
                hint={assembleLocked ? RESUME_FIELD_HINT : '1–100000 blocks.'}
                disabled={assembleLocked}
                inputMode="numeric"
                value={cooldownBlocks}
                onChange={(e) => setCooldownBlocks(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Slash destination"
                help="Address that receives slashed tokens. Enter BURN or leave blank to destroy them. Cannot change after deployment."
                hint={assembleLocked ? RESUME_FIELD_HINT : undefined}
                disabled={assembleLocked}
                value={slashDestination}
                onChange={(e) => setSlashDestination(e.target.value)}
                className={contractStyles.monospaceInput}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
            />
            </FormSection>
        </FormFrame>
        {confirmDialog.request ? (
            <ConfirmModal
                {...confirmDialog.request}
                onConfirm={confirmDialog.onConfirm}
                onCancel={confirmDialog.onCancel}
            />
        ) : null}
        </>,
    );
}
