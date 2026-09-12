// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, AddressText, Button, ChainPicker, FeeSelector, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { AmountField } from '../components/AmountField.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { activeSourceId, externalIndexOf } from '../addressSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { tickerForCoin } from '../../registry/coinTicker.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import {
    GAS_TICK,
    bridgeLegFor,
    bridgeChainsList,
    bridgeDestinationError,
    bridgeDisplayTick,
    belowFeeWarning,
    quotedProtocolFee,
    xbridgeActionString,
    coinDisplay,
    compareDecimal,
} from './BridgeTick.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// How long the fee quote waits after the last keystroke. Same 400 ms
// useTickBalance settles on: long enough that typing an amount does not fan a
// request per character, short enough that the warning is on screen before the
// user reaches the button.
const FEE_QUOTE_DEBOUNCE_MS = 400;

/**
 * BridgeMoveForm: "move XCHAIN to Dogecoin / back to Bitcoin", generalized to
 * any bridgeable token (xchain-bridge.md section 13 wallet row, base row 10;
 * xchain-token-bridge.md section 9).
 *
 * What makes this different from every other authoring form in the wallet, and
 * what the whole screen is shaped around: a bridge leg is IRREVERSIBLE and
 * lands on a chain this screen cannot see. The SDK's own describer says so in
 * as many words ("the credit cannot be undone or redirected"), so:
 *
 *   - the destination is RESOLVED FROM THE USER'S OWN ACCOUNT on the other
 *     chain, never typed (D4's wallet row says "never free text"). A typo in a
 *     free-text field is an unrecoverable loss with no counterparty to ask, and
 *     no later action can redirect an applied credit. The address is read-only
 *     here and changed only by picking another of the wallet's OWN addresses on
 *     that chain;
 *   - a chain the wallet holds no address on is not offered as a destination at
 *     all, and says why;
 *   - the leg (lock or burn) is derived from the asset, never chosen: locking
 *     happens on the origin chain, burning everywhere else. A v0 composed on the
 *     wrong chain is refused after the miner fee is already spent;
 *   - the amount is checked against the REAL protocol fee, quoted from the venue
 *     for these exact bytes (base D13 ruled no dust floor in consensus, so the
 *     wallet is the only thing that can warn).
 *
 * The pending display (D4 / D61) lives on the done stage: from the moment the
 * source leg is broadcast the move is IN FLIGHT, and the destination credit
 * arrives only after the federation has seen the source leg confirmed to depth
 * and signed it. The exact depth is consensus configuration that changes without
 * the wallet (the hub's `coins.resolveConfirmations`, raised per token by the
 * issuer's MIN_DEPTH), so this states the rule and shows the number only when it
 * actually holds one, the same discipline protocolFeeRow.js applies to fees.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialTick]
 * @param {() => void} props.onBack
 */
