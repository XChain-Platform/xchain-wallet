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
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, Input, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { detectAddressCoin, isValidAddressForChain } from '../utils/addressValidation.js';
import { gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { isDemoGatedActionIndex } from '../../flows/demoGatedContent.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { formatAmount } from '../components/BalanceList.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};
const COIN_DISPLAY = { bitcoin: 'Bitcoin', litecoin: 'Litecoin', dogecoin: 'Dogecoin' };

// Mirrors Send.jsx's checksum-level destination validation: a SWEEP
// routes EVERYTHING selected to this one address, so a typo costs the
// whole address's holdings, not one send's worth.
function destinationAddressError(address, descriptor) {
    const a = (address || '').trim();
    if (!a || !descriptor?.coin || !descriptor?.networkKind) return null;
    if (isValidAddressForChain(a, descriptor.coin, descriptor.networkKind)) return null;
    const chainName = COIN_DISPLAY[descriptor.coin] || descriptor.coin;
    const detected = detectAddressCoin(a);
    if (detected && detected !== descriptor.coin) {
        return `This looks like a ${COIN_DISPLAY[detected] || detected} address, not a ${chainName} address.`;
    }
    const where = descriptor.networkKind === 'mainnet'
        ? chainName
        : `${chainName} ${descriptor.networkKind}`;
    return `This is not a valid ${where} address. Check it for typos.`;
}

const CATEGORY_META = [
    { key: 'balances', label: 'Token balances', defaultOn: true, hint: 'Every token balance this address holds.' },
    { key: 'ownerships', label: 'Token ownerships', defaultOn: true, hint: 'Issuer control of every token this address owns.' },
    { key: 'orders', label: 'Open orders (force-close)', defaultOn: false, hint: 'Cancels every open order; escrow goes to the destination.' },
    { key: 'swaps', label: 'Open swaps (force-close)', defaultOn: false, hint: 'Cancels every open swap; escrow goes to the destination.' },
    { key: 'dispensers', label: 'Open dispensers (force-close)', defaultOn: false, hint: 'Closes every open dispenser (1-hour close window); remaining escrow goes to the destination.' },
];

const PREVIEW_ROW_CAP = 8;

/**
 * Dedicated SWEEP form (PC-34).
 *
 * Moves token balances, token ownerships, and (by flag) force-closes
 * open orders / swaps / dispensers from one address, routing everything
 * (escrow included) to a single destination. The preview is API-derived
 * and indicative: SWEEP moves whatever the chain says at confirmation
 * time, so the typed confirm covers "everything in the selected
 * categories, including anything not listed here".
 *
 * Migrate lane (`migrateTo` set, from MigrateToBip39): destination is
 * locked to the new wallet's matching address and the gated-content
 * gate arms - on-chain key handoffs are ECIES-encrypted to the OLD
 * addresses, so any gated unlock key must sit in the vault (and be
 * re-scoped to the new wallet) BEFORE the sweep; recovery from the new
 * seed alone is impossible afterwards. Software signers can run the
 * PC-26 recovery scan inline; HW / watch-only degrade to a per-tick
 * warning (§5 signer note).
 *
 * @param {object} props
 * @param {string} props.walletId                     signing wallet (the LEGACY wallet in the migrate lane)
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {string} [props.initialDestination]
 * @param {{ walletId: string, name?: string, address: string } | null} [props.migrateTo]
 */
