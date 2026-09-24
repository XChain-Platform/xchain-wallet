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
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, Input, NetworkField, PageHeader, Screen, Select, StatusMessage } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { humanizeError } from '../utils/humanizeError.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { tickerForCoin, isProtocolCoinTicker } from '../../registry/coinTicker.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import {
    quoteDeviationPct,
    activationCountdownText,
} from '../../flows/oracleQueries.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// The chains a quote's COIN may name. COIN is the priced token's chain, not
// the publishing chain: a DOGE transaction may publish a BTC token's price.
const PRICE_COINS = Array.from(new Set(chainRegistry.coins().map(tickerForCoin)))
    .filter(isProtocolCoinTicker);

const UNCHECKED_CONSUMERS = Object.freeze({ supported: false, dispensers: Object.freeze([]) });

// The 12 fiats the protocol prices in (xchain-indexer config FIATS, mirrored
// in the SDK's VALID_FIAT_CODES). A publish naming anything else is rejected
// on chain with 'invalid: FIAT (unsupported)'.
const FIAT_CODES = ['USD', 'CAD', 'AUD', 'MXN', 'GBP', 'JPY', 'CNY', 'CHF', 'BRL', 'INR', 'EUR', 'KRW'];

// Above this move against the publisher's own last published price, the
// republish needs a typed confirm. The basis is deliberately their own prior
// on-chain value: the wallet has no trustworthy outside price for an arbitrary
// token, and putting a third-party feed in front of a consensus input would be
// worse than the fat-finger it is trying to catch. Chosen high enough that
// ordinary repricing does not train people to type through it.
const DEVIATION_TYPED_CONFIRM_PCT = 25;

function fmtPct(pct) {
    if (pct == null) return null;
    const rounded = Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    return `${pct > 0 ? '+' : ''}${rounded}%`;
}

/**
 * "My oracle" surface (PC-30): publish and manage PRICE v1 quotes.
 *
 * A PRICE v1 oracle prices a TOKEN in a fiat currency. Oracle-priced
 * (Mode B) dispensers cross-convert that quote through the validator
 * federation's COIN/FIAT snapshot, so a buyer can trigger a dispense with a
 * bare coin payment and no XChain transaction of their own. Publishing is
 * permissionless and unstaked; the publisher earns the usage fee,
 * paid up front in coin by whoever opens a dispenser against this address.
 *
 * Three things make this riskier than it looks, and the screen is built
 * around them:
 *
 *   - A publish is inert for 24 hours and cannot be retracted in that
 *     window. The soonest correction is another publish, which also
 *     matures a day later.
 *   - Consumers settle real money against whatever matures. The form lists
 *     the dispensers currently pointing here before the signature.
 *   - A fat-fingered decimal is indistinguishable from a repricing, so a
 *     move over DEVIATION_TYPED_CONFIRM_PCT against the publisher's own
 *     last price takes a typed confirm.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {string} [props.initialTick]
 */
