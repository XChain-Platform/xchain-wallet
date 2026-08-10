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
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, Icon, Input, NetworkField, PageHeader, Screen, Select, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { isDemoWallet, synthesizeDemoStaking } from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { AmountField } from '../components/AmountField.jsx';
import { formatWithThousands, countNonCommaBefore, indexAfterNonCommaCount } from '../utils/amountFormat.js';
import { coinToFiat, fiatToCoin } from '../../flows/priceLookup.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { useSettings } from '../hooks/useSettings.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
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

// Staking is denominated in XCHAIN on every chain, so the amount field and
// its fiat preview are always pricing this tick, never the chain's coin.
const STAKING_TICK = 'XCHAIN';

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

/**
 * UNSTAKE + COLLECT combined form (§42.7.2 unstake-lane +
 * §42.7.3 collect-rewards).
 *
 * One component, two modes via the `mode` prop. Both actions share a
 * chassis (address load / SignCredentials / HW branch / review / done)
 * and diverge only in which field inputs appear, which messaging
 * helper is called, and the verb rendered on the submit button.
 *
 *   - `mode: 'unstake'`: VERSION|SIGNING_PUBKEY[|AMOUNT]. Capability-
 *     staking model (capability-staking-model.md §3): UNSTAKE addresses
 *     a specific signing pubkey. AMOUNT is the  optional partial:
 *     absent = full sweep of the pubkey's active balance (original v1
 *     stake + any v2 top-ups), present = only that much enters cooldown
 *     and the residual stays staked.
 *   - `mode: 'claim-rewards'`: VERSION[|AMOUNT]. AMOUNT absent = claim
 *     all pending rewards, present = claim only that much.
 *
 * The wire form stays byte-identical to legacy when the user leaves
 * the amount at the full balance: AMOUNT is emitted only for a strict
 * partial (the indexer treats full-equals-absent as state-identical,
 * but pre-flag-day layers IGNORE a present AMOUNT, so the legacy
 * bytes are the safe encoding for a full sweep).
 *
 * @param {object} props
 * @param {'unstake' | 'claim-rewards'} props.mode
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {() => void} props.onBack
 */
