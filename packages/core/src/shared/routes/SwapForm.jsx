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
import { useFocusNoticeOnAttempt } from '../hooks/useFocusNoticeOnAttempt.js';
import { AddressField, AddressText, Button, ChainBadge, ChainPicker, Checkbox, FeeSelector, FieldNote, FormNotice, FormPage, FormSection, Icon, Input, PageHeader, RadioGroup, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { compareDecimalStrings, divideDecimalStrings, formatWithThousands, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useHideReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { memoCharacterError, memoLengthError } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import {
    hasAnyAddress,
    preferredSourceId,
    signingAddressesByChain,
    WATCH_ONLY_SIGNING_MESSAGE,
} from '../addressSelection.js';
import { pickDefaultChainId, recordLastUsedChain } from '../chainSelection.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

// Protocol coin tickers per xchain-sdk VALID_COINS. `descriptor.coin` is
// long-form ('bitcoin' / 'litecoin' / 'dogecoin'); SWAP serializes the
// short-form tickers in GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

const isPlainPositive = (value) => /^\d+(\.\d+)?$/.test(String(value).trim())
    && compareDecimalStrings(String(value).trim(), '0') === 1;

const isPositiveActionIndex = (value) => /^[0-9]+$/.test(String(value).trim())
    && /[1-9]/.test(String(value));

function expirationValidationError(mode, input, nowSec = Math.floor(Date.now() / 1000)) {
    if (mode !== 'custom') return null;
    if (!input.trim()) return 'Pick an expiration date and time, or switch to the default window.';
    const ms = Date.parse(input.trim());
    if (!Number.isFinite(ms)) return 'Pick a valid expiration date and time.';
    if (Math.floor(ms / 1000) <= nowSec) return 'Expiration must be in the future.';
    return null;
}

function withFormattedExpiration(confirmAction) {
    const decoded = confirmAction?.composed?.decoded;
    if (!decoded || !Array.isArray(decoded.details)) return confirmAction;
    const details = decoded.details.map((detail) => {
        if (!/expir/i.test(String(detail?.label || ''))) return detail;
        const unixSec = Number(detail.value);
        if (!Number.isFinite(unixSec) || unixSec <= 0 || unixSec >= 10_000_000_000) return detail;
        return { ...detail, value: formatLocalDateTime(unixSec) };
    });
    return {
        ...confirmAction,
        composed: {
            ...confirmAction.composed,
            decoded: { ...decoded, details },
        },
    };
}

/**
 * §41.5 SWAP authoring surface.
 *
 * Builds a v0 Create SWAP: atomic token-pair swap that settles in one
 * transaction with no COINPAY follow-up. The v0 form is deliberately
 * single-chain in the default UX (GIVE_COIN = GET_COIN = current
 * chain's native ticker) because the common case is "swap MYTOKEN for
 * COOLCOIN on Bitcoin". Cross-chain swaps use the same SWAP primitive
 * but are out-of-scope for the Phase 3 form.
 *
 * SWAP does NOT work with native coin (BTC / LTC / DOGE). That's
 * what DISPENSER is for. The form rejects inputs where GIVE_TICK or
 * GET_TICK match the chain's native ticker.
 *
 * Ownership trading: either side can trade the token's *ownership
 * record* (the asset name) instead of a balance via the give/get
 * ownership toggles (GIVE_OWNERSHIP / GET_OWNERSHIP). Ownership trades
 * carry no amount and are single-fill; ownership-for-ownership swaps set
 * both toggles.
 *
 * Cancel (v1) and Edit (v2) share the same `swapAction` core flow
 * but route through a future "My swaps" surface; not built here.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]       seed the chain (e.g. launched from ManageToken)
 * @param {string} [props.initialGiveTick]      prefill the give ticker
 * @param {boolean} [props.initialGiveOwnership] open in give-ownership mode (sell a token name)
 */
export function SwapForm({ walletId, onBack, initialChainId, initialGiveTick, initialGiveOwnership }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    const networkAvailable = !networkOffline;
    useHideReachabilityNotice(networkOffline);
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [giveTick, setGiveTick] = useState((initialGiveTick || '').toUpperCase());
    // PC-26: swap settlement carries no gated-key handoff; warn when the
    // give-side token has gated content.
    const gatedGiveNotice = useGatedTickNotice({ messaging, chainId, tick: giveTick });
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(!!initialGiveOwnership);
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);
    const [memo, setMemo] = useState('');
    // PC-18: the rest of the SWAP v0 field set the same-chain form was missing.
    const [expMode, setExpMode] = useState(/** @type {'default' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [allowListIdx, setAllowListIdx] = useState('');
    const [blockListIdx, setBlockListIdx] = useState('');
    const [getAddress, setGetAddress] = useState('');
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    const [showAdvanced, setShowAdvanced] = useState(false);
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);
    const [password, setPassword] = useState('');
    const [givePickerOpen, setGivePickerOpen] = useState(false);
    const [getPickerOpen, setGetPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const markReviewAttempt = useFocusNoticeOnAttempt();
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitPendingRef = useRef(false);
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
            // Best-effort, like useActionForm: the last-used chain default
            // needs the settings in the same load, never a beat later.
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                const signingByChain = signingAddressesByChain(byChain, settings);
                setAddressesByChain(signingByChain);
                setActiveByChain(active || {});
                if (!Object.keys(signingByChain)[0]) {
                    setLoadError(hasAnyAddress(byChain)
                        ? WATCH_ONLY_SIGNING_MESSAGE
                        : 'No addresses on any network yet. Use Receive to generate one before creating a swap.');
                    return;
                }
                // Don't clobber a caller-seeded chain (ManageToken sell flow).
                setChainId((c) => pickDefaultChainId(signingByChain, { explicitChainId: c, settings }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        // Default the from-address to the chain's active address (else newest
        // HD external), matching Send. The user can still override via the
        // dropdown; that doesn't change these deps, so it isn't clobbered.
        setFromAddressId(preferredSourceId(addressesByChain[chainId] || [], activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain]);

    // Focus password field immediately on entering review so the user can
    // sign without reaching for the mouse (mirrors DestroyForm behaviour).
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Source balance of the give ticker, backing the give AmountField's
    // Max button + "available" footer.
    const giveBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: giveTick,
    });
    const giveTokenInfo = useTokenInfo({
        chainId,
        tick: giveTick,
        skip: giveOwnership || !giveTick.trim(),
    });
    const getTokenInfo = useTokenInfo({
        chainId,
        tick: getTick,
        skip: getOwnership || !getTick.trim(),
    });
    const hw = isHwSource(fromAddress);
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: hw ? fromAddress?.signerId : null,
    });

    const expError = useMemo(() => {
        return expirationValidationError(expMode, expInput);
    }, [expMode, expInput]);

    const validationError = useMemo(() => {
        if (!giveTick) return null;
        if (!getTick) return null;
        // SWAP does NOT work with native coin per protocol rules.
        if (coinTicker && giveTick.toUpperCase() === coinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot give ${coinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (coinTicker && getTick.toUpperCase() === coinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot get ${coinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (giveTick.toUpperCase() === getTick.toUpperCase()) {
            return 'Give and get tickers must differ.';
        }
        if (!giveOwnership && giveAmount && !isPlainPositive(giveAmount)) {
            return 'Give amount must be a positive decimal number.';
        }
        if (!getOwnership && getAmount && !isPlainPositive(getAmount)) {
            return 'Get amount must be a positive decimal number.';
        }
        if (!giveOwnership && giveAmount) {
            const precisionError = tokenAmountPrecisionError(giveAmount, {
                divisibility: giveTokenInfo?.divisibility,
                tick: giveTick,
                noun: 'Give amount',
            });
            if (precisionError) return precisionError;
            if (giveBalance !== null && compareDecimalStrings(giveAmount, giveBalance) === 1) {
                return `Give amount is above your available ${giveTick.trim().toUpperCase()} balance.`;
            }
        }
        if (!getOwnership && getAmount) {
            const precisionError = tokenAmountPrecisionError(getAmount, {
                divisibility: getTokenInfo?.divisibility,
                tick: getTick,
                noun: 'Get amount',
            });
            if (precisionError) return precisionError;
        }
        if (getAddress.trim()) {
            const addressError = addressValidationError(getAddress, descriptor);
            if (addressError) return addressError;
        }
        if (allowListIdx && !isPositiveActionIndex(allowListIdx)) return 'Allow-list ID must be a positive whole number.';
        if (blockListIdx && !isPositiveActionIndex(blockListIdx)) return 'Block-list ID must be a positive whole number.';
        if (memo.includes('|') || memo.includes(';')) return 'Memo cannot contain "|" or ";".';
        const memoError = memoLengthError(memo.trim()) || memoCharacterError(memo.trim());
        if (memoError) return memoError;
        return null;
    }, [giveTick, getTick, coinTicker, giveOwnership, giveAmount, getOwnership, getAmount,
        giveTokenInfo?.divisibility, getTokenInfo?.divisibility, giveBalance, getAddress,
        descriptor, allowListIdx, blockListIdx, memo]);

    const rate = !giveOwnership && !getOwnership
        ? divideDecimalStrings(getAmount, giveAmount, 8)
        : null;
    const displayedRate = rate === '0' && isPlainPositive(getAmount) && isPlainPositive(giveAmount)
        ? '< 0.00000001'
        : rate;
    const rateText = displayedRate
        ? `1 ${giveTick.trim().toUpperCase()} = ${displayedRate} ${getTick.trim().toUpperCase()}`
        : 'Enter both amounts to see the rate';

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // Network fee: Low / Normal / Fast / Custom, editable via FeeSelector on
    // the form stage. `feeEstimate` is the estimate for the current pick and
    // backs both the slider readout and the review row; `feePerKb` prices the
    // broadcast. Mirrors ComposeMessage / DispenserDetail.
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

    // Wire-format SWAP v0 params: the one definition the confirm compose and
    // the legacy submit both use.
    const swapParams = useMemo(() => ({
        VERSION: '0',
        GIVE_COIN: coinTicker,
        GIVE_TICK: giveTick.trim(),
        // Ownership side escrows the token's ownership record. No amount;
        // otherwise serialize the balance amount.
        ...(giveOwnership
            ? { GIVE_OWNERSHIP: '1' }
            : { GIVE_AMOUNT: String(giveAmount).trim() }),
        GET_COIN: coinTicker,
        GET_TICK: getTick.trim(),
        ...(getOwnership
            ? { GET_OWNERSHIP: '1' }
            : { GET_AMOUNT: String(getAmount).trim() }),
        ...(getAddress.trim() ? { GET_ADDRESS: getAddress.trim() } : {}),
        // EXPIRATION is a wall-clock Unix timestamp (not blocks); 'default'
        // omits it so the indexer applies its standard window.
        ...((() => {
            if (expMode !== 'custom' || !expInput.trim()) return {};
            const ms = Date.parse(expInput.trim());
            return Number.isFinite(ms) ? { EXPIRATION: String(Math.floor(ms / 1000)) } : {};
        })()),
        ...(allowListIdx ? { ALLOW_LIST: allowListIdx } : {}),
        ...(blockListIdx ? { BLOCK_LIST: blockListIdx } : {}),
        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
    }), [coinTicker, giveTick, giveOwnership, giveAmount, getTick, getOwnership, getAmount, getAddress, expMode, expInput, allowListIdx, blockListIdx, memo]);

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page; hardware +
    // watcher keep the legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'swapAction',
        hardware: 'swapActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        if (!networkAvailable) return;
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
                actionData: { action: 'SWAP', params: swapParams },
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: swapParams,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
            recordLastUsedChain(messaging, chainId);
        } catch (err) {
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: err?.message || 'Swap failed.',
            }));
        } finally {
            submitPendingRef.current = false;
        }
    }

    // handleReview validates the form then moves to the review stage.
    // No signing happens here: the actual flow calls live in handleSubmit
    // and are only reachable after the user confirms on the review screen.
    function handleReview(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!networkAvailable) return;
        markReviewAttempt();
        if (!fromAddress || !chainId) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!giveTick || !getTick
            || (!giveOwnership && !giveAmount)
            || (!getOwnership && !getAmount)) {
            setFormError('Enter the give and get tickers and amounts before reviewing.');
            return;
        }
        if (validationError || expError) return;
        // The memoized check keeps the clock of the last edit, so ask again now.
        if (expirationValidationError(expMode, expInput)) {
            setFormError('Expiration must be a future date and time.');
            return;
        }
        setFormError(null);
        if (singleEncode) {
            if (submitPendingRef.current) return;
            submitPendingRef.current = true;
            void openConfirmScreen();
            return;
        }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!networkAvailable) return;
        if (stage === 'submitting' || submitPendingRef.current) return;
        if (!fromAddress || !chainId) return;
        const freshExpirationError = expirationValidationError(expMode, expInput);
        if (validationError || freshExpirationError) {
            if (freshExpirationError) setSubmitError(freshExpirationError);
            return;
        }
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        submitPendingRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const params = swapParams;
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
                params,
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'SWAP', params },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (hw) {
                r = await messaging.swapActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                r = await messaging.swapAction({ ...base, password });
            }
            setResult(r);
            setStage('done');
            recordLastUsedChain(messaging, chainId);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFeeMandatory,
                        fallback: err?.message || 'Sign failed.',
                    }),
            );
            // Stay on review rather than dropping back to the form so the
            // user can correct their password without re-entering swap terms.
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitPendingRef.current = false;
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }
    const header = (
        <PageHeader
            onBack={stage === 'review'
                ? () => { setStage('form'); setSubmitError(null); }
                : onBack}
            title={stage === 'review' || stage === 'submitting'
                ? 'Review swap'
                : `Swap tokens`}
        />
    );
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {!networkAvailable ? (
                <StatusMessage variant="warning">Swapping needs a network connection.</StatusMessage>
            ) : null}
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error">{loadError}</StatusMessage>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} unsaved={result.unsaved} />);
        }
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
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Swap sent</p>
                {txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{txid}</code>
                    </p>
                ) : null}
                <p className={styles.hint}>
                    Your swap is now open. It settles automatically when a
                    counterparty matches it; until then you can cancel or edit
                    it from its entry in your activity.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    // --- Review / submitting screen -------------------------------------
    if (stage === 'review' || stage === 'submitting') {
        const giveSide = giveOwnership
            ? `ownership of ${swapParams.GIVE_TICK.toUpperCase()}`
            : `${swapParams.GIVE_AMOUNT} ${swapParams.GIVE_TICK.toUpperCase()}`;
        const getSide = getOwnership
            ? `ownership of ${swapParams.GET_TICK.toUpperCase()}`
            : `${swapParams.GET_AMOUNT} ${swapParams.GET_TICK.toUpperCase()}`;
        const feeLabel = feeEstimate
            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
            : 'Estimate unavailable';

        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review swap"
                onSubmit={handleSubmit}
                status={(isWatcherMode || hw) && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => { setStage('form'); setSubmitError(null); }}
                            disabled={stage === 'submitting'}
                        >
                            Edit
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={stage === 'submitting'}
                            disabled={
                                isWatcherMode
                                    ? false
                                    : hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                            }
                        >
                            {isWatcherMode
                                ? 'Create unsigned transaction'
                                : hw
                                    ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                    : 'Sign swap'}
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>
                    Swap {giveSide} for {getSide}.
                </p>
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <DetailRow label="Give network" value={<ChainBadge descriptor={descriptor} size="sm" />} />
                    ) : null}
                    <DetailRow label="From" value={<AddressText address={fromAddress.address} />} />
                    <DetailRow label="Give amount" value={giveSide} />
                    {descriptor ? (
                        <DetailRow label="Get network" value={<ChainBadge descriptor={descriptor} size="sm" />} />
                    ) : null}
                    <DetailRow label="Get amount" value={getSide} />
                    {!giveOwnership && !getOwnership ? (
                        <DetailRow label="Rate" value={rateText} />
                    ) : null}
                    <DetailRow
                        label="Expiration"
                        value={swapParams.EXPIRATION
                            ? formatLocalDateTime(Number(swapParams.EXPIRATION))
                            : 'Default window'}
                    />
                    <DetailRow
                        label="Receive at"
                        value={swapParams.GET_ADDRESS
                            ? <AddressText address={swapParams.GET_ADDRESS} />
                            : 'Source address (default)'}
                    />
                    <DetailRow label="Allow list" value={swapParams.ALLOW_LIST ? `#${swapParams.ALLOW_LIST}` : 'None'} />
                    <DetailRow label="Block list" value={swapParams.BLOCK_LIST ? `#${swapParams.BLOCK_LIST}` : 'None'} />
                    {swapParams.MEMO ? <DetailRow label="Memo" value={swapParams.MEMO} /> : null}
                    <DetailRow label="Network fee" value={feeLabel} />
                    <DetailRow
                        label="Protocol fee"
                        value={`If charged, paid in ${payFeeInNativeCoin ? coinTicker : 'XCHAIN'}; the network fee is separate.`}
                    />
                </dl>
                <p className={styles.hintLeft}>
                    The give side is escrowed until this offer is matched. If you cancel it or
                    it expires, the escrow returns to the source address. Paid transaction fees
                    are not refunded.
                </p>
                {payFeeInNativeCoin ? (
                    <FormNotice variant="warning" role="alert">{NATIVE_FEE_WARNING}</FormNotice>
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
                        signerInfo={hwSignerInfo}
                    />
                )}
            </FormPage>,
        );
    }

    // --- Form screen ----------------------------------------------------
    const chainIds = Object.keys(addressesByChain || {});

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={withFormattedExpiration(actionConfirm.confirmAction)}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
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
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose allow-list' : 'Choose block-list'}
                onSelect={(row) => {
                    if (listPickerFor === 'allow') setAllowListIdx(row.actionIndex); else setBlockListIdx(row.actionIndex);
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (givePickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select give token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setGiveTick(String(sel.tick || '').toUpperCase());
                    setGivePickerOpen(false);
                }}
                onBack={() => setGivePickerOpen(false)}
            />
        );
    }

    if (getPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Select get token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setGetTick(String(sel.tick || '').toUpperCase());
                    setGetPickerOpen(false);
                }}
                onBack={() => setGetPickerOpen(false)}
            />
        );
    }

    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label="Swap tokens"
            onSubmit={handleReview}
            sectioned
            inert={actionConfirm.composing ? '' : undefined}
            aria-busy={actionConfirm.composing ? 'true' : undefined}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            status={validationError || formError ? (
                <>
                    {validationError ? (
                        <StatusMessage variant="error">
                            {validationError}
                        </StatusMessage>
                    ) : null}
                    {formError ? (
                        <StatusMessage variant="error">
                            {formError}
                        </StatusMessage>
                    ) : null}
                </>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing || !networkAvailable}
                    title={!networkAvailable ? 'Swapping needs a network connection' : undefined}
                >
                    {actionConfirm.composing
                        ? 'Preparing review…'
                        : 'Review'}
                </Button>
            )}
        >
            <FormSection
                title="Network"
                description="Both swap legs settle on this network."
            >
                <ChainPicker
                    label="Give and get network"
                    value={chainId}
                    onChange={(cid) => {
                        if (cid === chainId) return;
                        // Tokens, the receive address and list IDs name things on
                        // one chain; a list ID on another chain is a different list.
                        setChainId(cid);
                        setGiveTick('');
                        setGiveAmount('');
                        setGiveOwnership(false);
                        setGetTick('');
                        setGetAmount('');
                        setGetOwnership(false);
                        setGetAddress('');
                        setAllowListIdx('');
                        setBlockListIdx('');
                        setFormError(null);
                    }}
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    hideNetworkKind
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
            </FormSection>

            <FormSection title="You give">
                <TokenField
                    label="Give token"
                    value={giveTick && chainId ? { chainId, tick: giveTick } : null}
                    onOpenPicker={() => setGivePickerOpen(true)}
                />
                {gatedGiveNotice.gated && !giveOwnership ? (
                    <FormNotice variant="warning" role="alert">
                        {gatedTickWarningCopy(giveTick, 'the swap counterparty')}
                    </FormNotice>
                ) : null}
                {giveOwnership ? null : (
                    <AmountField
                        label="Give amount"
                        amount={giveAmount}
                        tick={giveTick}
                        onAmountFieldChange={(rawValue) => {
                            const stripped = String(rawValue).replace(/,/g, '');
                            if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                            setGiveAmount(stripped);
                        }}
                        onMax={giveBalance && Number(giveBalance) > 0
                            ? () => setGiveAmount(giveBalance)
                            : undefined}
                        maxDisabled={!giveBalance}
                        balanceText={giveBalance != null && giveTick.trim()
                            ? `${formatWithThousands(giveBalance)} ${giveTick.trim().toUpperCase()} available`
                            : null}
                    />
                )}
                <Checkbox
                    label="Give this token's ownership instead of an amount"
                    checked={giveOwnership}
                    onChange={(e) => setGiveOwnership(e.target.checked)}
                />
                {giveOwnership ? (
                    <p className={styles.hintLeft}>
                        Transfers the entire ownership of {giveTick.trim() ? giveTick.trim().toUpperCase() : 'this token'} (single-fill, no partial matches).
                    </p>
                ) : null}
            </FormSection>

            <FormSection title="You get">
                <TokenField
                    label="Get token"
                    value={getTick && chainId ? { chainId, tick: getTick } : null}
                    onOpenPicker={() => setGetPickerOpen(true)}
                />
                {getOwnership ? null : (
                    <AmountField
                        label="Get amount"
                        amount={getAmount}
                        tick={getTick}
                        onAmountFieldChange={(rawValue) => {
                            const stripped = String(rawValue).replace(/,/g, '');
                            if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                            setGetAmount(stripped);
                        }}
                    />
                )}
                <Checkbox
                    label="Require the matcher to give that token's ownership instead of an amount"
                    checked={getOwnership}
                    onChange={(e) => setGetOwnership(e.target.checked)}
                />
                {getOwnership ? (
                    <p className={styles.hintLeft}>
                        The matcher must currently own {getTick.trim() ? getTick.trim().toUpperCase() : 'this token'}; on match its ownership transfers to you.
                    </p>
                ) : null}
            </FormSection>

            <FormSection
                title="Timing and fees"
                description="The give side stays escrowed until a match, cancellation, or expiration."
            >
            <RadioGroup
                legend="Expiration"
                name="swap-exp"
                value={expMode}
                onChange={setExpMode}
                options={[
                    { value: 'default', label: 'Default window' },
                    { value: 'custom', label: 'Expire at a specific time' },
                ]}
            />
            {expMode === 'custom' ? (
                <Input
                    label="Expires"
                    type="datetime-local"
                    hint="Wall-clock time the swap offer is valid until. Must be in the future."
                    value={expInput}
                    onChange={(e) => setExpInput(e.target.value)}
                />
            ) : null}
            {expError ? <FieldNote variant="error">{expError}</FieldNote> : null}

            <dl className={styles.detailsList}>
                <DetailRow label="Rate" value={rateText} />
            </dl>

            <p className={styles.hintLeft}>
                Cancel from My swaps or let the offer expire to return the escrow to the
                source address. Paid transaction fees are not refunded.
            </p>

            <Input
                id="swap-memo"
                label="Memo"
                optional
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />

            <Button
                variant="link"
                size="sm"
                icon={null}
                className={styles.advancedToggle}
                aria-expanded={showAdvanced}
                aria-controls="swap-advanced-options"
                onClick={() => setShowAdvanced((v) => !v)}
            >
                Advanced options
                <Icon.ChevronDownIcon
                    style={{ transform: showAdvanced ? 'rotate(180deg)' : undefined }}
                />
            </Button>
            {showAdvanced ? (
                <div id="swap-advanced-options" className={styles.advancedOptions}>
                    <AddressField
                        label="Receive at (optional)"
                        hint="Address where you receive the get side. Defaults to your source address."
                        value={getAddress}
                        onChange={(e) => setGetAddress(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <div className={styles.choiceGroup}>
                        <p className={styles.choiceGroupLabel}>Restrict who can match (optional)</p>
                        <div className={styles.choiceButtons}>
                            <Button variant="secondary" size="sm" onClick={() => setListPickerFor('allow')}>
                                {allowListIdx ? `Allow-list #${allowListIdx}` : 'Set allow-list'}
                            </Button>
                            {allowListIdx ? <Button variant="secondary" size="sm" onClick={() => setAllowListIdx('')}>Clear</Button> : null}
                            <Button variant="secondary" size="sm" onClick={() => setListPickerFor('block')}>
                                {blockListIdx ? `Block-list #${blockListIdx}` : 'Set block-list'}
                            </Button>
                            {blockListIdx ? <Button variant="secondary" size="sm" onClick={() => setBlockListIdx('')}>Clear</Button> : null}
                        </div>
                    </div>
                    <p className={styles.hintLeft}>Allow/block lists are address lists you published (see My Lists).</p>
                </div>
            ) : null}

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                    // Offline already says swapping is blocked, so a fee-source
                    // notice would be a second message for the same state.
                    showEstimateNotice={networkAvailable}
                />
            ) : null}

            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
                mandatory={nativeFeeMandatory}
            />
            </FormSection>
        </FormPage>,
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