export function OracleForm({ walletId, onBack, initialChainId, initialFromAddress, initialTick }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const {
        addressesByChain,
        loadError,
        chainId,
        setChainId,
        chainsWithAddresses,
        fromAddress,
        setFromAddressId,
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
        action: 'PRICE',
        submitMethods: { hw: 'oraclePriceActionHw', software: 'oraclePriceAction' },
        initialChainId,
        initialFromAddress,
        noAddressMessage:
            'No addresses on any chain yet. Use Receive to generate one first.',
    });

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (PRICE is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // Empty until the user picks, so the quote's COIN follows the publishing
    // chain by default and keeps following it across a chain switch.
    const [coinPick, setCoinPick] = useState('');
    const priceCoin = coinPick || coinTicker;
    const crossChain = !!(priceCoin && coinTicker && priceCoin !== coinTicker);
    const [ticker, setTicker] = useState((initialTick || '').toUpperCase());
    const [fiat, setFiat] = useState('USD');
    const [value, setValue] = useState('');
    const [fee, setFee] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [typedConfirm, setTypedConfirm] = useState('');

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));

    // Feeds this address already publishes. Reloaded after a successful
    // publish so the new quote shows up in its pending state rather than
    // leaving the operator to guess whether it landed.
    const [feeds, setFeeds] = useState(/** @type {any[] | null} */ (null));
    const [feedsError, setFeedsError] = useState(/** @type {string | null} */ (null));
    const [reloadToken, setReloadToken] = useState(0);
    const oracleAddress = fromAddress?.address || null;

    useEffect(() => {
        if (!chainId || !oracleAddress) { setFeeds(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.oracleFeeds !== 'function') { setFeeds([]); return undefined; }
        let cancelled = false;
        setFeedsError(null);
        messaging.oracleFeeds({ chainId, address: oracleAddress })
            .then((f) => { if (!cancelled) setFeeds(Array.isArray(f) ? f : []); })
            .catch((err) => {
                if (cancelled) return;
                setFeeds([]);
                setFeedsError(humanizeError(err, 'load your published prices').message);
            });
        return () => { cancelled = true; };
    }, [chainId, oracleAddress, messaging, walletId, reloadToken]);

    // Dispensers priced by this address. `supported: false` means the lane
    // could not be queried at all, which must not read as "none": an
    // operator who sees "no dispensers" and republishes on that basis has
    // been told something the wallet never verified.
    const [consumers, setConsumers] = useState(
        /** @type {{ supported: boolean, dispensers: any[] } | null} */ (null),
    );
    useEffect(() => {
        if (!chainId || !oracleAddress) { setConsumers(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.oracleConsumers !== 'function') {
            setConsumers({ supported: false, dispensers: [] });
            return undefined;
        }
        let cancelled = false;
        messaging.oracleConsumers({ chainId, address: oracleAddress })
            .then((c) => { if (!cancelled) setConsumers(c || { supported: false, dispensers: [] }); })
            .catch(() => { if (!cancelled) setConsumers({ supported: false, dispensers: [] }); });
        return () => { cancelled = true; };
    }, [chainId, oracleAddress, messaging, walletId, reloadToken]);

    const tick = ticker.trim().toUpperCase();
    const currentFeed = useMemo(() => {
        if (!feeds || !tick || !priceCoin) return null;
        const key = `${priceCoin}/${tick}/${fiat}`;
        return feeds.find((f) => f.key === key) || null;
    }, [feeds, tick, fiat, priceCoin]);

    // "Prior published value" for the deviation check is the newest quote on
    // this pair, pending included. A pending row is what the pair is about to
    // be worth, so comparing against the older live one would understate a
    // second correction made inside the same 24h window.
    const priorQuote = currentFeed ? (currentFeed.pending || currentFeed.live) : null;
    const isFirstPublish = !currentFeed;
    // The deviation basis may be a quote still maturing, and nothing sells at
    // a pending price, so the wording must not call it current.
    const hasLiveQuote = !!currentFeed?.live;
    const priorLabel = priorQuote && priorQuote === currentFeed?.pending ? 'Pending price' : 'Current price';
    const deviationPct = quoteDeviationPct(priorQuote?.value, value.trim());
    const needsTypedConfirm = deviationPct != null
        && Math.abs(deviationPct) > DEVIATION_TYPED_CONFIRM_PCT;
    const typedConfirmOk = !needsTypedConfirm || typedConfirm.trim().toUpperCase() === 'PUBLISH';

    // Consumers of the exact pair being republished, which is the set that
    // actually reprices. Dispensers on this address's other feeds are
    // unaffected and would be noise on the confirm screen.
    // The lookup reads the publishing chain's dispensers only. A quote for
    // another chain's token is read by dispensers on THAT chain, so an empty
    // answer here would be an all-clear nobody checked.
    const consumerView = crossChain ? UNCHECKED_CONSUMERS : consumers;
    const pairConsumers = useMemo(() => {
        if (!consumerView?.supported || !tick) return [];
        return consumerView.dispensers.filter((d) => String(d.give_tick || '').toUpperCase() === tick);
    }, [consumerView, tick]);

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom' ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 }) : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '1' };
        if (priceCoin) p.COIN = priceCoin;
        if (tick) p.TICK = tick;
        if (fiat) p.FIAT = fiat;
        const v = value.trim();
        if (v) p.VALUE = v;
        const f = fee.trim();
        if (f) p.FEE = f;
        const m = memo.trim();
        if (m) p.MEMO = m;
        return p;
    }, [priceCoin, tick, fiat, value, fee, memo]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'PRICE', params: actionParams, chainId: chainId || undefined, chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    const prefillFromFeed = useCallback((feed) => {
        setCoinPick(feed.coin && feed.coin !== coinTicker ? feed.coin : '');
        setTicker(feed.tick);
        setFiat(feed.fiat);
        const source = feed.pending || feed.live;
        setValue(source?.value ? String(source.value) : '');
        setFee(source?.fee ? String(source.fee) : '');
        setFormError(null);
    }, [coinTicker]);

    function guardBeforeSign() {
        if (!chainId || !fromAddress) { setFormError('Pick a publishing address first.'); return false; }
        if (!tick) { setFormError('Enter the token ticker this oracle prices.'); return false; }
        if (!FIAT_CODES.includes(fiat)) { setFormError('Pick a supported currency.'); return false; }
        const v = value.trim();
        if (!/^[0-9]+(\.[0-9]{1,8})?$/.test(v) || Number(v) <= 0) {
            setFormError('Enter a positive price with at most 8 decimal places.');
            return false;
        }
        const f = fee.trim();
        if (f.length > 0 && (!/^[0-9]+(\.[0-9]{1,18})?$/.test(f) || Number(f) > 1)) {
            setFormError('The usage fee is a fraction between 0 and 1 (0.01 = 1%).');
            return false;
        }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) { setFormError('Memo cannot contain "|" or ";".'); return false; }
        return true;
    }

    // Sign through the shared confirm page, so the network pre-flight runs
    // before a price nobody can withdraw for 24 hours. Watcher mode never
    // signs, so it keeps the local review stage and builds an unsigned tx.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // Approve reads the ref, so it signs with the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    async function openConfirm() {
        const from = buildFrom();
        if (!chainId || !from) return;
        const params = actionParams;
        const feeOpts = { payFeeInNativeCoin: nativeFee.flag, ...(feePerKb != null ? { feePerKb } : {}) };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'PRICE', params },
                encoderOpts: feeOpts,
                // useActionForm's dispatch picks the software or device lane and
                // records the last-used chain; prebuiltPsbt pins the signed bytes.
                onApprove: (prebuiltPsbt) => submit({
                    params,
                    password: passwordValueRef.current,
                    extraBase: { ...feeOpts, prebuiltPsbt },
                }),
            });
            setResult(res);
            setPassword('');
            setReloadToken((t) => t + 1);
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Publishing the price failed.',
            }));
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!guardBeforeSign()) return;
        setFormError(null);
        setTypedConfirm('');
        if (!isWatcherMode) { openConfirm(); return; }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({ walletId, signerId: isHwSource ? fromAddress?.signerId : null });

    // Watcher lane only: encode an unsigned PRICE for a Signer-mode wallet.
    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!typedConfirmOk) return;
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
            setReloadToken((t) => t + 1);
            setStage('done');
        } catch (err) {
            setSubmitError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Publishing the price failed.',
            }));
            setStage('review');
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review price publish' : 'My oracle'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    // The oracle-only facts that must sit in front of the signature on both
    // lanes: the 24h rail, the deviation gate and the dispensers that reprice.
    const publishNotes = (
        <OraclePublishNotes
            isFirstPublish={isFirstPublish}
            hasLiveQuote={hasLiveQuote}
            priorQuote={priorQuote}
            priorLabel={priorLabel}
            fiat={fiat}
            tick={tick}
            deviationPct={deviationPct}
            needsTypedConfirm={needsTypedConfirm}
            typedConfirm={typedConfirm}
            onTypedConfirmChange={setTypedConfirm}
            consumers={consumerView}
            pairConsumers={pairConsumers}
            crossChain={crossChain}
            priceCoin={priceCoin}
        />
    );

    if (loadError) return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    if (!addressesByChain || !chainId) return wrap(<p className={styles.hint}>Loading…</p>);

    if (actionConfirm.open) {
        const credsReady = isHwSource ? hwStatus === 'available' : (signerReady || password.length > 0);
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                coinTicker={coinTicker}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // Approve also waits on the typed PUBLISH when the move is large.
                credentialsReady={typedConfirmOk && credsReady}
                extraCredentials={publishNotes}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        // Signed but not broadcast yet: nothing is priced, so no success copy.
        if (result?.queued) return wrap(<QueuedResultPanel onDone={onBack} what="price publish" />);
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />);
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Price publish broadcast</h2>
                <p className={styles.hint}>
                    {tick} = {value.trim()} {fiat} starts pricing dispensers 24 hours after this
                    transaction confirms. Until then the previous price (if any) stays in effect.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="secondary" onClick={handleBuildAnother}>Publish another</Button>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>Publishing as</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    {/* The decoder's rows, so Memo and the fee as a percent show
                        here exactly as they will on any other confirm surface. */}
                    {(decoded?.details || []).map((d) => <DetailRow key={d.label} label={d.label} value={d.value} />)}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}` : 'Estimate unavailable'}
                    />
                </dl>

                {publishNotes}

                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => <p key={i} className={styles.warning}>{w}</p>)}
                    </div>
                ) : null}

                <p className={styles.hint}>
                    Watcher mode: this wallet will build an unsigned transaction. Sign it on your
                    Signer-mode wallet, then broadcast from a Full-mode wallet.
                </p>
                {submitError ? <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage> : null}

                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant={needsTypedConfirm ? 'danger' : 'primary'}
                        loading={stage === 'submitting'}
                        disabled={!typedConfirmOk}
                    >
                        Create unsigned transaction
                    </Button>
                </div>
            </form>,
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Publishing address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Counts only this chain's own-coin feeds, for the same reason as consumerView.
    const consumerCountFor = (feed) => {
        if (!consumers?.supported || feed.coin !== coinTicker) return null;
        return consumers.dispensers.filter(
            (d) => String(d.give_tick || '').toUpperCase() === String(feed.tick).toUpperCase(),
        ).length;
    };

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <p className={styles.hint}>
                An oracle publishes what one unit of a token is worth in a traditional currency.
                Dispensers can then price in that currency, and a buyer pays in {priceCoin || 'the chain coin'} at
                the going rate. Anyone can run one; whoever opens a dispenser against your oracle
                pays you the usage fee you set below.
            </p>

            {/*
              * Pick the PUBLISHING chain: it decides which address signs, pays
              * the fee and becomes the oracle's identity. The priced token's
              * chain is the separate COIN field below, and dispensers on any
              * chain may read this oracle, so the two need not match.
              */}
            <NetworkField
                value={chainId}
                onChange={setChainId}
                chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                chainRegistry={chainRegistry}
            />

            {fromAddress ? (
                <AddressField
                    label="Publishing address (this is your oracle's identity)"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose publishing address"
                />
            ) : (
                <StatusMessage variant="error" className={styles.error}>No address on this chain. Use Receive to generate one first.</StatusMessage>
            )}

            <p className={styles.successLabel}>My published prices</p>
            {feeds == null ? (
                <p className={styles.hint}>Loading…</p>
            ) : feeds.length === 0 ? (
                <p className={styles.hint}>
                    This address has not published any prices yet. The first one you publish starts
                    pricing 24 hours later.
                </p>
            ) : (
                <ul>
                    {feeds.map((f) => {
                        const countdown = activationCountdownText(f.pending?.secondsUntilEffective);
                        const count = consumerCountFor(f);
                        return (
                            <li key={f.key} className={styles.hint}>
                                <button type="button" onClick={() => prefillFromFeed(f)}>
                                    {f.coin && f.coin !== coinTicker ? `${f.coin}:` : ''}{f.tick} in {f.fiat}
                                </button>
                                {': '}
                                {f.live
                                    ? `${f.live.value} ${f.fiat} live`
                                    : 'nothing live yet'}
                                {f.pending
                                    ? `, ${f.pending.value} ${f.fiat} starts in ${countdown || 'moments'}`
                                    : ''}
                                {f.live?.fee ? ` · fee ${f.live.fee}` : ''}
                                {count != null ? ` · ${count} dispenser${count === 1 ? '' : 's'}` : ''}
                            </li>
                        );
                    })}
                </ul>
            )}
            {feedsError ? <p className={styles.hint}>{feedsError}</p> : null}

            <p className={styles.successLabel}>Publish a price</p>
            <Select
                label="Token's chain"
                hint={crossChain
                    ? `Cross-chain: a ${coinTicker} transaction publishing the price of a ${priceCoin} token.`
                    : 'The chain the priced token lives on. It can differ from the publishing chain.'}
                value={priceCoin}
                onChange={(e) => setCoinPick(e.target.value === coinTicker ? '' : e.target.value)}
            >
                {PRICE_COINS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input
                label="Token ticker"
                hint={`The ${priceCoin} token you are pricing.`}
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            <Select
                label="Currency"
                hint="Dispensers pricing in this currency can use this oracle."
                value={fiat}
                onChange={(e) => setFiat(e.target.value)}
            >
                {FIAT_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input
                label={`Price of one ${tick || 'token'} in ${fiat}`}
                hint="Up to 8 decimal places."
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
            />
            {priorQuote ? (
                <p className={styles.hint}>
                    Currently published: {priorQuote.value} {fiat}
                    {priorQuote.effective ? '' : ` (not in effect yet${
                        activationCountdownText(priorQuote.secondsUntilEffective)
                            ? `, starts in ${activationCountdownText(priorQuote.secondsUntilEffective)}`
                            : ''})`}
                    {deviationPct != null ? ` · this publish is a ${fmtPct(deviationPct)} move` : ''}
                </p>
            ) : tick ? (
                <p className={styles.hint}>
                    First price for {tick} in {fiat}. It will not price anything for 24 hours.
                </p>
            ) : null}
            <Input
                label="Usage fee (optional)"
                hint="A fraction, not a percentage: 0.01 means 1%. Charged once to whoever opens a dispenser against this oracle, sized from the escrow they fund. Leave empty to charge nothing."
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                autoComplete="off"
            />
            <Input label="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />

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
            {formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !tick || !value.trim() || actionConfirm.composing}
                >
                    {isWatcherMode ? 'Preview' : 'Publish price'}
                </Button>
            </div>
        </form>,
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

/**
 * The oracle-specific facts shown in front of the signature: when the quote
 * takes effect, the typed confirm for a large move, and which dispensers will
 * reprice. Rendered on the confirm page and on the watcher review alike.
 */
function OraclePublishNotes({
    isFirstPublish, hasLiveQuote, priorQuote, priorLabel, fiat, tick, deviationPct,
    needsTypedConfirm, typedConfirm, onTypedConfirmChange,
    consumers, pairConsumers, crossChain, priceCoin,
}) {
    return (
        <>
            {priorQuote ? (
                <dl className={styles.detailsList}>
                    <DetailRow
                        label={priorLabel}
                        value={`${priorQuote.value} ${fiat}${deviationPct != null ? ` (${fmtPct(deviationPct)})` : ''}`}
                    />
                </dl>
            ) : null}

            <div role="alert" className={styles.warnings}>
                <p className={styles.warning}>
                    <strong>
                        {isFirstPublish
                            ? 'This is the first price for this pair, and it will not price anything for 24 hours.'
                            : 'This price takes effect in 24 hours and cannot be withdrawn before then.'}
                    </strong>{' '}
                    {isFirstPublish
                        ? 'A dispenser pointed at this oracle before then cannot settle at all; every attempt is recorded invalid. Publish a day before you need buyers.'
                        : hasLiveQuote
                            ? 'The current price keeps selling until this one matures, and the only way to correct a mistake is another publish, which also takes 24 hours.'
                            : 'Nothing sells on this pair yet: your earlier price is still pending and takes effect first, then this one replaces it. The only way to correct a mistake is another publish, which also takes 24 hours.'}
                </p>
            </div>

            {needsTypedConfirm ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        <strong>That is a {fmtPct(deviationPct)} move</strong> from your last published
                        price of {priorQuote?.value} {fiat}. Check the decimal point before signing.
                    </p>
                </div>
            ) : null}

            {consumers && !consumers.supported ? (
                <p className={styles.hint}>
                    Could not check which dispensers use this oracle, so this list may be
                    incomplete. Treat the publish as if buyers are watching.
                    {crossChain ? ` Dispensers selling ${priceCoin} tokens are not visible from this chain.` : ''}
                </p>
            ) : pairConsumers.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        {pairConsumers.length} open dispenser{pairConsumers.length === 1 ? '' : 's'} price
                        {pairConsumers.length === 1 ? 's' : ''} {tick} from this oracle and will sell at the
                        new price once it takes effect:
                    </p>
                    <ul>
                        {pairConsumers.slice(0, 5).map((d) => (
                            <li key={d.action_index} className={styles.hint}>
                                <AddressText address={d.address || d.source} /> · {d.give_amount} {tick} per dispense
                            </li>
                        ))}
                    </ul>
                    {pairConsumers.length > 5 ? (
                        <p className={styles.hint}>and {pairConsumers.length - 5} more.</p>
                    ) : null}
                </div>
            ) : (
                <p className={styles.hint}>No open dispensers price {tick} from this oracle right now.</p>
            )}

            {needsTypedConfirm ? (
                <Input
                    label="Type PUBLISH to confirm"
                    hint={`This changes your published price by ${fmtPct(deviationPct)} and cannot be undone for 24 hours.`}
                    value={typedConfirm}
                    onChange={(e) => onTypedConfirmChange(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
        </>
    );
}