export function StakingActionForm({ mode, walletId, chainId: initialChainId, onBack }) {
    // The launching position seeds the network; the standard Network
    // picker lets the user retarget the action at any chain the wallet
    // holds addresses on (the address + fee sections follow along).
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    // Only for the fiat preview: the display currency, and whether the user
    // has opted out of third-party price data (§45 / privacy.priceDataEnabled).
    const { settings } = useSettings();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isUnstake = mode === 'unstake';
    const verb = isUnstake ? 'Unstake' : 'Claim rewards';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [signingPubkey, setSigningPubkey] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

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
                // Act from the chain's active address (else newest HD
                // external), matching Send.
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this chain. Use Receive to generate one first.');
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
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Full claimable (pending rewards) or unstakeable (active stake)
    // balance for the source address; upper bound for the editable
    // Amount field ( partial claim/unstake).
    const [positions, setPositions] = useState(
        /** @type {{ stakes: any[], rewards: any[] } | null} */ (null),
    );
    useEffect(() => {
        const address = fromAddress?.address;
        if (!address) { setPositions(null); return undefined; }
        let cancelled = false;
        async function load() {
            try {
                let stakes = [];
                let rewards = [];
                if (isDemoWallet(walletId)) {
                    const demo = synthesizeDemoStaking(chainId);
                    // Demo stake rows carry no signing_pubkey; attribute them
                    // to the demo delegation's key so key prefill works.
                    const demoKey = demo.delegations[0]?.signing_pubkey;
                    stakes = demo.stakes.map((s) => ({ signing_pubkey: demoKey, ...s }));
                    rewards = demo.rewards;
                } else if (isUnstake) {
                    stakes = extractRows(await messaging.getStakesForAddress({ chainId, address }));
                } else {
                    rewards = extractRows(await messaging.getRewardsForAddress({ chainId, address }));
                }
                if (!cancelled) setPositions({ stakes, rewards });
            } catch {
                if (!cancelled) setPositions(null);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [walletId, chainId, fromAddress?.address, isUnstake, messaging]);

    // Distinct signing keys this address has staked under. The protocol
    // buckets stakes per (address, signing_pubkey), so the key selects
    // WHICH bundle an UNSTAKE returns; the wallet already knows the
    // candidates, so prefill instead of making the user paste hex.
    const stakedKeys = useMemo(() => {
        const keys = [];
        for (const s of (positions?.stakes || [])) {
            const k = s.signing_pubkey || s.SIGNING_PUBKEY;
            if (k && !keys.includes(k)) keys.push(k);
        }
        return keys;
    }, [positions]);

    useEffect(() => {
        if (isUnstake && !signingPubkey && stakedKeys.length > 0) {
            setSigningPubkey(stakedKeys[0]);
        }
    }, [isUnstake, signingPubkey, stakedKeys]);

    // Unstake: full balance for the selected key (all keys until one is
    // chosen). Claim: pending rewards for the address.
    const availableAmt = useMemo(() => {
        if (!positions) return null;
        let total = 0;
        if (isUnstake) {
            for (const s of positions.stakes) {
                const key = s.signing_pubkey || s.SIGNING_PUBKEY;
                if (signingPubkey && key && key !== signingPubkey) continue;
                const n = Number(s.amount ?? s.AMOUNT ?? s.quantity ?? 0);
                if (Number.isFinite(n)) total += n;
            }
        } else {
            for (const r of positions.rewards) {
                const status = String(r.status || '').toLowerCase();
                if (status !== 'pending' && status !== 'unclaimed') continue;
                const n = Number(r.amount ?? r.reward ?? 0);
                if (Number.isFinite(n)) total += n;
            }
        }
        return total;
    }, [positions, isUnstake, signingPubkey]);

    // Prefill with the full balance (the common case is still "take it
    // all"), but stop overwriting once the user edits: a positions
    // refresh or key switch must not clobber a typed partial amount.
    const [amount, setAmount] = useState('');
    const amountTouchedRef = useRef(false);
    useEffect(() => {
        if (amountTouchedRef.current) return;
        setAmount(availableAmt != null ? String(availableAmt) : '');
    }, [availableAmt]);

    // §29.3 fiat preview + toggle, same wiring as Send. The canonical
    // `amount` stays coin-scale; fiat mode only changes the display.
    // The amount here is XCHAIN, so the rate has to be XCHAIN's own
    // : the chain coin's rate would price a stake of 50,000
    // XCHAIN as if it were 50,000 BTC. `useTickFiatRate` sources the
    // XCHAIN/USD oracle pair and returns null when nothing can price
    // it, which is AmountField's "hide the toggle and the ≈ preview".
    const fiatRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick: STAKING_TICK,
        nativeTicker: descriptor?.coin ? tickerForCoin(descriptor.coin) : null,
        fiatCurrency: settings?.fiatCurrency || 'USD',
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
    });
    const [amountInputMode, setAmountInputMode] = useState(/** @type {'coin' | 'fiat'} */ ('coin'));
    const [fiatAmount, setFiatAmount] = useState('');
    const toggleAmountInputMode = useCallback(() => {
        if (!fiatRate) return;
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const fv = amount ? coinToFiat(amount, fiatRate) : null;
                setFiatAmount(fv != null ? fv.toFixed(2) : '');
                return 'fiat';
            }
            setFiatAmount('');
            return 'coin';
        });
    }, [amount, fiatRate]);

    // A rate can go away mid-edit (chain switched, feed went quiet), which
    // would strand the field in a mode it can no longer convert.
    useEffect(() => {
        if (!fiatRate && amountInputMode === 'fiat') {
            setAmountInputMode('coin');
            setFiatAmount('');
        }
    }, [fiatRate, amountInputMode]);

    // Same comma/cursor handling as Send: commas are formatting only,
    // strip before storing, then map the caret by "non-comma chars to
    // the left" so typing across a thousands boundary doesn't fling it.
    const amountInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onAmountFieldChange = useCallback((rawValue, cursorPos) => {
        const stripped = String(rawValue).replace(/,/g, '');
        // Valid partial decimals only ("" / "." / "1." stay allowed).
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        amountTouchedRef.current = true;
        // In fiat mode the typed text is fiat and the canonical `amount`
        // (what gets broadcast, and what the available-balance check reads)
        // is derived from it. Writing the typed number straight into
        // `amount` would stake a dollar figure as if it were XCHAIN.
        if (amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            if (!fiatRate) {
                if (stripped === '') setAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, fiatRate);
                setAmount(derivedCoin != null ? derivedCoin : '');
            }
        } else {
            setAmount(stripped);
        }
        if (typeof cursorPos === 'number' && amountInputRef.current) {
            const formattedNew = formatWithThousands(stripped);
            const nonCommaBefore = countNonCommaBefore(String(rawValue), cursorPos);
            const nextCursor = indexAfterNonCommaCount(formattedNew, nonCommaBefore);
            const el = amountInputRef.current;
            requestAnimationFrame(() => {
                if (el && document.activeElement === el) {
                    try { el.setSelectionRange(nextCursor, nextCursor); } catch { /* selection unavailable on some input types */ }
                }
            });
        }
    }, [amountInputMode, fiatRate]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
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
        software: isUnstake ? 'unstakeAction' : 'collectAction',
        hardware: isUnstake ? 'unstakeActionHw' : 'collectActionHw',
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
                actionData: { action: isUnstake ? 'UNSTAKE' : 'COLLECT', params: actionParams },
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
            setFormError(err?.message || (verb + ' failed.'));
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

    // Emit AMOUNT only for a strict partial; a full-balance (or
    // unknown-balance) submit keeps the legacy absent-AMOUNT bytes
    // (see the header note on the  wire policy).
    const isPartial = useMemo(() => {
        const n = Number(String(amount).replace(/,/g, ''));
        return Number.isFinite(n) && n > 0 && availableAmt != null && n < availableAmt;
    }, [amount, availableAmt]);

    const actionParams = useMemo(() => {
        const base = isUnstake
            ? { VERSION: '0', SIGNING_PUBKEY: signingPubkey.trim().toLowerCase() }
            : { VERSION: '0' };
        if (isPartial) return { ...base, AMOUNT: String(amount).replace(/,/g, '').trim() };
        return base;
    }, [isUnstake, signingPubkey, isPartial, amount]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        if (isUnstake) {
            const pk = signingPubkey.trim();
            if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
                setFormError('Signing pubkey must be exactly 64 hex characters.');
                return;
            }
        }
        const amtN = Number(String(amount).replace(/,/g, ''));
        if (!amount || !Number.isFinite(amtN) || amtN <= 0) {
            setFormError('Amount must be greater than zero.');
            return;
        }
        if (availableAmt != null && amtN > availableAmt) {
            setFormError(`Amount exceeds the ${formatWithThousands(String(availableAmt))} XCHAIN available.`);
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
                const action = isUnstake ? 'UNSTAKE' : 'COLLECT';
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params: actionParams },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else {
                const fn = isUnstake
                    ? (isHwSource ? messaging.unstakeActionHw : messaging.unstakeAction)
                    : (isHwSource ? messaging.collectActionHw : messaging.collectAction);
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
                isBadPassword ? 'Incorrect password.' : err?.message || (verb + ' failed.'),
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
                    ? `Review ${verb.toLowerCase()}`
                    : verb}
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            </>,
        );
    }
    if (!addressesByChain) return wrap(<p>Loading addresses…</p>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // : a queued result is SIGNED and not broadcast. The confirm
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
                    {isUnstake
                        ? 'Unstake broadcast. The network will return your staked XCHAIN after the on-chain confirmation window.'
                        : 'Claim broadcast. Pending rewards will be credited after the network records the action.'}
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
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {isUnstake
                        ? (isPartial
                            ? `Unstake ${formatWithThousands(actionParams.AMOUNT)} XCHAIN from signing pubkey ${actionParams.SIGNING_PUBKEY.slice(0, 12)}. The rest stays staked; the unstaked amount is returned after the cooldown.`
                            : `Unstake signing pubkey ${actionParams.SIGNING_PUBKEY.slice(0, 12)}. The full active balance for this pubkey is returned after the cooldown.`)
                        : (isPartial
                            ? `Claim ${formatWithThousands(actionParams.AMOUNT)} XCHAIN of the pending staking rewards for this address; the rest stays pending.`
                            : 'Claim all pending staking rewards for this address.')}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Amount</dt>
                    <dd className={styles.detailsValue}>
                        {isPartial
                            ? `${formatWithThousands(actionParams.AMOUNT)} XCHAIN`
                            : `${availableAmt != null ? formatWithThousands(String(availableAmt)) : 'All'} XCHAIN (full ${isUnstake ? 'balance' : 'pending rewards'})`}
                    </dd>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {isUnstake ? (
                        <>
                            <dt className={styles.detailsLabel}>Signing pubkey</dt>
                            <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {actionParams.SIGNING_PUBKEY}
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                </dl>
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
                                : verb}
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
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField
                value={chainId}
                onChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
                chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
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
            ) : null}

            <AmountField
                label="Amount"
                amount={amount}
                fiatAmount={fiatAmount}
                tick="XCHAIN"
                fiatRate={fiatRate}
                amountInputMode={amountInputMode}
                toggleAmountInputMode={toggleAmountInputMode}
                onAmountFieldChange={onAmountFieldChange}
                inputRef={amountInputRef}
                onMax={() => setAmount(availableAmt != null ? String(availableAmt) : '')}
                maxDisabled={availableAmt == null}
                balanceText={availableAmt != null
                    ? `${formatWithThousands(String(availableAmt))} XCHAIN available`
                    : 'Loading…'}
            />

            {isUnstake ? (
                <>
                    <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem', color: 'var(--muted, #666)' }}>
                        The amount you choose enters the cooldown and is returned after it; anything left stays staked under the signing key below.
                    </p>
                    {stakedKeys.length > 1 ? (
                        <Select
                            label="Staked signing key"
                            value={stakedKeys.includes(signingPubkey) ? signingPubkey : ''}
                            onChange={(e) => setSigningPubkey(e.target.value)}
                            hint="This address has stakes under more than one signing key; pick which one to unstake."
                        >
                            {stakedKeys.map((k) => (
                                <option key={k} value={k}>{`${k.slice(0, 10)}…${k.slice(-8)}`}</option>
                            ))}
                        </Select>
                    ) : null}
                    <Input
                        label="Signing public key"
                        hint={stakedKeys.length > 0
                            ? 'Filled in from your stake; edit only if you staked with a different key.'
                            : '64-character hex-encoded Ed25519 public key (the same one used to stake).'}
                        value={signingPubkey}
                        onChange={(e) => setSigningPubkey(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                </>
            ) : (
                <p style={{ fontSize: '0.9rem', color: 'var(--muted, #666)' }}>
                    Claimed rewards land in your balance, and rewards continue to accrue after the claim. Any amount you leave unclaimed stays pending.
                </p>
            )}

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
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || actionConfirm.composing}
                >
                    {singleEncode ? verb : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
