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
    FeeSelector,
    AddressField,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { isDemoWallet, synthesizeDemoContractMeta } from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { ContractConsentPanel } from '../components/ContractConsentPanel.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// House convention: explorer reads answer as a bare array, {data} or {rows}.
function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

// Contract-targeted staking is BTC-only at launch (mirrors capability staking's
// indexer-side coin gate). All staking actions in this form go through STAKE v3 /
// UNSTAKE v1 / DELEGATE v1; capability staking lives in the separate StakeForm.
const STAKE_COIN = 'bitcoin';

/**
 * ContractStakeForm: STAKE v3 / UNSTAKE v1 / DELEGATE v1 authoring surface.
 *
 * Entered from ContractDetail.jsx when the target contract opted into staking
 * (cooldown_blocks set at DEPLOY v1). The form prominently surfaces the
 * slash destination + cooldown duration so users can read the trust they're
 * extending before they sign. See:
 *   xchain-documentation/protocol/actions/CONTRACT_STAKING.md
 *
 * Three modes (radio):
 *   - 'stake'    → STAKE v3 (AMOUNT + SIGNING_PUBKEY + TICK)
 *   - 'unstake'  → UNSTAKE v1 (SIGNING_PUBKEY + TICK)
 *   - 'delegate' → DELEGATE v1 (SIGNING_PUBKEY + TICK)
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string|number} props.contractActionIndex - target contract being staked TO
 * @param {'stake'|'unstake'|'delegate'} [props.initialMode] - preselect the action radio (e.g. a staking position's Unstake quick action)
 * @param {() => void} props.onBack
 */
