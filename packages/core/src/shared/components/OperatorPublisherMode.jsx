// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, FeeSelector, Input, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { ActionConfirmScreen } from './ActionConfirmScreen.jsx';
import { QueuedResultPanel } from './QueuedResultPanel.jsx';
import { WatcherResultPanel } from './WatcherResultPanel.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import dashStyles from '../routes/ActionsMenu.module.css';
import formStyles from '../routes/IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const SECTION_STYLE = {
    margin: '0.75rem 0',
    paddingTop: '0.5rem',
    borderTop: '1px solid var(--border, #ddd)',
};

/**
 * Inline v3 BROADCAST quick-compose. Pre-fills BROADCAST_ACTION_INDEX
 * from the address's most recent v2 feed-create, leaving the user a
 * single VALUE input for rapid successive updates.
 *
 * Each signed update passes through the shared confirm page and its
 * network dry run. Watcher mode produces an unsigned transaction.
 *
 * @param {object} props
 */
export function OperatorPublisherMode(props) {
    const scopeKey = JSON.stringify([props.walletId, props.chainId, props.address]);
    return <OperatorPublisherModeView key={scopeKey} {...props} />;
}

function OperatorPublisherModeView({
    walletId, chainId, address, feed, feedLoading = false, feedError = null, messaging, variant,
}) {
    const [open, setOpen] = useState(false);
    const [feedActionIndex, setFeedActionIndex] = useState('');
    const feedActionIndexEdited = useRef(false);
    const feedActionIndexSeed = feed?.action_index ?? feed?.ACTION_INDEX ?? '';
    const feedSeedKey = JSON.stringify([walletId, chainId, address, feedActionIndexSeed]);
    const seededFeedRef = useRef(null);
    useEffect(() => {
        if (feedSeedKey === seededFeedRef.current) return;
        seededFeedRef.current = feedSeedKey;
        if (!feedActionIndexEdited.current) setFeedActionIndex(String(feedActionIndexSeed));
    }, [feedActionIndexSeed, feedSeedKey]);

    const source = usePublisherAddress({ messaging, walletId, chainId, address });
    const fromAddress = source.address;
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor
        ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor.coin] || '')
        : '';
    const signerReady = useSignerReady(walletId);
    const fee = usePublisherFee(chainId);
    const submission = usePublisherSubmission({
        messaging, walletId, chainId, coinTicker, fromAddress, sourceError: source.error,
        feedActionIndex, feePerKb: fee.feePerKb, feeValidationError: fee.validationError,
    });
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: submission.ownerLane.hw ? fromAddress?.signerId : null,
    });

    if (submission.ownerLane.open) {
        return (
            <section style={SECTION_STYLE}>
                <ActionConfirmScreen
                    {...submission.ownerLane.confirmProps}
                    walletId={walletId}
                    screenVariant={variant}
                    chainLabel={descriptor?.displayName || chainId}
                    coinTicker={coinTicker}
                    signerReady={signerReady}
                    hwSignerInfo={hwSignerInfo}
                    hintClassName={dashStyles.entryDescription}
                />
            </section>
        );
    }
    const resultPanel = publisherResultPanel(submission.result, submission.clearResult);
    if (resultPanel) return <section style={SECTION_STYLE}>{resultPanel}</section>;

    return (
        <PublisherForm
            open={open}
            onToggle={() => setOpen((shown) => !shown)}
            feed={feed}
            feedLoading={feedLoading}
            feedError={feedError}
            feedActionIndex={feedActionIndex}
            onFeedActionIndex={(value) => {
                feedActionIndexEdited.current = true;
                setFeedActionIndex(value);
            }}
            sourceLoading={source.loading}
            sourceError={source.error}
            coinTicker={coinTicker}
            fee={fee}
            submission={submission}
        />
    );
}

