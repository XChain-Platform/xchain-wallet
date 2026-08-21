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
// Deliberately NOT on the one-tap confirm modal: the item's safety
// rails are (a) every write carries ALL THREE preferences (a blank
// FEE_PREFERENCE / REQUIRE_MEMO on the wire silently reverts to default at
// the indexer), and (b) current values are RE-FETCHED when the user enters
// review, so a stale read cannot silently revert the two fields the user
// did not touch. Both rails need a review surface that shows all three
// values being written with the changed ones marked, which the generic
// decoded-action modal cannot carry (same reasoning as OracleForm/PC-30).

import { useEffect, useRef, useState, useMemo } from 'react';
import { AddressText, Button, ChainBadge, FeeSelector, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { humanizeError } from '../utils/humanizeError.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import {
    feePreferenceLabel,
    requireMemoLabel,
    dispenserPreferenceLabel,
} from '../../flows/addressPreferences.js';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId    chain of the address being configured (locked)
 * @param {string} props.address    the address whose preferences are edited (locked source; ADDRESS applies to SOURCE)
 * @param {() => void} props.onBack
 */
export function AddressPreferencesForm({ walletId, chainId: initialChainId, address, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const {
        chainId,
        addressesByChain,
        loadError,
        fromAddress,
        descriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        submit,
    } = useActionForm({
        walletId,
        action: 'ADDRESS',
        submitMethods: { hw: 'addressPreferencesActionHw', software: 'addressPreferencesAction' },
        initialChainId,
        initialFromAddress: address,
        lockedToken: true,
        noAddressMessage: 'This wallet has no addresses on this chain.',
    });

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (ADDRESS is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    const [stage, setStage] = useState(/** @type {'form'|'review'|'submitting'|'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any} */ (null));
    const [password, setPassword] = useState('');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // The three preferences as the WIRE values they will be written as.
    const [feePref, setFeePref] = useState(/** @type {'1' | '2'} */ ('2'));
    const [requireMemo, setRequireMemo] = useState(false);
    const [dispPref, setDispPref] = useState(/** @type {'1' | '2'} */ ('1'));
    const [memo, setMemo] = useState('');

    // Current on-chain values: loaded for the form prefill, then RE-FETCHED
    // at review entry (the confirm-time baseline the review compares against).
    const [current, setCurrent] = useState(/** @type {any} */ (null));
    const [currentError, setCurrentError] = useState(/** @type {string | null} */ (null));
    const [reviewBaseline, setReviewBaseline] = useState(/** @type {any} */ (null));
    const prefilled = useRef(false);

    useEffect(() => {
        let cancelled = false;
        if (!chainId || !address) return undefined;
        messaging.getAddressPreferences({ chainId, address })
            .then((prefs) => {
                if (cancelled) return;
                setCurrent(prefs);
                if (!prefilled.current) {
                    prefilled.current = true;
                    // 0 and 2 share the donate-to-protocol effect; the form
                    // writes the explicit value.
                    setFeePref(Number(prefs.feePreference) === 1 ? '1' : '2');
                    setRequireMemo(Number(prefs.requireMemo) === 1);
                    setDispPref(Number(prefs.dispenserPreference) === 2 ? '2' : '1');
                }
            })
            .catch((err) => { if (!cancelled) setCurrentError(err?.message || 'Could not load current preferences.'); });
        return () => { cancelled = true; };
    }, [messaging, chainId, address]);

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

    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });

    // Review entry re-fetches the on-chain baseline so the "unchanged" rows
    // shown are the truth at sign time, not the load-time snapshot.
    async function handleReview(event) {
        event.preventDefault();
        setFormError(null);
        try {
            const fresh = await messaging.getAddressPreferences({ chainId, address });
            setReviewBaseline(fresh);
            setStage('review');
        } catch (err) {
            setFormError('Could not re-check the current on-chain values: '
                + (err?.message || 'unknown error')
                + '. Review needs a live read, because every write resets all three preferences.');
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
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: humanizeError(err, 'address preferences').message,
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
            onBack={stage === 'review' ? () => setStage('form') : onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review preferences' : 'On-chain preferences'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    if (!addressesByChain || !chainId || !fromAddress) return wrap(<p className={styles.hint}>Loading…</p>);

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />,
            );
        }
        return wrap(
            <>
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
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const rows = writtenRows(actionParams, reviewBaseline);
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Writes all three on-chain preferences for this address in one
                    ADDRESS action. Unchanged rows are re-written with their current
                    value; the protocol has no &quot;keep current&quot; for this action.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>Address</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {rows.map((r) => (
                        <DetailRow
                            key={r.label}
                            label={r.label}
                            value={r.changed ? `${r.value} - CHANGED` : `${r.value} (unchanged)`}
                            emphasize={r.changed}
                        />
                    ))}
                    {memo.trim() ? <DetailRow label="Memo" value={memo.trim()} /> : null}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the signed
                        transaction to a Full-mode wallet to broadcast.
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
                        disabled={isWatcherMode
                            ? false
                            : (isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0))}
                    >
                        {isWatcherMode ? 'Build unsigned transaction' : 'Sign & broadcast'}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <p className={styles.hint}>
                On-chain preferences apply to <AddressText address={address} /> itself
                and are visible to the whole network once written.
            </p>
            {currentError ? (
                <StatusMessage variant="error" className={styles.error}>{currentError}</StatusMessage>
            ) : null}
            {current ? (
                <dl className={styles.detailsList}>
                    <DetailRow
                        label="Currently on chain"
                        value={current.onChain ? 'Custom preferences set' : 'Protocol defaults (never written)'}
                    />
                </dl>
            ) : null}

            <p className={styles.detailsLabel}>Protocol fee handling</p>
            <label className={styles.checkRow}>
                <input
                    type="radio"
                    name="feePref"
                    checked={feePref === '2'}
                    onChange={() => setFeePref('2')}
                />
                <span>Donate to protocol development (default)</span>
            </label>
            <label className={styles.checkRow}>
                <input
                    type="radio"
                    name="feePref"
                    checked={feePref === '1'}
                    onChange={() => setFeePref('1')}
                />
                <span>{feePreferenceLabel(1)}</span>
            </label>

            <p className={styles.detailsLabel}>Incoming sends</p>
            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={requireMemo}
                    onChange={(e) => setRequireMemo(e.target.checked)}
                />
                <span>Require a memo on any send to this address</span>
            </label>

            <p className={styles.detailsLabel}>Dispensers on this address</p>
            <label className={styles.checkRow}>
                <input
                    type="radio"
                    name="dispPref"
                    checked={dispPref === '1'}
                    onChange={() => setDispPref('1')}
                />
                <span>Only this address may open dispensers (default)</span>
            </label>
            <label className={styles.checkRow}>
                <input
                    type="radio"
                    name="dispPref"
                    checked={dispPref === '2'}
                    onChange={() => setDispPref('2')}
                />
                <span>Anyone may open a dispenser funded by this address</span>
            </label>

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
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
                <Button type="submit" variant="primary">Review</Button>
            </div>
        </form>,
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

function DetailRow({ label, value, emphasize = false }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>
                {emphasize ? <strong>{value}</strong> : value}
            </dd>
        </>
    );
}

