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
import { Button, Input, StatusMessage } from '@xchain-wallet/core/ui';
import { BroadcastIcon, XIcon } from '../../ui/icons/index.jsx';
// The Wallet Form Standard frame (From, main section, Network fee, one action).
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, useFormSections } from './formStandard/index.js';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { ActionConfirmScreen } from './ActionConfirmScreen.jsx';
import { ResultScreen } from './ResultScreen.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import dashStyles from '../routes/ActionsMenu.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

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
        feedActionIndex, feePerKb: fee.feePerKb, feeStop: fee.reviewStop,
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
                    summary={{
                        verb: t('components.operatorPublisherMode.publishValue'),
                        ...(feedActionIndex.trim() && submission.value.trim()
                            ? {
                                target: t('components.confirmSummary.feedValueTarget', {
                                    index: feedActionIndex.trim(),
                                    value: submission.value.trim(),
                                }),
                            }
                            : {}),
                        direction: 'none',
                        chainId,
                        address: fromAddress?.address,
                    }}
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
            chainId={chainId}
            address={address}
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
                    error: t('components.operatorPublisherMode.sourceNotInWallet'),
                });
        }).catch((err) => {
            if (!cancelled) {
                setState({
                    loading: false,
                    address: null,
                    error: userFacingMessage(err, t('components.operatorPublisherMode.sourceLoadFailed')),
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
    const reviewStop = customFeeReviewStop({ feePick: pick, tiers, estimate: customEstimate });
    return { pick, setPick, tiers, customEstimate, feePerKb, reviewStop };
}

function usePublisherSubmission({
    messaging, walletId, chainId, coinTicker, fromAddress, sourceError, feedActionIndex,
    feePerKb, feeStop,
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
        if (!fromAddress) { setError(sourceError || t('components.operatorPublisherMode.sourceStillLoading')); return; }
        const cleanFeedActionIndex = feedActionIndex.trim();
        const cleanValue = value.trim();
        if (!cleanFeedActionIndex) { setError(t('components.operatorPublisherMode.feedRequired')); return; }
        if (!/^[1-9][0-9]*$/.test(cleanFeedActionIndex)) {
            setError(t('components.operatorPublisherMode.feedWholeNumber')); return;
        }
        if (!cleanValue) { setError(t('components.operatorPublisherMode.valueRequired')); return; }
        if (!DECIMAL_NUMBER.test(cleanValue)) { setError(t('components.operatorPublisherMode.valueNumber')); return; }
        if (feeStop) { setError(feeStop.formError); return; }
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
        return <ResultScreen state="signed-not-broadcast" onDone={clearResult} what={t('components.operatorPublisherMode.oracleValue')} unsaved={result.unsaved} />;
    }
    if (result?.psbtHex && !(result.txid || result.broadcast?.txid)) {
        return <ResultScreen state="unsigned" result={result} onBuildAnother={clearResult} onDone={clearResult} />;
    }
    return null;
}

function PublisherForm({
    chainId, address,
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
                {t('components.operatorPublisherMode.publisherMode')}
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={open ? <XIcon /> : <BroadcastIcon />}
                    onClick={onToggle}
                    aria-expanded={open}
                    style={{ marginInlineStart: '0.5rem' }}
                >
                    {open ? t('components.operatorPublisherMode.leavePublisherMode') : t('components.operatorPublisherMode.enterPublisherMode')}
                </Button>
            </h3>
            <p className={dashStyles.entryDescription}>
                {t('components.operatorPublisherMode.publisherModeCreatesAnOn')} {open
                    ? t('components.operatorPublisherMode.chooseLeavePublisherModeTo')
                    : t('components.operatorPublisherMode.chooseEnterPublisherModeTo')}
            </p>
            {open ? (
                <PublisherFrame
                    chainId={chainId}
                    address={address}
                    feed={feed}
                    feedLoading={feedLoading}
                    feedError={feedError}
                    feedActionIndex={feedActionIndex}
                    onFeedActionIndex={onFeedActionIndex}
                    sourceLoading={sourceLoading}
                    sourceError={sourceError}
                    coinTicker={coinTicker}
                    fee={fee}
                    submission={submission}
                    lastTxid={lastTxid}
                />
            ) : null}
        </section>
    );
}

/**
 * The publisher form on the Form Standard: From (the operator address,
 * fixed by the dashboard, so no picker), the feed update (open), the
 * Network fee section, the status slot, one Publish action.
 */
function PublisherFrame({
    chainId, address, feed, feedLoading, feedError, feedActionIndex, onFeedActionIndex,
    sourceLoading, sourceError, coinTicker, fee, submission, lastTxid,
}) {
    const sections = useFormSections({ from: false, feed: true, fee: false });
    const busy = submission.submitting || submission.ownerLane.composing;
    const summary = [feedActionIndex.trim() ? `#${feedActionIndex.trim()}` : null, submission.value.trim() || null]
        .filter(Boolean).join(', ');
    return (
        <FormFrame
            label={t('components.operatorPublisherMode.publisherMode')}
            onSubmit={submission.submit}
            noValidate
            status={[
                sourceLoading ? (
                    <p key="source" className={dashStyles.entryDescription}>{t('components.operatorPublisherMode.loadingSourceAddress')}</p>
                ) : null,
                submission.ownerLane.isWatcherMode ? (
                    <p key="watcher" className={dashStyles.entryDescription}>
                        {t('components.operatorPublisherMode.watcherModeBuildsAnUnsigned')}
                    </p>
                ) : null,
                submission.error ? <StatusMessage key="error" variant="error">{submission.error}</StatusMessage> : null,
                lastTxid ? (
                    <p key="last" className={dashStyles.entryDescription}>
                        {t('components.operatorPublisherMode.lastPublishedTxid')} {String(lastTxid).slice(0, 16)}…
                    </p>
                ) : null,
            ]}
            action={(
                <FormAction icon={<BroadcastIcon />} loading={busy} disabled={busy}>
                    {submission.ownerLane.isWatcherMode ? t('components.placeOrderPanel.createUnsignedTransaction') : t('components.operatorPublisherMode.publishValue')}
                </FormAction>
            )}
            from={(
                <FromSection
                    {...sections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={t('components.operatorPublisherMode.networkHelp')}
                    // Null while the lookup runs, so a slow read does not open From for good.
                    address={sourceError ? null : address}
                    addressHelp={t('components.operatorPublisherMode.fromHelp')}
                    missing={!sourceLoading && sourceError ? <StatusMessage variant="error">{sourceError}</StatusMessage> : null}
                />
            )}
            fee={fee.tiers ? (
                <FeeSection
                    {...sections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={fee.tiers}
                    value={fee.pick}
                    onChange={fee.setPick}
                    customEstimate={fee.customEstimate}
                    revealKey={submission.error && fee.reviewStop && submission.error === fee.reviewStop.formError ? `fee-${submission.error}` : 0}
                />
            ) : null}
        >
            <FormSection
                id="feed"
                title={t('components.operatorPublisherMode.feedUpdate')}
                icon={BroadcastIcon}
                main
                {...sections.bind('feed')}
                summary={summary || t('components.operatorPublisherMode.noValueYet')}
            >
                <PublisherFields
                    feed={feed}
                    feedLoading={feedLoading}
                    feedError={feedError}
                    feedActionIndex={feedActionIndex}
                    onFeedActionIndex={onFeedActionIndex}
                    value={submission.value}
                    onValue={submission.setValue}
                />
            </FormSection>
        </FormFrame>
    );
}

function PublisherFields({
    feed, feedLoading, feedError, feedActionIndex, onFeedActionIndex, value, onValue,
}) {
    return (
        <>
            <Input
                label={t('components.operatorPublisherMode.feedReferenceNumber')}
                help={t('components.operatorPublisherMode.feedReferenceHelp')}
                hint={feedLoading
                    ? t('components.operatorPublisherMode.loadingFeed')
                    : feed
                        ? t('components.operatorPublisherMode.preFilledFromTheMost')
                        : t('components.operatorPublisherMode.noFeedFoundForThis')}
                value={feedActionIndex}
                onChange={(event) => onFeedActionIndex(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
            />
            <Input
                label={t('home.tabs.value')}
                help={t('components.operatorPublisherMode.theFeedValueToPublish')}
                value={value}
                onChange={(event) => onValue(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />
            {feedError ? (
                <StatusMessage variant="error">{feedError}</StatusMessage>
            ) : null}
        </>
    );
}