export function ContractStakeForm({ walletId, chainId, contractActionIndex, initialMode, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    // Contract metadata (cooldown + slash destination), fetched to surface in the UI
    const [contractMeta, setContractMeta] = useState(/** @type {{ cooldown: number|null, slashDestination: string|null, valid: boolean } | null} */ (null));

    // Mode selection; callers can preselect via initialMode (defaults to
    // stake, the most common operation)
    const [mode, setMode] = useState(/** @type {'stake'|'unstake'|'delegate'} */ (initialMode || 'stake'));
    const [amount, setAmount] = useState('');
    const [signingPubkey, setSigningPubkey] = useState('');
    const [tick, setTick] = useState('XCHAIN');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [password, setPassword] = useState('');

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
                // Stake from the chain's active address (else newest HD
                // external), matching Send.
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this chain to stake from. Use Receive to generate one first.');
                    return;
                }
                setFromAddressId(sourceId);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        let cancelled = false;
        // Demo wallets have no live indexer to serve deploy metadata; use
        // the fixture so the demo contract positions stay actionable.
        if (isDemoWallet(walletId)) {
            const meta = synthesizeDemoContractMeta(chainId, contractActionIndex);
            setContractMeta({
                cooldown: meta ? Number(meta.cooldown_blocks) : null,
                slashDestination: meta ? String(meta.slash_destination) : null,
                valid: meta != null,
            });
            return () => { cancelled = true; };
        }
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => {
                if (cancelled) return;
                const row = resp?.row || resp?.rows?.[0] || resp;
                if (!row) {
                    setLoadError('Could not load target contract metadata.');
                    return;
                }
                const cooldown = row.cooldown_blocks ?? row.COOLDOWN_BLOCKS ?? null;
                const slashDest = row.slash_destination ?? row.SLASH_DESTINATION
                    ?? row.slash_destination_address ?? null;
                setContractMeta({
                    cooldown: cooldown !== null ? Number(cooldown) : null,
                    slashDestination: slashDest ? String(slashDest) : null,
                    valid: cooldown !== null && cooldown !== undefined,
                });
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load contract metadata.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, contractActionIndex, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
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

    // Unstake mode's "available" is the STAKED balance on this contract
    // (per pubkey when one is entered), not the wallet token balance;
    // it bounds the  optional partial amount.
    const [stakedAvailable, setStakedAvailable] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        const address = fromAddress?.address;
        if (mode !== 'unstake' || !address || !chainId) { setStakedAvailable(null); return undefined; }
        let cancelled = false;
        messaging.getContractStakesForAddress({ chainId, address })
            .then((r) => {
                if (cancelled) return;
                const rows = extractRows(r).filter((row) =>
                    String(row.target_contract_index) === String(contractActionIndex)
                    && (!tick || String(row.tick || '').toUpperCase() === tick.trim().toUpperCase())
                    && (!signingPubkey.trim()
                        || String(row.signing_pubkey || row.SIGNING_PUBKEY || '').toLowerCase() === signingPubkey.trim().toLowerCase()));
                let total = 0;
                for (const row of rows) {
                    const n = Number(row.amount ?? row.AMOUNT ?? 0);
                    if (Number.isFinite(n)) total += n;
                }
                setStakedAvailable(rows.length > 0 ? total : null);
            })
            .catch(() => { if (!cancelled) setStakedAvailable(null); });
        return () => { cancelled = true; };
    }, [mode, chainId, fromAddress?.address, contractActionIndex, tick, signingPubkey, messaging]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

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

    // PC-39: consent disclosure for the contract the stake is locked
    // into. Staking puts a real balance behind this contract's rules for
    // the cooldown's duration, so the same manifest the EXECUTE / DEPOSIT
    // screens show belongs here. Fetched only once the user reaches the
    // review stage. Unstake and delegate are excluded: both act on an
    // existing position rather than granting new authority.
    const manifest = useContractManifest({
        chainId,
        contractActionIndex: String(contractActionIndex),
        skip: mode !== 'stake' || (stage !== 'review' && stage !== 'submitting'),
    });

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            SIGNING_PUBKEY: signingPubkey.trim(),
            TARGET_CONTRACT_INDEX: String(contractActionIndex),
            TICK: tick.trim(),
        };
        if (mode === 'stake') p.AMOUNT = amount.trim();
        // : unstake AMOUNT is an optional strict partial. Empty
        // field or the full staked balance keeps the legacy absent-AMOUNT
        // bytes (full sweep); pre-flag-day layers IGNORE a present AMOUNT,
        // so legacy bytes are the safe encoding for a full sweep.
        if (mode === 'unstake' && amount.trim() !== '') {
            const n = Number(amount.trim());
            if (!(stakedAvailable != null && Number.isFinite(n) && n >= stakedAvailable)) {
                p.AMOUNT = amount.trim();
            }
        }
        return p;
    }, [mode, amount, signingPubkey, tick, contractActionIndex, stakedAvailable]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No Bitcoin address available to stake from.');
            return;
        }
        if (!contractMeta?.valid) {
            setFormError('Target contract is not stakeable (no cooldown configured at deploy time).');
            return;
        }
        if (!actionParams.SIGNING_PUBKEY || !/^[0-9a-fA-F]{64}$/.test(actionParams.SIGNING_PUBKEY)) {
            setFormError('Signing pubkey must be 64 hex characters (Ed25519).');
            return;
        }
        if (!actionParams.TICK) {
            setFormError('Token ticker is required.');
            return;
        }
        if (mode === 'stake') {
            if (!actionParams.AMOUNT || !/^[0-9]+(\.[0-9]+)?$/.test(actionParams.AMOUNT) || Number(actionParams.AMOUNT) <= 0) {
                setFormError('Amount must be a positive decimal.');
                return;
            }
        }
        if (mode === 'unstake' && amount.trim() !== '') {
            const amt = amount.trim();
            if (!/^[0-9]+(\.[0-9]+)?$/.test(amt) || Number(amt) <= 0) {
                setFormError('Amount must be a positive decimal (or leave it blank to unstake everything).');
                return;
            }
            if (stakedAvailable != null && Number(amt) > stakedAvailable) {
                setFormError(`Amount exceeds the ${formatWithThousands(String(stakedAvailable))} ${tick.trim().toUpperCase()} staked on this contract.`);
                return;
            }
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const { isWatcherMode } = useWalletMode();

    //  ( §5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included . Watcher mode still branches: it encodes, it
    // never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // : hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'contractStakeAction',
        hardware: 'contractStakeActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        const wireAction = mode === 'stake' ? 'STAKE' : mode === 'unstake' ? 'UNSTAKE' : 'DELEGATE';
        const wireVersion = mode === 'stake' ? '3' : '1';
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
                actionData: { action: wireAction, params: { VERSION: wireVersion, ...actionParams } },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                // The flow builds its own wire params from mode + params, so
                // the submit keeps the LEGACY shape; only the compose above
                // needs the versioned wire form.
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    mode,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || `${mode} failed.`);
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
                mode,
                params: actionParams,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                // Watcher mode falls back to action-format request building.
                let action;
                let version;
                if (mode === 'stake')        { action = 'STAKE';    version = '3'; }
                else if (mode === 'unstake') { action = 'UNSTAKE';  version = '1'; }
                else                          { action = 'DELEGATE'; version = '1'; }
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params: { VERSION: version, ...actionParams } },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else if (isHwSource) {
                res = await messaging.contractStakeActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.contractStakeAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || `${mode} failed.`,
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
            backLabel="Back to contract"
            title={`Stake on contract #${contractActionIndex}`}
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
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain || !contractMeta) {
        return wrap(<p>Loading…</p>);
    }
    if (!contractMeta.valid) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>
                    Contract #{contractActionIndex} is not stakeable. Its deploy
                    transaction did not set a cooldown duration. Staking is only
                    available on contracts that explicitly opted in at deploy time.
                </div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
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
                    {mode === 'stake' ? 'Stake' : mode === 'unstake' ? 'Unstake' : 'Delegation'} submitted.
                    The transaction was broadcast; the network will record it shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || '(pending)')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const verb = mode === 'stake' ? 'Stake' : mode === 'unstake' ? 'Unstake' : 'Delegate';
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {verb}
                    {mode === 'stake'
                        ? ` ${actionParams.AMOUNT} ${actionParams.TICK}`
                        : mode === 'unstake' && actionParams.AMOUNT !== undefined
                            ? ` ${actionParams.AMOUNT} ${actionParams.TICK}`
                            : ` (${actionParams.TICK})`}
                    {' '}on contract #{contractActionIndex}.
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
                    <dt className={styles.detailsLabel}>Signing pubkey</dt>
                    <dd className={styles.detailsValue}>
                        <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{actionParams.SIGNING_PUBKEY}</code>
                    </dd>
                    {mode === 'stake' ? (
                        <>
                            <dt className={styles.detailsLabel}>Amount</dt>
                            <dd className={styles.detailsValue}>{actionParams.AMOUNT} {actionParams.TICK}</dd>
                        </>
                    ) : null}
                    {mode === 'unstake' ? (
                        <>
                            <dt className={styles.detailsLabel}>Amount</dt>
                            <dd className={styles.detailsValue}>
                                {actionParams.AMOUNT !== undefined
                                    ? `${actionParams.AMOUNT} ${actionParams.TICK}`
                                    : `Full staked balance${stakedAvailable != null ? ` (${formatWithThousands(String(stakedAvailable))} ${actionParams.TICK})` : ''}`}
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Cooldown</dt>
                    <dd className={styles.detailsValue}>{contractMeta.cooldown} blocks</dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                    {mode === 'stake' ? (
                        <ContractConsentPanel
                            manifest={manifest}
                            labelClassName={styles.detailsLabel}
                            valueClassName={styles.detailsValue}
                        />
                    ) : null}
                    <dt className={styles.detailsLabel} style={{ color: '#b94a48' }}>Slash risk</dt>
                    <dd className={styles.detailsValue} style={{ color: '#b94a48' }}>
                        Funds slashed by this contract are sent to{' '}
                        {contractMeta.slashDestination
                            ? <AddressText address={contractMeta.slashDestination} />
                            : 'the contract-configured destination'}.
                    </dd>
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction. Sign it on
                        your Signer-mode wallet, then bring the signed transaction to a Full-mode
                        wallet to broadcast.
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
                    <div role="alert" className={styles.error}>{submitError}</div>
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
                                : `${verb}`}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form (the overlay modal
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
                // : hardware swaps the password field for the device block
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

    // Token picker (spendable balances, locked to the contract's chain),
    // rendered in place of the form.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setTick(String(sel.tick || '').toUpperCase());
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div className={styles.summary} style={{ marginBottom: '0.5rem' }}>
                Target: contract #{contractActionIndex},{' '}
                <strong>{contractMeta.cooldown}-block cooldown</strong>.{' '}
                Slashed funds are routed to{' '}
                {contractMeta.slashDestination
                    ? <AddressText address={contractMeta.slashDestination} />
                    : '(configured at deploy)'}.
            </div>

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
                <div role="alert" className={styles.error}>
                    No address on this chain yet. Use Receive to generate one first.
                </div>
            )}

            <fieldset style={{ border: 'none', padding: 0, marginBottom: '0.75rem' }}>
                <legend style={{ fontWeight: 'bold' }}>Action</legend>
                <label style={{ marginRight: '1rem' }}>
                    <input
                        type="radio"
                        name="contract-stake-mode"
                        checked={mode === 'stake'}
                        onChange={() => { setMode('stake'); setAmount(''); }}
                    /> Stake
                </label>
                <label style={{ marginRight: '1rem' }}>
                    <input
                        type="radio"
                        name="contract-stake-mode"
                        checked={mode === 'unstake'}
                        onChange={() => { setMode('unstake'); setAmount(''); }}
                    /> Unstake
                </label>
                <label>
                    <input
                        type="radio"
                        name="contract-stake-mode"
                        checked={mode === 'delegate'}
                        onChange={() => setMode('delegate')}
                    /> Delegate (rotate key)
                </label>
            </fieldset>

            <TokenField
                label="Token"
                value={tick && chainId ? { chainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />

            {mode === 'stake' || mode === 'unstake' ? (
                <AmountField
                    label="Amount"
                    hint={mode === 'stake'
                        ? "How much of the token to stake. Decimals must not exceed the token's precision."
                        : 'How much to unstake. Leave blank (or use Max) to unstake the full staked balance; the rest stays staked.'}
                    amount={amount}
                    tick={tick}
                    onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmount(stripped);
                }}
                    onMax={mode === 'stake'
                        ? (tickAmtBalance && Number(tickAmtBalance) > 0
                            ? () => setAmount(tickAmtBalance)
                            : undefined)
                        : (stakedAvailable != null && stakedAvailable > 0
                            ? () => setAmount(String(stakedAvailable))
                            : undefined)}
                    maxDisabled={mode === 'stake' ? !tickAmtBalance : stakedAvailable == null}
                    balanceText={mode === 'stake'
                        ? (tickAmtBalance != null && (tick)
                            ? `${formatWithThousands(tickAmtBalance)} ${String(tick).toUpperCase()} available`
                            : null)
                        : (stakedAvailable != null && (tick)
                            ? `${formatWithThousands(String(stakedAvailable))} ${String(tick).toUpperCase()} staked`
                            : null)}
                />
            ) : null}

            <Input
                label={mode === 'delegate' ? 'New signing public key' : 'Signing public key'}
                hint={mode === 'delegate'
                    ? '64-character hex-encoded Ed25519 public key to rotate to. Generate one offline; this wallet does not auto-generate validator keys.'
                    : mode === 'unstake'
                        ? '64-character hex-encoded Ed25519 public key identifying which contract-stake to begin cooldown for.'
                        : '64-character hex-encoded Ed25519 public key to associate with this stake. Re-staking with the same key tops up.'}
                value={signingPubkey}
                onChange={(e) => setSigningPubkey(e.target.value.trim())}
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

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || actionConfirm.composing}
                >
                    {singleEncode ? (mode === 'stake' ? 'Stake' : mode === 'unstake' ? 'Unstake' : 'Delegate') : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