export function BridgeMoveForm({ walletId, accountId, initialChainId, initialTick, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { isWatcherMode } = useWalletMode();

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(/** @type {Record<string, any>} */ ({}));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [sourceChainId, setSourceChainId] = useState(
        /** @type {string | null} */ (initialChainId || null),
    );
    const [destChainId, setDestChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [tick, setTick] = useState(initialTick || GAS_TICK);
    const [amount, setAmount] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [destAddress, setDestAddress] = useState('');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [destPickerOpen, setDestPickerOpen] = useState(false);

    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [stage, setStage] = useState(/** @type {'form' | 'submitting' | 'done'} */ ('form'));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId, accountId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId, accountId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                const chains = chainsWithAddresses(byChain);
                if (chains.length === 0) {
                    setLoadError('No addresses on any chain yet. Use Receive to create one before moving anything across the bridge.');
                    return;
                }
                setSourceChainId((current) => (current && chains.includes(current) ? current : chains[0]));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallet.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    // Source address: the chain's active address, else the newest external HD
    // index, the selection every other authoring form makes.
    useEffect(() => {
        if (!addressesByChain || !sourceChainId) {
            setFromAddressId(null);
            return;
        }
        const addrs = addressesByChain[sourceChainId] || [];
        const activeId = activeSourceId(addrs, activeByChain[sourceChainId]);
        if (activeId) { setFromAddressId(activeId); return; }
        const hd = addrs.filter((a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null);
        const pool = hd.length > 0 ? hd : addrs;
        if (pool.length === 0) { setFromAddressId(null); return; }
        const sorted = [...pool].sort(
            (a, b) => (externalIndexOf(b.derivationPath) ?? -1) - (externalIndexOf(a.derivationPath) ?? -1),
        );
        setFromAddressId(sorted[0].id);
    }, [sourceChainId, addressesByChain, activeByChain]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !sourceChainId) return null;
        return (addressesByChain[sourceChainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, fromAddressId, sourceChainId]);

    const sourceDescriptor = sourceChainId ? chainRegistry.get(sourceChainId) : null;
    const destDescriptor = destChainId ? chainRegistry.get(destChainId) : null;
    const sourceCoin = sourceDescriptor ? tickerForCoin(sourceDescriptor.coin) : '';
    const destCoin = destDescriptor ? tickerForCoin(destDescriptor.coin) : '';

    const leg = useMemo(
        () => bridgeLegFor({ tick, sourceCoin }),
        [tick, sourceCoin],
    );
    const shown = bridgeDisplayTick(tick, sourceCoin);

    // Candidate destinations: every chain on the SAME network kind that this
    // wallet can receive on, minus the source. Network kind matters because a
    // mainnet lock cannot credit a regtest ledger, and the registry is the only
    // thing that knows which is which.
    const destChainIds = useMemo(() => {
        if (!addressesByChain || !sourceDescriptor) return [];
        return Object.keys(addressesByChain)
            .filter((cid) => cid !== sourceChainId)
            .filter((cid) => chainRegistry.get(cid)?.networkKind === sourceDescriptor.networkKind);
    }, [addressesByChain, sourceChainId, sourceDescriptor]);

    // A burn has exactly one destination (the origin chain holds the escrow),
    // so the picker does not offer a choice that does not exist.
    const offeredDestChainIds = useMemo(() => {
        if (!leg.fixedDestination) return destChainIds;
        return destChainIds.filter((cid) => tickerForCoin(chainRegistry.get(cid)?.coin) === leg.fixedDestination);
    }, [destChainIds, leg.fixedDestination]);

    useEffect(() => {
        setDestChainId((current) => {
            if (current && offeredDestChainIds.includes(current)) return current;
            return offeredDestChainIds[0] || null;
        });
    }, [offeredDestChainIds]);

    // Destination address, resolved from the wallet's OWN account on that chain.
    // Never a text input: see the header note.
    useEffect(() => {
        setDestAddress('');
        if (!destChainId) return undefined;
        const known = (addressesByChain?.[destChainId] || [])[0];
        if (typeof messaging.getNewestAddress !== 'function') {
            if (known?.address) setDestAddress(known.address);
            return undefined;
        }
        let cancelled = false;
        messaging.getNewestAddress(walletId, destChainId, accountId)
            .then((rec) => {
                if (cancelled) return;
                if (rec?.address) setDestAddress(rec.address);
                else if (known?.address) setDestAddress(known.address);
            })
            .catch(() => { if (!cancelled && known?.address) setDestAddress(known.address); });
        return () => { cancelled = true; };
    }, [walletId, accountId, destChainId, addressesByChain, messaging]);

    const balance = useTickBalance({
        messaging, walletId, accountId, chainId: sourceChainId, address: fromAddress?.address, tick,
    });

    // The issuer's opt-in, read off the origin row. Null when the venue does not
    // carry the field, and a null is NOT an opt-out: the form then makes no
    // claim about bridgeability and lets consensus answer.
    const tokenInfo = useTokenInfo({
        chainId: sourceChainId,
        tick,
        skip: !tick || tick.toUpperCase() === GAS_TICK,
    });
    const bridgeChains = useMemo(
        () => bridgeChainsList(tokenInfo?.bridgeChains ?? tokenInfo?.bridge_chains ?? null),
        [tokenInfo],
    );
    const minDepth = readMinDepth(tokenInfo);

    const nativeFee = useNativeFee(sourceChainId);
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low'|'normal'|'fast'|'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId: sourceChainId, chainRegistry }),
        [sourceChainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: sourceChainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [sourceChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: sourceChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // The wire params, named once so the confirm lane, the watcher lane and the
    // fee quote all price the same bytes.
    const actionParams = useMemo(() => {
        if (!leg.version) return null;
        const amt = String(amount).trim();
        const m = memo.trim();
        const base = { VERSION: leg.version, ...(m ? { MEMO: m } : {}) };
        if (leg.version === '0') {
            return { ...base, DEST_COIN: destCoin, DEST_ADDRESS: destAddress, AMOUNT: amt };
        }
        if (leg.version === '1') {
            return { ...base, BTC_ADDRESS: destAddress, AMOUNT: amt };
        }
        if (leg.version === '3') {
            return {
                ...base, TICK: tick.trim(), DEST_COIN: destCoin, DEST_ADDRESS: destAddress, AMOUNT: amt,
            };
        }
        return {
            ...base, TICK: tick.trim(), ORIGIN_ADDRESS: destAddress, AMOUNT: amt,
        };
    }, [leg.version, destCoin, destAddress, amount, memo, tick]);

    // The REAL protocol fee for these exact bytes, from the venue's own
    // /feequote through the host re-quote lane. Not a constant: the gas schedule
    // and GAS_PRICE are consensus configuration that moves without the wallet,
    // and a stale copy would go on lying confidently (protocolFeeRow.js).
    const [feeQuote, setFeeQuote] = useState(/** @type {string | null} */ (null));
    const actionString = actionParams ? xbridgeActionString(actionParams) : null;
    useEffect(() => {
        setFeeQuote(null);
        if (!sourceChainId || !actionString || !fromAddress?.address) return undefined;
        if (typeof messaging.requoteNativeFee !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.requoteNativeFee({
                chainId: sourceChainId, actionString, source: fromAddress.address,
            })
                .then((quote) => { if (!cancelled) setFeeQuote(quotedProtocolFee(quote)); })
                .catch(() => { /* no quote is no warning, never a guessed one */ });
        }, FEE_QUOTE_DEBOUNCE_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [sourceChainId, actionString, fromAddress?.address, messaging]);

    const noDestinationAccount = destChainIds.length === 0;
    const destinationError = useMemo(() => {
        if (!sourceCoin || !destCoin) return null;
        return bridgeDestinationError({
            tick, sourceCoin, destCoin, bridgeChains,
        });
    }, [tick, sourceCoin, destCoin, bridgeChains]);

    const overBalanceError = useMemo(() => {
        const amt = String(amount).trim();
        if (!amt || balance === null) return null;
        const cmp = compareDecimal(amt, balance);
        if (cmp === null || cmp <= 0) return null;
        return `You hold ${formatWithThousands(balance)} ${shown.label} on ${chainLabel(sourceDescriptor, sourceChainId)}.`
            + ' A bridge move cannot be partly funded: reduce the amount or move a different token.';
    }, [amount, balance, shown.label, sourceDescriptor, sourceChainId]);

    const feeWarning = useMemo(
        () => belowFeeWarning({ amount, fee: feeQuote, tick: shown.label }),
        [amount, feeQuote, shown.label],
    );

    const blockingError = leg.reason || destinationError || overBalanceError || null;

    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const hw = isHwSource(fromAddress);
    // XBRIDGE has no dedicated host submit handler and does not need one: the
    // generic `action.advanced` lane takes an (action, params) pair and runs the
    // same SDK validator, encoder and signer. Adding a bespoke `action.bridge`
    // would be a third copy of that plumbing for no behaviour, and the host is
    // outside this surface anyway.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'advancedAction',
        hardware: 'advancedActionHw',
    });

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
            const r = await actionConfirm.run({
                chainId: sourceChainId,
                from,
                actionData: { action: 'XBRIDGE', params: actionParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId: sourceChainId,
                    from,
                    action: 'XBRIDGE',
                    params: actionParams,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId: sourceChainId,
                coinTicker: sourceCoin,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Sign failed.',
            }));
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !sourceChainId || !destChainId || !actionParams) return;
        if (blockingError) return;
        if (!destAddress) {
            setFormError(`Pick one of your own ${chainLabel(destDescriptor, destChainId)} addresses to receive the transfer.`);
            return;
        }
        if (!String(amount).trim()) {
            setFormError('Enter an amount to move.');
            return;
        }
        setFormError(null);
        if (isWatcherMode) {
            setStage('submitting');
            try {
                const r = await messaging.buildActionPsbtRequest({
                    chainId: sourceChainId,
                    from: {
                        address: fromAddress.address,
                        publicKey: fromAddress.publicKey,
                        derivationPath: fromAddress.derivationPath,
                        addressId: fromAddress.id,
                        source: fromAddress.source,
                    },
                    actionData: { action: 'XBRIDGE', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
                setResult(r);
                setStage('done');
            } catch (err) {
                setSubmitError(err?.message || 'Could not build the unsigned transaction.');
                setStage('form');
            }
            return;
        }
        await openConfirmScreen();
    }

    const header = (
        <PageHeader onBack={onBack} title={stage === 'done' ? 'Transfer sent' : 'Move across chains'} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        if (result?.psbtHex && !result?.txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={() => { setResult(null); setStage('form'); }}
                    onDone={onBack}
                />,
            );
        }
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} what="bridge transfer" />);
        }
        return wrap(
            <BridgePendingPanel
                txid={result?.txid}
                leg={leg}
                amount={amount}
                tickLabel={shown.label}
                sourceLabel={chainLabel(sourceDescriptor, sourceChainId)}
                destLabel={chainLabel(destDescriptor, destChainId)}
                destAddress={destAddress}
                minDepth={minDepth}
                onDone={onBack}
            />,
        );
    }

    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={chainLabel(sourceDescriptor, sourceChainId)}
                coinTicker={sourceCoin}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={sourceChainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={sourceChainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (destPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Receive at"
                walletId={walletId}
                chainId={destChainId}
                onPick={(a) => { setDestAddress(a.address); setDestPickerOpen(false); }}
                onBack={() => setDestPickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                accountId={accountId}
                title="Select token to move"
                networkFilter={coinFromChainId(sourceChainId)}
                // The bridge moves TOKENS. A chain's native coin has no token
                // row to lock and no escrow to hold it, so offering BTC/LTC/DOGE
                // here would be offering an action consensus refuses.
                kindFilter="tokens"
                kindLocked
                onSelect={(sel) => { setTick(String(sel.tick || '')); setTokenPickerOpen(false); }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    const sourceChainIds = chainsWithAddresses(addressesByChain);

    return wrap(
        <form onSubmit={handleSubmit} noValidate>
            <ChainPicker
                label="Move from"
                value={sourceChainId || ''}
                onChange={setSourceChainId}
                chainIds={sourceChainIds}
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
            <TokenField
                label="Token"
                value={tick && sourceChainId ? { chainId: sourceChainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />
            {shown.origin ? (
                <p className={styles.hint}>
                    {shown.label} here is a bridged copy of a {coinDisplay(shown.origin)} asset.
                </p>
            ) : null}

            {noDestinationAccount ? (
                <StatusMessage variant="error" className={styles.error}>
                    {`You have no address on another ${sourceDescriptor?.networkKind || ''} chain yet.`
                        + ' Use Receive to create one first: a bridge transfer credits an address you control,'
                        + ' and the credit cannot be redirected once it applies.'}
                </StatusMessage>
            ) : (
                <>
                    <ChainPicker
                        label="Move to"
                        value={destChainId || ''}
                        onChange={setDestChainId}
                        chainIds={offeredDestChainIds}
                        chainRegistry={chainRegistry}
                    />
                    <AddressField
                        label="Receive at"
                        icon="addresses"
                        value={destAddress}
                        readOnly
                        onChange={() => {}}
                        onIconClick={() => setDestPickerOpen(true)}
                        iconLabel="Choose receiving address"
                    />
                    <p className={styles.hint}>
                        One of your own {chainLabel(destDescriptor, destChainId)} addresses. The bridge
                        cannot redirect a credit after it applies, so this is never typed by hand.
                    </p>
                </>
            )}

            <AmountField
                label="Amount"
                amount={amount}
                tick={shown.label}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmount(stripped);
                }}
                onMax={balance && Number(balance) > 0 ? () => setAmount(balance) : undefined}
                maxDisabled={!balance}
                balanceText={balance != null
                    ? `${formatWithThousands(balance)} ${shown.label} available`
                    : null}
            />

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={sourceCoin}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={sourceCoin} fee={feeQuote} />

            {/* A warning, not a refusal: base D13 ruled there is NO dust floor in
                consensus, so a below-fee move is legal and the user may have a
                reason. `status` rather than `error` is deliberate - an alert role
                on a legal choice trains people to ignore the real refusals below
                it. */}
            {feeWarning ? (
                <StatusMessage variant="status">{feeWarning}</StatusMessage>
            ) : null}
            {blockingError ? (
                <StatusMessage variant="error" className={styles.error}>{blockingError}</StatusMessage>
            ) : null}
            {formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}
            {submitError ? (
                <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
            ) : null}

            {!blockingError && destChainId && leg.version ? (
                <p className={styles.hint}>
                    {leg.leg === 'lock'
                        ? `This locks ${shown.label} on ${chainLabel(sourceDescriptor, sourceChainId)} and credits it on ${chainLabel(destDescriptor, destChainId)}. The credit cannot be undone or redirected.`
                        : `This burns the copy on ${chainLabel(sourceDescriptor, sourceChainId)} and releases the original on ${chainLabel(destDescriptor, destChainId)}. The release cannot be undone or redirected.`}
                </p>
            ) : null}

            {!isWatcherMode ? (
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={fromAddress}
                    chainId={sourceChainId}
                    password={password}
                    onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                    onStatusChange={onHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={null}
                    disabled={stage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={actionConfirm.composing || stage === 'submitting'}
                    disabled={
                        !!blockingError
                        || noDestinationAccount
                        || !fromAddress
                        || !destAddress
                        || !String(amount).trim()
                        || !leg.version
                        || actionConfirm.composing
                    }
                >
                    {leg.leg === 'burn' ? 'Move back' : 'Move'}
                </Button>
            </div>
        </form>,
    );
}

/**
 * The pending display (D4 / D61): what has happened, what has not happened yet,
 * and what the wait actually depends on.
 *
 * The source leg is on chain the moment this renders; the destination credit is
 * not, and will not be until the federation has seen the source leg confirmed to
 * the platform depth for that chain (raised to the issuer's MIN_DEPTH when the
 * token declares one) and signed the transfer. The depth is consensus
 * configuration the wallet does not carry a copy of, so the number is shown only
 * when the token row supplied one and the rule is stated either way. A wallet
 * that invented "about 6 confirmations" would be wrong the first time an
 * operator raised it, and silently.
 */
function BridgePendingPanel({
    txid, leg, amount, tickLabel, sourceLabel, destLabel, destAddress, minDepth, onDone,
}) {
    const moved = `${String(amount).trim()} ${tickLabel}`;
    return (
        <>
            <p className={styles.successTitle}>
                {leg.leg === 'lock' ? 'Lock broadcast' : 'Burn broadcast'}
            </p>
            {txid ? (
                <>
                    <p className={styles.successLabel}>{sourceLabel} transaction</p>
                    <code className={styles.txid}>{txid}</code>
                </>
            ) : null}
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Moving</dt>
                <dd className={styles.detailsValue}>{moved}</dd>
                <dt className={styles.detailsLabel}>To</dt>
                <dd className={styles.detailsValue}><AddressText address={destAddress} /></dd>
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue}>
                    {`Pending on ${destLabel}`}
                </dd>
            </dl>
            <p className={styles.hint}>
                {`This transfer is in flight. The ${leg.leg === 'lock' ? 'credit' : 'release'} appears on ${destLabel}`
                    + ` once the validators have seen this transaction confirmed on ${sourceLabel} and signed the transfer`
                    + (minDepth ? `, which this token requires to be at least ${minDepth} confirmations deep` : '')
                    + '. Nothing further is needed from you, and it cannot be cancelled or redirected.'}
            </p>
            <div className={styles.actions}>
                <Button variant="primary" onClick={onDone}>Done</Button>
            </div>
        </>
    );
}

function chainsWithAddresses(byChain) {
    return Object.entries(byChain || {})
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);
}

function chainLabel(descriptor, chainId) {
    return descriptor?.displayName || chainId || '';
}

// The issuer-raised confirmation depth off the origin token row, when the venue
// carries it. Tolerant of both the normalized and the raw wire spelling: the
// field is new, and a shape that arrives unrecognized must read as "no number"
// rather than as zero.
function readMinDepth(info) {
    const raw = info?.minDepth ?? info?.min_depth ?? null;
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}
