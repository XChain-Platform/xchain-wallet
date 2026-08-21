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
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, Icon, Input, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { normalizeConstructorParams } from '../../flows/deployChunked.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import {
    NATIVE_FEE_WARNING,
    NATIVE_FEE_UNVERIFIED_NOTICE,
} from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { humanizeDeployDiagnostic, humanizeGasRationale } from '../utils/deployDiagnostic.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

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

/**
 * DEPLOY authoring form: §42.6.
 *
 * Surface:
 *
 *   Name:               [ … ]
 *   Code source:        [ textarea (multi-line JS) ]
 *   Gas limit:          [ input, auto-suggested ]
 *   Constructor params: [ pipe-delimited ]
 *
 *   [Validate code]   sdk.contracts.validate
 *   [Estimate size]   sdk.contracts.checkCodeSize
 *   [Suggest gas]     sdk.contracts.suggestGasLimit
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
 * string per the protocol. NAME + CONSTRUCTOR_PARAMS are optional.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DeployContractForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

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

    const [name, setName] = useState('');
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
        /** @type {{ ok: boolean, msg: string, warnings?: string[] } | null} */ (null),
    );
    const [sizeInfo, setSizeInfo] = useState(
        /** @type {{ bytes: number, withinLimit: boolean } | null} */ (null),
    );
    const [suggestedGas, setSuggestedGas] = useState(/** @type {number | null} */ (null));
    const [suggestedRationale, setSuggestedRationale] = useState(/** @type {string | null} */ (null));

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
    // PC-38: interrupted runs whose chunks are already paid for on chain.
    const [resumable, setResumable] = useState(/** @type {any[]} */ ([]));
    const [resumeId, setResumeId] = useState(/** @type {string | null} */ (null));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

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
                        `Contracts can only be deployed on ${where}. Use Receive on one of those `
                        + 'networks to generate an address before deploying.',
                    );
                    return;
                }
                setChainId(firstDeployable);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
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

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const hasCooldown = cooldownBlocks.trim() !== '';
        const p = {
            // Bump to v1 when the user opts into contract-staking metadata; otherwise stay on v0.
            VERSION: hasCooldown ? '1' : '0',
            CODE: code,
            GAS_LIMIT: String(gasLimit || suggestedGas || ''),
        };
        if (name.trim()) p.NAME = name.trim();
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
            p.COOLDOWN_BLOCKS = cooldownBlocks.trim();
            // Default to BURN if cooldown is set but destination is blank; the indexer
            // applies the same default, but surfacing it here makes review honest.
            p.SLASH_DESTINATION = slashDestination.trim() || 'BURN';
        }
        return p;
    }, [code, gasLimit, suggestedGas, name, constructorParams, cooldownBlocks, slashDestination]);

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
            gasLimit: String(gasLimit || suggestedGas || ''),
            constructorParams: constructorParams.trim() || undefined,
        })
            .then((p) => { if (!cancelled) setPlan(p); })
            // The planner reports an over-budget contract as
            // "…exceeds MAX_DEPLOY_CHUNKS (16)"; deployDiagnostic restates the
            // SDK constant as a limit the author can act on.
            .catch((e) => { if (!cancelled) setPlanError(humanizeDeployDiagnostic(e).message || 'Could not size this contract.'); });
        return () => { cancelled = true; };
    }, [messaging, chainId, code, gasLimit, suggestedGas, constructorParams]);

    async function handleUseTemplate(templateName) {
        if (!chainId) return;
        setFormError(null);
        try {
            const { code: src } = await messaging.scaffoldContract({ chainId, name: templateName });
            setCode(src);
            setValidation(null);
            setSizeInfo(null);
        } catch (e) {
            setFormError(e?.message || `Could not load the "${templateName}" template.`);
        }
    }

    async function handleValidate() {
        if (!chainId) return;
        setFormError(null);
        try {
            const res = await messaging.validateContractCode({ chainId, code });
            if (res?.valid) {
                setValidation({ ok: true, msg: 'Syntax OK.', warnings: res.warnings });
            } else {
                setValidation({ ok: false, msg: humanizeDeployDiagnostic(res?.error).message || 'Validation failed.' });
            }
        } catch (e) {
            setValidation({ ok: false, msg: humanizeDeployDiagnostic(e).message || 'Validation failed.' });
        }
    }

    async function handleCheckSize() {
        if (!chainId) return;
        try {
            const res = await messaging.checkContractCodeSize({ chainId, code });
            setSizeInfo(res);
        } catch (e) {
            setFormError(e?.message || 'Size check failed.');
        }
    }

    async function handleSuggestGas() {
        if (!chainId) return;
        try {
            // sdk.contracts.suggestGasLimit returns { suggested, rationale };
            // pull the scalar out (rendering the object crashed the form).
            const { suggested, rationale } = await messaging.suggestContractGasLimit({ chainId, code });
            setSuggestedGas(suggested);
            setSuggestedRationale(rationale || null);
            if (!gasLimit) setGasLimit(String(suggested));
        } catch (e) {
            setFormError(e?.message || 'Gas suggestion failed.');
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('No address available to deploy from on this chain.');
            return;
        }
        if (!code.trim()) {
            setFormError('Contract source is required.');
            return;
        }
        const gas = String(gasLimit).trim() || (suggestedGas ? String(suggestedGas) : '');
        if (!gas || Number.isNaN(Number(gas)) || Number(gas) <= 0) {
            setFormError('Gas limit must be a positive number. Tap "Suggest gas" for a heuristic estimate.');
            return;
        }
        if (validation?.ok === false) {
            setFormError('Fix the syntax error before previewing (see Validate code).');
            return;
        }
        if (cooldownBlocks.trim() !== '') {
            const cb = Number(cooldownBlocks.trim());
            if (!Number.isInteger(cb) || cb < 1 || cb > 100000) {
                setFormError('Cooldown blocks must be an integer between 1 and 100000.');
                return;
            }
        } else if (slashDestination.trim() !== '') {
            setFormError('Slash destination requires a cooldown duration (otherwise the contract is not stakeable).');
            return;
        }
        setFormError(null);
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
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Deploy failed.',
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
            // PC-38: a source past one action's capacity deploys as N chunk
            // carriers plus an assembling DEPLOY. The legs are sequential by
            // consensus (each carrier must be indexed, at a lower action_index,
            // before the assembler runs), so this lane cannot be an encode-only
            // build: watcher mode is refused rather than half-served.
            if (plan && plan.single === false) {
                if (isWatcherMode) {
                    throw new Error(
                        `This contract needs ${plan.totalChunks} chunk transactions plus an assembling one, `
                        + 'each signed only after the previous is confirmed. A watch-only wallet cannot '
                        + 'complete that sequence; deploy it from the wallet holding the key.',
                    );
                }
                const chunkedBase = {
                    walletId,
                    chainId,
                    from: base.from,
                    code,
                    gasLimit: String(gasLimit || suggestedGas || ''),
                    name: name.trim() || undefined,
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
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Deploy failed.',
                    }),
            );
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
        if (assembleParams.GAS_LIMIT) setGasLimit(String(assembleParams.GAS_LIMIT));
        const ctor = assembleParams.CONSTRUCTOR_PARAMS;
        if (ctor !== undefined && ctor !== null) {
            // v2 stores the REST field as an array, v3 as a single value; the
            // form collects both as one pipe-delimited string.
            setConstructorParams(Array.isArray(ctor) ? ctor.join('|') : String(ctor));
        }
        if (assembleParams.COOLDOWN_BLOCKS) setCooldownBlocks(String(assembleParams.COOLDOWN_BLOCKS));
        // The form's convention is that a BLANK destination means BURN, and the
        // wire params spell BURN out, so map it back rather than typing the
        // literal into a field whose placeholder already means it.
        if (assembleParams.SLASH_DESTINATION) {
            setSlashDestination(String(assembleParams.SLASH_DESTINATION) === 'BURN'
                ? '' : String(assembleParams.SLASH_DESTINATION));
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
                    ? 'Review deploy'
                    : `Deploy contract${descriptor ? ` on ${descriptor.displayName}` : ''}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            </>,
        );
    }
    if (!addressesByChain) {
        return wrap(<p>Loading addresses…</p>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<QueuedResultPanel onDone={onBack} />);
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <>
                <p className={styles.summary}>
                    Contract deployed. The transaction was broadcast; the network will record it shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'N/A')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Deploy contract {actionParams.NAME ? `"${actionParams.NAME}"` : ''} to{' '}
                    {descriptor?.displayName || chainId}, gas limit {actionParams.GAS_LIMIT}.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Name</dt>
                    <dd className={styles.detailsValue}>{actionParams.NAME || '(unnamed)'}</dd>
                    <dt className={styles.detailsLabel}>Code</dt>
                    <dd className={styles.detailsValue}>
                        {sizeInfo ? `${sizeInfo.bytes} bytes` : `${new Blob([code]).size} bytes`}
                    </dd>
                    <dt className={styles.detailsLabel}>Gas limit</dt>
                    <dd className={styles.detailsValue}>{actionParams.GAS_LIMIT}</dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                    {actionParams.CONSTRUCTOR_PARAMS ? (
                        <>
                            <dt className={styles.detailsLabel}>Constructor</dt>
                            <dd className={styles.detailsValue}>{actionParams.CONSTRUCTOR_PARAMS}</dd>
                        </>
                    ) : null}
                    {actionParams.COOLDOWN_BLOCKS ? (
                        <>
                            <dt className={styles.detailsLabel}>Cooldown</dt>
                            <dd className={styles.detailsValue}>{actionParams.COOLDOWN_BLOCKS} blocks</dd>
                            <dt className={styles.detailsLabel}>Slash to</dt>
                            <dd className={styles.detailsValue}>{actionParams.SLASH_DESTINATION}</dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Protocol fee</dt>
                    <dd className={styles.detailsValue}>
                        {nativeFee.payFeeInNativeCoin
                            ? `Paid in ${coinTicker || 'the native coin'}`
                            : 'Paid from your XCHAIN balance'}
                    </dd>
                </dl>
                {/* The review stage is the watcher lane's last stop before the
                    PSBT leaves for a signer wallet, so the forfeiture terms are
                    stated here rather than only on the confirm page. */}
                {nativeFee.payFeeInNativeCoin ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>{NATIVE_FEE_WARNING}</p>
                        <p className={styles.warning}>{NATIVE_FEE_UNVERIFIED_NOTICE}</p>
                    </div>
                ) : null}
                {/* Lint advisories are already written for a contract author
                    (line number, symbol, prescribed fix), so deployDiagnostic
                    passes them through and rewrites only the ones stated in SDK
                    internals. */}
                {validation?.warnings && validation.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {validation.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{humanizeDeployDiagnostic(w).message}</p>
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
                {/* A chunked run lives entirely in `submitting`, which renders THIS
                    screen - so the explanation has to be here. It used to sit in the
                    form-stage JSX, i.e. on a screen the user has already left by the
                    time the run starts, which left a multi-minute, multi-transaction
                    deploy showing nothing but a spinning button. States what is
                    happening without claiming a live count it cannot know (a frozen
                    "0 of N" would read as a stall); per-leg progress is in the
                    pendingDeploy record the resume banner reads. */}
                {chunkProgress ? (
                    <p className={styles.summary} role="status">
                        Deploying {chunkProgress.total} chunk transactions, then the assembling one.
                        Each waits for confirmation before the next is signed, so this takes a
                        few minutes. Leave the wallet open; if it is interrupted you can resume
                        without re-paying for the chunks already sent.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Deploy on ${descriptor.displayName}` : 'Deploy')}
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
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField
                value={chainId}
                onChange={setChainId}
                chainIds={deployChainsWithAddresses.length ? deployChainsWithAddresses : (chainId ? [chainId] : [])}
                chainRegistry={chainRegistry}
            />

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
                    No address on this chain yet. Use Receive to generate one first.
                </StatusMessage>
            )}

            <Input
                label="Name (optional)"
                // PC-38 §14 rule 3: the old hint promised this "Appears in My
                // contracts and the detail page", which is false in both
                // directions - DEPLOY carries no NAME field in any version
                // (verified on chain: the wire string is
                // DEPLOY|<ver>|<code|hash>|<gas>), and the explorer's contract
                // rows have no name column, so ContractsList's row.name lookup
                // always falls through to "(unnamed)".
                hint="Not published on chain: the protocol has no name field for contracts, which are identified by their action index. This is a label for this screen only."
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
            />

            {/* PC-38: resume an interrupted chunked deploy. Those chunks are
                already on chain and already paid for; restarting re-pays. */}
            {resumable.length > 0 ? (
                <div className={styles.warnings}>
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
                        const done = (r.chunks || []).filter((c) => c.actionIndex || c.txid).length;
                        return (
                            <div key={r.id} className={styles.warning}>
                                <p>
                                    Unfinished deploy{r.name ? ` of "${r.name}"` : ''}: {done} of{' '}
                                    {r.totalChunks} chunk transactions have already been sent. Finishing
                                    costs only the remaining ones; starting over pays for all of them again.
                                </p>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => {
                                            setCode(r.code);
                                            setName(r.name || '');
                                            setResumeId(r.id);
                                            setValidation(null);
                                            setSizeInfo(null);
                                            // Restore the rest of the plan, not just the
                                            // source. The flow now assembles phase 2 from the
                                            // record, so leaving these fields blank would show a
                                            // review screen that disagrees with the transaction
                                            // about to be signed - measured: the gas field came
                                            // back empty against an original 50000. `assembleParams`
                                            // is the record's copy of exactly these values.
                                            restoreAssembleFields(r.assembleParams);
                                        }}
                                    >
                                        Resume this deploy
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={async () => {
                                            await messaging.clearPendingDeploy({ id: r.id });
                                            setResumable((rows) => rows.filter((x) => x.id !== r.id));
                                            if (resumeId === r.id) setResumeId(null);
                                        }}
                                    >
                                        Discard
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {/* PC-38: the SDK ships audited scaffolds; the wallet had no path to them. */}
            {templates && (templates.templates?.length || templates.patterns?.length) ? (
                <div style={{ marginBottom: '0.75rem' }}>
                    <p className={styles.detailsLabel}>Start from an audited template</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {[...(templates.templates || []), ...(templates.patterns || [])].map((t) => (
                            <Button
                                key={t}
                                type="button"
                                variant="ghost"
                                onClick={() => handleUseTemplate(t)}
                            >
                                {t}
                            </Button>
                        ))}
                    </div>
                    <p className={styles.hint}>
                        Loading a template replaces the source below. Review and customize it before deploying.
                    </p>
                </div>
            ) : null}

            <label className={styles.pickerLabel}>
                Code source
                <textarea
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value);
                        setValidation(null);
                        setSizeInfo(null);
                    }}
                    rows={isFull ? 20 : 10}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    placeholder="// JavaScript contract source…"
                    style={{
                        width: '100%',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        padding: '0.5rem',
                    }}
                />
            </label>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <Button type="button" variant="ghost" onClick={handleValidate} disabled={!code.trim()}>
                    Validate code
                </Button>
                <Button type="button" variant="ghost" onClick={handleCheckSize} disabled={!code.trim()}>
                    Estimate size
                </Button>
                <Button type="button" variant="ghost" onClick={handleSuggestGas} disabled={!code.trim()}>
                    Suggest gas
                </Button>
            </div>

            {/* PC-38: how many transactions this deploy actually costs. */}
            {planError ? (
                <StatusMessage variant="error" className={styles.error}>{planError}</StatusMessage>
            ) : plan ? (
                <p className={plan.single ? styles.summary : styles.warning}>
                    {plan.single
                        ? 'Fits in a single transaction.'
                        : `Too large for one transaction: deploys as ${plan.totalChunks} chunk `
                          + `transactions plus 1 assembling transaction (${plan.totalChunks + 1} total, `
                          + 'each paying its own network fee). They are signed one at a time, and each '
                          + 'must confirm before the next is built, so keep the wallet open until it finishes. '
                          + 'If it is interrupted you can resume without re-paying for the chunks already sent.'}
                </p>
            ) : null}

            {/* PC-38: the run is host-side and does not stream per-leg events
                back here, so this states what is happening WITHOUT claiming a
                live count it cannot know (a frozen "0 of N" would read as a
                stall). Per-leg progress is recorded in the pendingDeploy
                record, which is what the resume banner reads. */}
            {validation ? (
                <p
                    role={validation.ok ? undefined : 'alert'}
                    className={validation.ok ? styles.summary : styles.error}
                >
                    {validation.msg}
                    {validation.warnings && validation.warnings.length > 0 ? (
                        <> ({validation.warnings.length} warning(s))</>
                    ) : null}
                </p>
            ) : null}
            {sizeInfo ? (
                <p
                    role={sizeInfo.withinLimit ? undefined : 'alert'}
                    className={sizeInfo.withinLimit ? styles.summary : styles.error}
                >
                    {sizeInfo.bytes} bytes{sizeInfo.withinLimit ? ' (within 64KB limit)' : ' (exceeds 64KB limit)'}
                </p>
            ) : null}
            {suggestedGas !== null ? (
                <p className={styles.summary}>
                    Suggested gas limit: {suggestedGas}
                    {gasLimit !== String(suggestedGas) ? ' (applied)' : ''}
                    {/* The SDK's rationale is a raw count dump ("… 1 indexed
                        for, charged 2x/iteration …"); restate it in plain
                        counts, keeping the raw string when the shape moves
                        upstream. */}
                    {suggestedRationale ? ` (${humanizeGasRationale(suggestedRationale) || suggestedRationale})` : ''}
                </p>
            ) : null}

            <Input
                label="Gas limit"
                hint="Upper bound of VM gas the deployer and subsequent calls may consume."
                inputMode="numeric"
                value={gasLimit}
                onChange={(e) => setGasLimit(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Constructor params (optional)"
                hint="Pipe-delimited values passed to the contract's constructor."
                value={constructorParams}
                onChange={(e) => setConstructorParams(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Cooldown blocks (optional)"
                hint="Set to enable contract-staking. Blocks between an unstake and token release (1–100000). Leave blank for a non-stakeable contract."
                inputMode="numeric"
                value={cooldownBlocks}
                onChange={(e) => setCooldownBlocks(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Slash destination (optional)"
                hint='Where slashed tokens go. Enter an address or "BURN" to route to the chain burn address. Defaults to BURN when cooldown is set. Locked at deploy and cannot change later.'
                value={slashDestination}
                onChange={(e) => setSlashDestination(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
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

            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} unverified />

            {formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !code.trim() || actionConfirm.composing}
                >
                    {singleEncode ? 'Deploy' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