export function SweepForm({
    walletId, onBack, initialChainId, initialFromAddress, initialDestination, migrateTo = null,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const migrateLane = !!migrateTo;

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
        action: 'SWEEP',
        submitMethods: { hw: 'sweepTokenHw', software: 'sweepToken' },
        initialChainId,
        initialFromAddress,
        // Migrate lane arrives chain-locked (one sweep per chain row).
        lockedToken: migrateLane,
        noAddressMessage:
            'No addresses on any chain yet. Use Receive to generate one before sweeping.',
    });

    const [destination, setDestination] = useState(
        (initialDestination || migrateTo?.address || '').trim(),
    );
    const [flags, setFlags] = useState(() => Object.fromEntries(
        CATEGORY_META.map((c) => [c.key, c.defaultOn]),
    ));
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // Typed-confirmation gate: SWEEP moves everything at once, so it
    // rides the same typed-word rail as DESTROY.
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = typedConfirm.trim().toUpperCase() === 'SWEEP';

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (SWEEP is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

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
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // D-58: every form-level error names the state of one field,
    // so the moment any of them is edited the message can already be
    // false. Leaving it up meant an emptied destination sat under "This
    // is not a valid Bitcoin regtest address", which is not what was
    // wrong with it. Editing clears; the next submit re-derives.
    const clearFormError = useCallback(() => {
        setFormError((prev) => (prev === null ? prev : null));
    }, []);

    // ---- Indicative preview (sweep.preview host route) ----
    const [preview, setPreview] = useState(/** @type {any | null} */ (null));
    const [previewError, setPreviewError] = useState(/** @type {string | null} */ (null));
    const [previewLoading, setPreviewLoading] = useState(false);
    useEffect(() => {
        setPreview(null);
        setPreviewError(null);
        const address = fromAddress?.address;
        if (!chainId || !address) return undefined;
        let cancelled = false;
        setPreviewLoading(true);
        messaging.sweepPreview({ chainId, address })
            .then((p) => { if (!cancelled) { setPreview(p); setPreviewError(null); } })
            .catch((err) => {
                // Preview failure NEVER blocks the sweep; the typed
                // confirm already covers unlisted holdings.
                if (!cancelled) setPreviewError(err?.message || 'Preview unavailable.');
            })
            .finally(() => { if (!cancelled) setPreviewLoading(false); });
        return () => { cancelled = true; };
    }, [messaging, chainId, fromAddress?.address]);

    const gatedTicks = useMemo(() => (
        Array.isArray(preview?.gatedTicks?.rows) ? preview.gatedTicks.rows : []
    ), [preview]);

    // ---- Migrate gate: vault custody of gated unlock keys ----
    // Per gated tick: which of its packs have a key row in THIS wallet's
    // vault. Verified keys are re-scoped (copied) to the new wallet in
    // the same pass; missing ones can be recovered by the PC-26 scan
    // (software signers) or acknowledged (HW / watch-only, degraded gate).
    const [gateRows, setGateRows] = useState(/** @type {Array<{ tick: string, packCount: number, missingCount: number }> | null} */ (null));
    const [gateLoading, setGateLoading] = useState(false);
    const [gateCopied, setGateCopied] = useState(0);
    const [gateCheckSeq, setGateCheckSeq] = useState(0);
    const [scanPassword, setScanPassword] = useState('');
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState(/** @type {string | null} */ (null));
    const [ackMissingKeys, setAckMissingKeys] = useState(false);

    useEffect(() => {
        if (!migrateLane || !chainId || gatedTicks.length === 0) { setGateRows(null); return undefined; }
        let cancelled = false;
        setGateLoading(true);
        (async () => {
            const rows = [];
            for (const tick of gatedTicks) {
                try {
                    const groups = (await messaging.listGatedContent({ chainId, tick })).filter((g) => {
                        const files = Array.isArray(g?.files) ? g.files : [];
                        return files.length > 0 && !files.every((f) => isDemoGatedActionIndex(f.actionIndex));
                    });
                    const wanted = new Set(groups.map((g) => String(g.keyHash).toLowerCase()));
                    const held = await messaging.listGatedKeys({ walletId, chainId, gateTicker: tick });
                    const have = new Set((Array.isArray(held) ? held : [])
                        .map((r) => String(r.keyHash).toLowerCase()));
                    let missing = 0;
                    for (const hash of wanted) if (!have.has(hash)) missing += 1;
                    rows.push({ tick, packCount: wanted.size, missingCount: missing });
                } catch {
                    // Unknown state fails toward "missing" so the gate warns
                    // rather than green-lighting an unverified tick.
                    rows.push({ tick, packCount: 1, missingCount: 1 });
                }
            }
            if (cancelled) return;
            setGateRows(rows);
            // Custody leg: re-scope every key this vault already holds to
            // the migration-target wallet (idempotent; counts only).
            try {
                const res = await messaging.copyGatedKeysToWallet({
                    fromWalletId: walletId,
                    toWalletId: migrateTo.walletId,
                    chainId,
                });
                if (!cancelled) setGateCopied((res?.copied || 0) + (res?.skipped || 0));
            } catch { /* custody copy is best-effort; the gate rows still gate */ }
        })().finally(() => { if (!cancelled) setGateLoading(false); });
        return () => { cancelled = true; };
    }, [messaging, migrateLane, chainId, walletId, migrateTo?.walletId, gatedTicks, gateCheckSeq]);

    const gateMissingTicks = useMemo(() => (
        (gateRows || []).filter((r) => r.missingCount > 0).map((r) => r.tick)
    ), [gateRows]);
    const gateSatisfied = !migrateLane
        || gatedTicks.length === 0
        || (gateRows != null && gateMissingTicks.length === 0)
        || ackMissingKeys;
    const canScan = migrateLane && !isWatcherMode && !isHwSource && gateMissingTicks.length > 0;

    async function handleRecoverKeys() {
        if (!canScan || scanning) return;
        if (scanPassword.length === 0) { setScanError('Enter the wallet password to scan.'); return; }
        setScanning(true);
        setScanError(null);
        try {
            for (const tick of gateMissingTicks) {
                await messaging.gatedContentScan({
                    walletId, password: scanPassword, chainId, tick,
                });
            }
            setScanPassword('');
            setGateCheckSeq((n) => n + 1); // re-check presence + re-copy
        } catch (err) {
            setScanError(err?.name === 'InvalidPasswordError' || err?.name === 'WrongPasswordError'
                ? 'Incorrect password.'
                : (err?.message || 'Key recovery scan failed.'));
        } finally {
            setScanning(false);
        }
    }

    // ---- Destination rails ----
    const destTrimmed = destination.trim();
    const destFormatError = destinationAddressError(destTrimmed, descriptor);
    const destinationIsOwn = useMemo(() => {
        if (!destTrimmed || !chainId || !addressesByChain) return false;
        return (addressesByChain[chainId] || []).some((a) => a.address === destTrimmed);
    }, [destTrimmed, chainId, addressesByChain]);
    // Loud third-party path: a valid destination the signing wallet does
    // not own. The migrate lane's destination belongs to the NEW wallet
    // (own by construction), so it shows an info line instead.
    const thirdPartyDestination = !migrateLane && destTrimmed.length > 0
        && !destFormatError && !destinationIsOwn;

    const selectedCount = CATEGORY_META.filter((c) => flags[c.key]).length;

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            DESTINATION: destTrimmed,
            BALANCES: flags.balances ? '1' : '0',
            OWNERSHIPS: flags.ownerships ? '1' : '0',
            ORDERS: flags.orders ? '1' : '0',
            SWAPS: flags.swaps ? '1' : '0',
            DISPENSERS: flags.dispensers ? '1' : '0',
        };
        if (memo.trim().length > 0) p.MEMO = memo.trim();
        return p;
    }, [destTrimmed, flags, memo]);

    // Flow-shaped opts for the software / HW submit paths (the watcher
    // path encodes from `actionParams` instead; useActionForm keeps the
    // two payload shapes explicit).
    const flowOpts = useMemo(() => ({
        to: destTrimmed,
        balances: flags.balances,
        ownerships: flags.ownerships,
        orders: flags.orders,
        swaps: flags.swaps,
        dispensers: flags.dispensers,
        ...(memo.trim().length > 0 ? { memo: memo.trim() } : {}),
        ...(feePerKb != null ? { feePerKb } : {}),
        payFeeInNativeCoin: nativeFee.flag,
    }), [destTrimmed, flags, memo, feePerKb, nativeFee.flag]);

    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

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
            action: 'SWEEP',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);

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
                compose: () => messaging.composeForConfirm({
                    walletId,
                    chainId,
                    from,
                    actionData: { action: 'SWEEP', params: actionParams },
                    // PC-51: the opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                }),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // Re-price the native-coin protocol fee at Approve.
                // The output was sized at compose, and the amount consensus
                // requires moves inversely with the coin price, so a move while
                // the confirm screen sits open leaves it short - which the
                // chain rejects while keeping the fee.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: {
                        ...flowOpts,
                        prebuiltPsbt: {
                            psbtHex: composed.psbt,
                            encoding: composed.encoding,
                            actionString: composed.actionString,
                            version: composed.version,
                            // The donation verdict these bytes actually carry, so the submit
                            // path books from compose time rather than a fresh snapshot.
                            adsDonation: { included: !!composed.adsPlan?.canSubmit },
                        },
                    },
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            console.error('Sweep (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: humanizeError(err, 'sweep').message,
            }));
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!destTrimmed) {
            setFormError('Destination address is required.');
            return;
        }
        if (destFormatError) {
            setFormError(destFormatError);
            return;
        }
        if (destTrimmed === fromAddress.address) {
            setFormError('Destination is the source address itself; the sweep would move nothing anywhere.');
            return;
        }
        if (selectedCount === 0) {
            setFormError('Select at least one category to sweep.');
            return;
        }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) {
            setFormError('Memo cannot contain "|" or ";".');
            return;
        }
        if (!gateSatisfied) {
            setFormError(`Unlock keys for ${gateMissingTicks.join(', ')} are not in the vault yet. Recover them below, or acknowledge sweeping without them.`);
            return;
        }
        setFormError(null);
        if (!isWatcherMode) {
            openConfirmModal();
            return;
        }
        setStage('review');
    }

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
                extraBase: flowOpts,
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
                        fallback: err?.message || 'Sweep failed.',
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
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting'
                ? 'Review sweep'
                : (migrateLane ? 'Sweep to new wallet' : 'Sweep address')}
        />
    );
    const wrap = (children, footer = null) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
            {footer}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        // Signed but not broadcast. None of the post-sweep effects
        // below (auto-pay disarmed, dispensers closing) have happened.
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} what="sweep" />);
        }
        const forceClose = result?.forceClose;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Sweep broadcast</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                {forceClose && (forceClose.autopayDisabled > 0 || forceClose.holdsReleased > 0) ? (
                    <p className={styles.hint}>
                        Auto-pay disarmed on {forceClose.autopayDisabled} order
                        {forceClose.autopayDisabled === 1 ? '' : 's'} from the swept address
                        {forceClose.holdsReleased > 0
                            ? `; ${forceClose.holdsReleased} reservation hold${forceClose.holdsReleased === 1 ? '' : 's'} released`
                            : ''}.
                    </p>
                ) : null}
                {flags.dispensers ? (
                    <p className={styles.hint}>
                        Dispensers close after the standard 1-hour window; their
                        remaining escrow reaches the destination at close time.
                    </p>
                ) : null}
                {migrateLane && gateCopied > 0 ? (
                    <p className={styles.hint}>
                        {gateCopied} gated unlock key{gateCopied === 1 ? '' : 's'} now
                        available to {migrateTo.name || 'the new wallet'}.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    // Shared warning block (review + confirm page): third-party
    // destination and gated-tick key-handoff facts.
    const sweepWarnings = (
        <>
            {thirdPartyDestination ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        <strong>This destination is not one of this wallet's addresses.</strong>{' '}
                        Everything selected - balances, ownerships, and released
                        escrow - will belong to that address's owner. Triple-check
                        it before signing.
                    </p>
                </div>
            ) : null}
            {!migrateLane && gatedTicks.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    {gatedTicks.map((tick) => (
                        <p key={tick} className={styles.warning}>
                            {gatedTickWarningCopy(tick, 'sweep recipients')}
                        </p>
                    ))}
                </div>
            ) : null}
        </>
    );

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Destination</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={destTrimmed} />
                    </dd>
                    <dt className={styles.detailsLabel}>Sweeps</dt>
                    <dd className={styles.detailsValue}>
                        {CATEGORY_META.filter((c) => flags[c.key]).map((c) => c.label).join(', ')}
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
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {sweepWarnings}
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
                {(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : null}
                <Input
                    label="Type SWEEP to confirm"
                    hint="Everything in the selected categories moves to the destination, including anything the preview did not list."
                    value={typedConfirm}
                    onChange={(e) => setTypedConfirm(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant={isWatcherMode ? 'primary' : 'danger'}
                        loading={stage === 'submitting'}
                        disabled={
                            !typedConfirmOk || (
                                isWatcherMode
                                    ? false
                                    : isHwSource
                                        ? hwStatus !== 'available'
                                        : (!signerReady && password.length === 0)
                            )
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Sweep on ${descriptor.displayName}` : 'Sweep')}
                    </Button>
                </div>
            </form>,
        );
    }

    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={(isHwSource
                    ? hwStatus === 'available'
                    : (signerReady || password.length > 0)) && typedConfirmOk}
                extraCredentials={(
                    <>
                        {sweepWarnings}
                        <Input
                            label='Type "SWEEP" to confirm'
                            hint="Everything in the selected categories moves, including anything not listed in the preview."
                            value={typedConfirm}
                            onChange={(e) => setTypedConfirm(e.target.value)}
                            autoComplete="off"
                        />
                    </>
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
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    clearFormError();
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {migrateLane ? (
                <p className={styles.hint}>
                    Migration sweep: moves this legacy address's tokens to{' '}
                    {migrateTo.name || 'your new BIP39 wallet'}.{' '}
                    {/* A migrating user is the one person who must not read
                        this as "everything moved" - SWEEP never touches the
                        coin, so say where it stays and what is left to do. */}
                    Your {coinTicker || 'coin'} balance stays on the legacy
                    address; send it across separately, and keep the legacy
                    recovery phrase until you have.
                </p>
            ) : (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        <strong>Sweep moves everything selected at once.</strong>{' '}
                        The preview below is indicative; the chain settles whatever
                        the address holds when the sweep confirms.
                    </p>
                </div>
            )}

            {migrateLane ? (
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                </dl>
            ) : (
                <NetworkField
                    value={chainId}
                    onChange={setChainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                />
            )}

            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={migrateLane ? undefined : () => setSourcePickerOpen(true)}
                    iconLabel={migrateLane ? undefined : 'Choose source address'}
                />
            ) : (
                <StatusMessage variant="error" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </StatusMessage>
            )}

            <Input
                label="Destination address"
                hint={migrateLane
                    ? `The matching address in ${migrateTo.name || 'the new wallet'}.`
                    : 'Where every selected holding (and released escrow) is credited.'}
                value={destination}
                onChange={(e) => { setDestination(e.target.value); clearFormError(); }}
                readOnly={migrateLane}
                error={destTrimmed && destFormatError ? destFormatError : undefined}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            {thirdPartyDestination ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        <strong>Not your address.</strong> This wallet does not own
                        the destination; everything swept will belong to whoever
                        controls it.
                    </p>
                </div>
            ) : null}

            <p className={styles.successLabel}>What to sweep</p>
            {CATEGORY_META.map((c) => (
                <div key={c.key}>
                    <label className={styles.checkRow}>
                        <input
                            type="checkbox"
                            checked={flags[c.key]}
                            onChange={(e) => {
                                setFlags((f) => ({ ...f, [c.key]: e.target.checked }));
                                clearFormError();
                            }}
                        />
                        {' '}{c.label}
                        {preview ? ` (${categoryCount(preview, c.key)})` : ''}
                    </label>
                    <p className={styles.hint}>{c.hint}</p>
                    {flags[c.key] ? <CategoryPreview preview={preview} categoryKey={c.key} /> : null}
                </div>
            ))}
            {previewLoading ? <p className={styles.hint}>Loading preview…</p> : null}
            {previewError ? (
                <p className={styles.hint}>
                    Preview unavailable ({previewError}). The sweep still moves
                    everything in the selected categories.
                </p>
            ) : null}

            {migrateLane && gatedTicks.length > 0 ? (
                <div>
                    <p className={styles.successLabel}>Gated-content keys</p>
                    <p className={styles.hint}>
                        On-chain key handoffs are encrypted to this legacy address,
                        so unlock keys must be secured in the vault BEFORE the
                        sweep; they cannot be recovered from the new wallet's seed
                        afterwards.
                    </p>
                    {gateLoading ? <p className={styles.hint}>Checking vault keys…</p> : null}
                    {(gateRows || []).map((r) => (
                        <p key={r.tick} className={r.missingCount > 0 ? styles.warning : styles.hint}>
                            {r.tick}: {r.packCount - r.missingCount}/{r.packCount} unlock
                            key{r.packCount === 1 ? '' : 's'} in the vault
                            {r.missingCount > 0 ? ' - missing' : ''}
                        </p>
                    ))}
                    {gateCopied > 0 ? (
                        <p className={styles.hint}>
                            {gateCopied} key{gateCopied === 1 ? '' : 's'} carried over to{' '}
                            {migrateTo.name || 'the new wallet'}.
                        </p>
                    ) : null}
                    {canScan ? (
                        <>
                            <Input
                                type="password"
                                label="Wallet password (key recovery scan)"
                                hint="Scans this wallet's on-chain messages for the missing unlock keys and stores them in the vault."
                                value={scanPassword}
                                onChange={(e) => {
                                    setScanPassword(e.target.value);
                                    if (scanError) setScanError(null);
                                }}
                                error={scanError || undefined}
                                autoComplete="current-password"
                                disabled={scanning}
                            />
                            <div className={styles.actions}>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={handleRecoverKeys}
                                    loading={scanning}
                                    disabled={scanning || scanPassword.length === 0}
                                >
                                    Recover keys
                                </Button>
                            </div>
                        </>
                    ) : null}
                    {(isHwSource || isWatcherMode) && gateMissingTicks.length > 0 ? (
                        <p className={styles.warning}>
                            This signer cannot run the key recovery scan
                            ({isWatcherMode ? 'watch-only' : 'hardware'} addresses
                            hold no exportable key). Unlock keys for{' '}
                            {gateMissingTicks.join(', ')} may be lost after migration.
                        </p>
                    ) : null}
                    {gateMissingTicks.length > 0 ? (
                        <label className={styles.checkRow}>
                            <input
                                type="checkbox"
                                checked={ackMissingKeys}
                                onChange={(e) => {
                                    setAckMissingKeys(e.target.checked);
                                    clearFormError();
                                }}
                            />
                            {' '}Sweep anyway - I understand gated content for{' '}
                            {gateMissingTicks.join(', ')} may become permanently
                            unopenable in the new wallet.
                        </label>
                    ) : null}
                </div>
            ) : null}

            {!migrateLane && gatedTicks.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    {gatedTicks.map((tick) => (
                        <p key={tick} className={styles.warning}>
                            {gatedTickWarningCopy(tick, 'sweep recipients')}
                        </p>
                    ))}
                </div>
            ) : null}

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => { setMemo(e.target.value); clearFormError(); }}
                autoComplete="off"
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
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />
            {formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={confirmAction.composing}
                    // D-58: an empty destination and a zero-category
                    // selection used to disable this button, which hid the two
                    // handleReview branches that name exactly those problems
                    // and left the user with a dead button and no reason. Send
                    // errors on an empty destination rather than disabling;
                    // this now agrees. Only a missing source (already shown as
                    // its own alert above) and an in-flight compose disable it.
                    disabled={!fromAddress || confirmAction.composing}
                >
                    {!isWatcherMode ? 'Sweep' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}

function categoryCount(preview, key) {
    const cat = preview?.[key];
    if (!cat) return '…';
    if (cat.error) return 'preview unavailable';
    const n = Array.isArray(cat.rows) ? cat.rows.length : 0;
    return String(n);
}

/**
 * Compact per-category preview rows. Indicative only: capped at
 * PREVIEW_ROW_CAP with an explicit "+N more", and a category whose
 * endpoint failed says so instead of pretending emptiness.
 */
function CategoryPreview({ preview, categoryKey }) {
    const cat = preview?.[categoryKey];
    if (!cat) return null;
    if (cat.error) {
        return <p className={styles.hint}>Preview unavailable for this category; the sweep still moves it.</p>;
    }
    const rows = Array.isArray(cat.rows) ? cat.rows : [];
    if (rows.length === 0) return null;
    const shown = rows.slice(0, PREVIEW_ROW_CAP);
    return (
        <ul className={styles.hint}>
            {shown.map((r, i) => (
                <li key={i}>{describePreviewRow(categoryKey, r)}</li>
            ))}
            {rows.length > shown.length ? (
                <li>+{rows.length - shown.length} more</li>
            ) : null}
        </ul>
    );
}

function describePreviewRow(categoryKey, r) {
    switch (categoryKey) {
        case 'balances':
            // quantity is atomic units at r.divisibility scale (issue #4);
            // formatAmount divides it back to human scale for display.
            return `${formatAmount(r.quantity, r.divisibility)} ${r.tick}`;
        case 'ownerships':
            return `${r.tick} (ownership)`;
        case 'orders':
            return `Order #${r.actionIndex}${r.giveOwnership
                ? ` - escrowed ${r.giveTick || ''} ownership`.trimEnd()
                : (r.giveAmount ? ` - escrow ${r.giveAmount} ${r.giveTick || r.giveCoin || ''}`.trimEnd() : '')}`;
        case 'swaps':
            return `Swap #${r.actionIndex}${r.giveOwnership
                ? ` - escrowed ${r.giveTick || ''} ownership`.trimEnd()
                : (r.giveAmount ? ` - escrow ${r.giveAmount} ${r.giveTick || ''}`.trimEnd() : '')}`;
        case 'dispensers':
            return `Dispenser #${r.actionIndex}${r.giveOwnership
                ? ` - escrowed ${r.tick || ''} ownership`.trimEnd()
                : (r.escrowRemaining ? ` - escrow ${r.escrowRemaining} ${r.tick || ''}`.trimEnd() : '')}`;
        default:
            return '';
    }
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