function usePublisherAddress({ messaging, walletId, chainId, address }) {
    const [state, setState] = useState({ loading: true, address: null, error: null });
    useEffect(() => {
        let cancelled = false;
        setState({ loading: true, address: null, error: null });
        Promise.resolve().then(() => messaging.getAddressesByChain(walletId)).then((byChain) => {
            if (cancelled) return;
            const match = (byChain?.[chainId] || []).find((item) => item.address === address);
            setState(match
                ? { loading: false, address: match, error: null }
                : {
                    loading: false,
                    address: null,
                    error: 'This wallet does not contain the source address on this network.',
                });
        }).catch((err) => {
            if (!cancelled) {
                setState({
                    loading: false,
                    address: null,
                    error: userFacingMessage(err, "Couldn't load the source address. Try again."),
                });
            }
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, address, messaging]);
    return state;
}

function usePublisherFee(chainId) {
    const [pick, setPick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const tiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const customEstimate = useMemo(
        () => (pick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(pick.customRate) || 0 })
            : null),
        [chainId, pick],
    );
    const estimate = pick.mode === 'custom'
        ? customEstimate
        : (tiers ? tiers[pick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: pick.mode }));
    const feePerKb = (estimate?.unit && Number.isFinite(estimate.rateValue) && estimate.rateValue > 0)
        ? displayRateToSettingsCustom(estimate.unit, estimate.rateValue)
        : null;
    const validationError = pick.mode !== 'custom' || feePerKb !== null
        ? null
        : Number(pick.customRate) > 0
            ? 'Custom fee rate can have at most 8 decimal places.'
            : 'Custom fee rate must be greater than zero.';
    return { pick, setPick, tiers, customEstimate, feePerKb, validationError };
}

function usePublisherSubmission({
    messaging, walletId, chainId, coinTicker, fromAddress, sourceError, feedActionIndex,
    feePerKb, feeValidationError,
}) {
    const [value, setValue] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const nativeFee = useNativeFee(chainId);
    const ownerLane = useOwnerActionLane({
        messaging, walletId, chainId, owner: fromAddress,
        software: 'broadcastAction', hardware: 'broadcastActionHw',
    });

    async function submit(event) {
        event.preventDefault();
        if (submitting || ownerLane.composing) return;
        if (!fromAddress) { setError(sourceError || 'Source address is still loading.'); return; }
        const cleanFeedActionIndex = feedActionIndex.trim();
        const cleanValue = value.trim();
        if (!cleanFeedActionIndex) { setError('Feed reference number is required.'); return; }
        if (!/^[1-9][0-9]*$/.test(cleanFeedActionIndex)) {
            setError('Feed reference number must be a positive whole number.'); return;
        }
        if (!cleanValue) { setError('Value is required.'); return; }
        if (!DECIMAL_NUMBER.test(cleanValue)) { setError('Value must be a number.'); return; }
        if (feeValidationError) { setError(feeValidationError); return; }
        setSubmitting(true);
        setError(null);
        const params = {
            VERSION: '3', BROADCAST_ACTION_INDEX: cleanFeedActionIndex, VALUE: cleanValue,
        };
        try {
            const next = await ownerLane.run({
                actionData: { action: 'BROADCAST', params },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                submitExtra: { params },
            });
            setResult(next || {});
            setValue('');
        } catch (err) {
            if (!isUserRejection(err)) {
                setError(err?.name === 'InvalidPasswordError'
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Publish failed.',
                    }));
            }
        } finally {
            setSubmitting(false);
        }
    }

    return { value, setValue, submitting, error, result, clearResult: () => setResult(null), ownerLane, submit };
}

function publisherResultPanel(result, clearResult) {
    if (result?.queued) {
        return <QueuedResultPanel onDone={clearResult} what="oracle value" unsaved={result.unsaved} />;
    }
    if (result?.psbtHex && !(result.txid || result.broadcast?.txid)) {
        return <WatcherResultPanel result={result} onBuildAnother={clearResult} onDone={clearResult} />;
    }
    return null;
}

function PublisherForm({
    open, onToggle, feed, feedLoading, feedError, feedActionIndex, onFeedActionIndex,
    sourceLoading, sourceError, coinTicker, fee, submission,
}) {
    const lastTxid = submission.result?.txid
        || submission.result?.broadcast?.txid
        || submission.result?.tx_hash
        || null;
    return (
        <section style={SECTION_STYLE}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.25rem' }}>
                Publisher mode
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    style={{ marginInlineStart: '0.5rem', fontSize: '0.85rem' }}
                >
                    {open ? 'Leave publisher mode' : 'Enter publisher mode'}
                </button>
            </h3>
            <p className={dashStyles.entryDescription}>
                Publisher mode creates an on-chain update of the selected feed reference with the value you enter. You review each update before it is signed and sent. {open
                    ? 'Choose Leave publisher mode to close the form and return to the dashboard.'
                    : 'Choose Enter publisher mode to open the form.'}
            </p>
            {open ? (
                <form onSubmit={submission.submit} noValidate>
                    <PublisherFields
                        feed={feed}
                        feedLoading={feedLoading}
                        feedError={feedError}
                        feedActionIndex={feedActionIndex}
                        onFeedActionIndex={onFeedActionIndex}
                        sourceLoading={sourceLoading}
                        sourceError={sourceError}
                        value={submission.value}
                        onValue={submission.setValue}
                    />
                    <PublisherControls coinTicker={coinTicker} fee={fee} submission={submission} lastTxid={lastTxid} />
                </form>
            ) : null}
        </section>
    );
}

function PublisherFields({
    feed, feedLoading, feedError, feedActionIndex, onFeedActionIndex,
    sourceLoading, sourceError, value, onValue,
}) {
    return (
        <>
            <Input
                label="Feed reference number"
                hint={feedLoading
                    ? 'Loading the most recent feed for this address.'
                    : feed
                        ? 'Pre-filled from the most recent feed you created. Override it to publish to a different feed.'
                        : 'No feed found for this address. Enter its reference number, or create a feed first.'}
                value={feedActionIndex}
                onChange={(event) => onFeedActionIndex(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
            />
            <Input
                label="Value"
                hint="The feed value to publish. The previous value clears on success; the next value is one keystroke away."
                value={value}
                onChange={(event) => onValue(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />
            {feedError ? (
                <StatusMessage variant="error" className={formStyles.error}>{feedError}</StatusMessage>
            ) : null}
            {sourceLoading ? <p className={dashStyles.entryDescription}>Loading source address…</p> : null}
            {!sourceLoading && sourceError ? (
                <StatusMessage variant="error" className={formStyles.error}>{sourceError}</StatusMessage>
            ) : null}
        </>
    );
}

function PublisherControls({ coinTicker, fee, submission, lastTxid }) {
    const busy = submission.submitting || submission.ownerLane.composing;
    return (
        <>
            {fee.tiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={coinTicker}
                    tiers={fee.tiers}
                    value={fee.pick}
                    onChange={fee.setPick}
                    customEstimate={fee.pick.mode === 'custom' ? fee.customEstimate : null}
                />
            ) : null}
            {submission.ownerLane.isWatcherMode ? (
                <p className={dashStyles.entryDescription}>
                    Watcher mode builds an unsigned transaction for a Signer-mode wallet.
                </p>
            ) : null}
            {submission.error ? (
                <StatusMessage variant="error" className={formStyles.error}>{submission.error}</StatusMessage>
            ) : null}
            {lastTxid ? (
                <p className={dashStyles.entryDescription}>
                    Last published: txid {String(lastTxid).slice(0, 16)}…
                </p>
            ) : null}
            <div className={formStyles.actions}>
                <Button type="submit" variant="primary" loading={busy} disabled={busy}>
                    {submission.ownerLane.isWatcherMode ? 'Create unsigned transaction' : 'Publish value'}
                </Button>
            </div>
        </>
    );
}
