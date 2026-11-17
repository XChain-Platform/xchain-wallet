// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import {
    // The fee selector renders inside the standard FeeSection.
    AddressText, Button, ChainBadge, EmptyState, FormPage, Icon,
    FormNotice,
    ListPage, PageHeader, Screen, Skeleton, StatusMessage, useFormErrors,
} from '@xchain-wallet/core/ui';
import { useSettings } from '../hooks/useSettings.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import {
    expandDecimalNotation,
    formatWithThousands,
    multiplyDecimalStrings,
} from '../utils/amountFormat.js';
// The Wallet Form Standard frame for the selected payment (From,
// Payment, Network fee, status slot, one action).
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    SummaryAddress,
    joinSummaryParts,
    useFormSections,
} from '../components/formStandard/index.js';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { coinpayExpiryText } from '../../market/coinpayExpiry.js';
import { baseUnitsToCoinText, obligationBaseUnits } from '../../market/obligationStatus.js';
import { classifyObligation, countdownText } from '../../market/obligationStatus.js';
import { hasAttemptedCoinpay } from '../../market/coinpayPending.js';
import styles from './IssueTokenForm.module.css';
import facts from './FactRows.module.css';
import coinpayStyles from './CoinpayForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { addressValidationError, isValidAddressForChain } from '../utils/addressValidation.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Shown when an obligation's wall-clock deadline has passed (PC-15).
// Expiry only settles at the next block past the deadline, so the row
// can still read `pending_coinpay`; paying in that gap risks a
// confirm-after-expiry, which sends the coin with no token settlement.
const EXPIRED_ERROR = 'This payment window has expired. Do not pay: a payment '
    + 'confirming after the deadline sends your coin without receiving the '
    + 'tokens. The escrowed tokens return to the seller.';

const EXPIRY_LOSS_WARNING = 'This payment must confirm before the payment deadline. '
    + 'If it confirms after the deadline, the coin is still sent but you do not '
    + 'receive the tokens.';

/**
 * §41.4 COINPAY authoring surface. Settles a pending coinpay
 * obligation (created when a non-BTC token matched against a native
 * BTC/LTC/DOGE order). The user arrives here via:
 *   - The Home resume card, when a wallet address has a
 *     `pending_coinpay` obligation, OR
 *   - The ActionsMenu "Pay COINPAY" entry, which opens this form
 *     without a prefilled obligation and scans the wallet on mount.
 * The page has no picker: a named obligation opens that one, and an open
 * with none named takes the payment due soonest.
 *
 * Flow: form -> review -> submitting -> done. Nothing is signed
 * or broadcast until the user reaches the review stage and confirms.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]          preselected chain from the resume card
 * @param {string} [props.address]          preselected payer address (matches an address on `chainId`)
 * @param {string} [props.orderMatchActionIndex]  preselected obligation
 * @param {() => void} props.onBack
 */
export function CoinpayForm(props) {
    const scope = [
        props.walletId,
        props.chainId,
        props.address,
        props.orderMatchActionIndex,
    ].map((value) => String(value ?? '')).join('\u0000');
    return <ScopedCoinpayForm key={scope} {...props} />;
}

function ScopedCoinpayForm({
    walletId,
    chainId: initialChainId,
    address: initialAddress,
    orderMatchActionIndex: initialActionIndex,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState(/** @type {string | null} */ (null));
    const [obligations, setObligations] = useState(/** @type {any[]} */ ([]));
    const [selected, setSelected] = useState(
        /** @type {{ chainId: string, address: string, obligation: any } | null} */ (null),
    );
    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const formErrors = useFormErrors();
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [nativeBalance, setNativeBalance] = useState(
        /** @type {{ loading: boolean, baseUnits: bigint | null }} */
        ({ loading: false, baseUnits: null }),
    );
    // The standard sections' open state for the selected payment, and
    // a count of Review presses so the section holding a refusal reopens.
    const formSections = useFormSections({ from: false, main: true, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [errorSection, setErrorSection] = useState(/** @type {'main' | 'fee' | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                if (!byChain || Object.keys(byChain).length === 0) {
                    setLoadError(
                        'No addresses in this wallet. Paying a matched order requires a funded address.',
                    );
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setLoadError(loadFailureMessage(err, 'load this wallet\'s addresses'));
                }
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!addressesByChain) return undefined;
        // A demo wallet owes nothing and cannot pay: a demo wallet's addresses
        // never go to an explorer (issue #82).
        if (demoGuard.blocked) return undefined;
        let cancelled = false;
        setScanning(true);
        setScanError(null);
        setObligations([]);
        (async () => {
            /** @type {any[]} */
            const found = [];
            const pairs = [];
            const failures = [];
            for (const [cId, addrs] of Object.entries(addressesByChain)) {
                for (const addr of addrs) {
                    pairs.push({ chainId: cId, address: addr.address, addr });
                }
            }
            await Promise.all(pairs.map(async (pair) => {
                try {
                    const resp = await messaging.getCoinpayObligationsForAddress({
                        chainId: pair.chainId,
                        address: pair.address,
                    });
                    const rows = extractRows(resp);
                    const seenMatches = new Set();
                    for (const row of rows) {
                        if (!isPendingForPayer(row, pair.address)) continue;
                        // A match listed twice would render two rows under one key.
                        const matchKey = String(row.action_index ?? row.actionIndex);
                        if (seenMatches.has(matchKey)) continue;
                        seenMatches.add(matchKey);
                        found.push({
                            chainId: pair.chainId,
                            address: pair.address,
                            addr: pair.addr,
                            obligation: row,
                        });
                    }
                } catch (error) {
                    failures.push(error);
                }
            }));
            if (cancelled) return;
            setObligations(found);
            setScanning(false);
            setScanError(failures.length > 0
                ? loadFailureMessage(failures[0], 'load every payment due')
                : null);
            if (initialActionIndex) {
                // A named payment opens only itself; when it is gone the page
                // says so rather than offering a different one in its place.
                const match = found.find((f) =>
                    String(f.obligation.action_index) === String(initialActionIndex)
                    && (!initialChainId || f.chainId === initialChainId)
                    && (!initialAddress || f.address === initialAddress)
                );
                if (match) setSelected(match);
            } else {
                // A chain or payer passed without a match still narrows the pick.
                setSelected(soonestDue(found.filter((f) =>
                    (!initialChainId || f.chainId === initialChainId)
                    && (!initialAddress || f.address === initialAddress))));
            }
        })();
        return () => { cancelled = true; };
    }, [addressesByChain, messaging, initialActionIndex, initialChainId, initialAddress, demoGuard.blocked]);

    const descriptor = selected ? chainRegistry.get(selected.chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const ownerLane = useOwnerActionLane({
        messaging,
        walletId,
        chainId: selected?.chainId,
        owner: selected?.addr || null,
        software: 'coinpayAction',
        hardware: 'coinpayActionHw',
    });

    const summary = useMemo(() => {
        if (!selected) return null;
        const o = selected.obligation;
        const payeeAddress = o.payee_address || o.payeeAddress;
        const actionIndex = o.action_index ?? o.actionIndex;
        const expiration = Number(o.expiration);
        return {
            actionIndex: actionIndex == null ? '' : String(actionIndex).trim(),
            payeeAddress,
            // Base-unit native amount. null when missing OR beyond safe
            // integer precision (large DOGE): both the real-broadcast and
            // watcher paths pass this straight to a native output, so an
            // imprecise value would mispay. Fail closed here (blocks
            // review) rather than sign a rounded output. Kept in sync with
            // coinpayAction's guard.
            coinAmount: safeBaseUnitAmount(o.coin_amount ?? o.coinAmount),
            expiration: Number.isFinite(expiration) ? expiration : null,
        };
    }, [selected]);
    // Display copy for the amount: coin scale with the ticker, matching the
    // Payments-due card. summary.coinAmount is base units and must never be
    // shown next to the ticker as if it were coins.
    const amountLabel = coinAmountLabel(summary?.coinAmount, coinTicker);
    const payCoinText = summary?.coinAmount != null ? baseUnitsToCoinText(String(summary.coinAmount)) : null;

    // You get: the match row names the token and its fill. One read per
    // page load, keyed on the match alone, so a fee change or Review and
    // Back never reads it again. The explorer's by-block match list carries
    // no ticks, so this reads the match action's own detail, which does.
    const matchChainId = selected?.chainId || '';
    const matchIndex = summary?.actionIndex || '';
    const [matchRead, setMatchRead] = useState(
        /** @type {{ key: string, status: 'loading' | 'ready' | 'failed', row: any }} */
        ({ key: '', status: 'loading', row: null }),
    );
    useEffect(() => {
        const key = `${matchChainId}\u0000${matchIndex}`;
        if (!matchChainId) return undefined;
        // No match number (validation refuses the payment too): nothing to read.
        if (!matchIndex || typeof messaging.getActionByIndex !== 'function') {
            setMatchRead({ key, status: 'failed', row: null });
            return undefined;
        }
        let cancelled = false;
        setMatchRead({ key, status: 'loading', row: null });
        Promise.resolve()
            .then(() => messaging.getActionByIndex({ chainId: matchChainId, actionIndex: matchIndex }))
            .then((resp) => {
                if (!cancelled) setMatchRead({ key, status: 'ready', row: unwrapActionDetail(resp) });
            }, () => {
                if (!cancelled) setMatchRead({ key, status: 'failed', row: null });
            });
        return () => { cancelled = true; };
    }, [matchChainId, matchIndex, messaging]);
    const youGet = useMemo(() => {
        if (matchRead.key !== `${matchChainId}\u0000${matchIndex}`) return { status: 'loading' };
        if (matchRead.status !== 'ready') return { status: matchRead.status };
        const side = coinpayTokenSide(matchRead.row, summary?.coinAmount, coinTicker);
        return side ? { status: 'ready', ...side } : { status: 'failed' };
    }, [matchRead, matchChainId, matchIndex, summary?.coinAmount, coinTicker]);

    // Fiat under each amount: the wallet's own price sources, on the same
    // terms as Stake detail: only an obligation on a mainnet chain is priced,
    // never one on a test network. A token the wallet cannot price shows no
    // fiat line.
    const { settings } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const locale = settings?.language || 'en-US';
    const fiatOn = descriptor?.networkKind === 'mainnet';
    const allowCoingeckoFallback = Boolean(settings) && settings?.privacy?.priceDataEnabled !== false;
    const coinRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick: coinTicker,
        nativeTicker: coinTicker,
        fiatCurrency,
        allowCoingeckoFallback,
        enabled: fiatOn && Boolean(coinTicker),
    });
    const tokenRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick: youGet.tick || '',
        nativeTicker: coinTicker,
        fiatCurrency,
        allowCoingeckoFallback,
        enabled: fiatOn && Boolean(coinTicker) && Boolean(youGet.tick),
    });
    const payFiat = fiatOn ? fiatText(payCoinText, coinRate?.rate, fiatCurrency, locale) : null;
    const getFiat = fiatOn && youGet.tick ? fiatText(youGet.amount, tokenRate?.rate, fiatCurrency, locale) : null;

    // Network fee: Low / Normal / Fast / Custom, editable via FeeSelector on
    // the obligation-confirm stage. `feeEstimate` backs the slider readout and
    // the review row; `feePerKb` prices the broadcast. Mirrors ComposeMessage.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => (selected?.chainId
            ? estimateNativeSendFeeTiers({ chainId: selected.chainId, chainRegistry })
            : null),
        [selected],
    );
    const feeCustomEstimate = useMemo(
        () => (selected?.chainId && feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: selected.chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [selected, feePick],
    );
    const feeEstimate = !selected?.chainId
        ? null
        : (feePick.mode === 'custom'
            ? feeCustomEstimate
            : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: selected.chainId, chainRegistry, speed: feePick.mode })));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;
    const validationError = obligationValidationError({
        selected,
        summary,
        descriptor,
        feePick,
        feeEstimate,
        feePerKb,
    });
    const requiredBaseUnits = summary?.coinAmount == null
        ? null
        : BigInt(summary.coinAmount) + BigInt(feeEstimate?.sats || 0);
    const insufficientBalance = nativeBalance.baseUnits != null
        && requiredBaseUnits != null
        && nativeBalance.baseUnits < requiredBaseUnits;
    const insufficientBalanceMessage = insufficientBalance
        ? `Insufficient ${coinTicker || 'coin'} balance. This address has ${coinAmountLabel(nativeBalance.baseUnits, coinTicker)}, but the payment and estimated network fee require ${coinAmountLabel(requiredBaseUnits, coinTicker)}.`
        : null;

    useEffect(() => {
        if (!selected?.chainId || !selected?.address) {
            setNativeBalance({ loading: false, baseUnits: null });
            return undefined;
        }
        if (typeof messaging.getAddressBalances !== 'function') {
            setNativeBalance({ loading: false, baseUnits: null });
            return undefined;
        }
        let cancelled = false;
        setNativeBalance({ loading: true, baseUnits: null });
        messaging.getAddressBalances(selected.chainId, selected.address)
            .then((balances) => {
                if (cancelled) return;
                setNativeBalance({
                    loading: false,
                    baseUnits: nativeBalanceBaseUnits(balances, coinTicker),
                });
            })
            .catch(() => {
                if (!cancelled) setNativeBalance({ loading: false, baseUnits: null });
            });
        return () => { cancelled = true; };
    }, [selected?.chainId, selected?.address, coinTicker, messaging]);

    // Validate the selected obligation before advancing to review.
    // Signs nothing; just gates stage transition.
    function handleReview(event) {
        event.preventDefault();
        // Every press counts, so the section holding the refused
        // value (the fee, else the payment) reopens even after being closed.
        setReviewAttempt((n) => n + 1);
        setErrorSection('main');
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) setErrorSection('fee');
        const paymentError = !selected || !summary
            ? 'Choose a payment before continuing.'
            : validationError || insufficientBalanceMessage
                || (classifyObligation(summary.expiration).state === 'expired' ? EXPIRED_ERROR : null);
        if (!formErrors.validate({
            'form:coinpay-fee': feeStop?.formError,
            'coinpay-payment': paymentError,
        }) || feeStop) return;
        setSubmitError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || ownerLane.composing) return;
        if (!selected || !summary) {
            formErrors.validate({ 'coinpay-payment': 'Choose a payment before continuing.' });
            return;
        }
        if (validationError) {
            setSubmitError(validationError);
            setStage('review');
            return;
        }
        if (insufficientBalance) {
            setSubmitError(insufficientBalanceMessage);
            return;
        }
        // PC-15 funds-safety re-check at sign time: the deadline can pass
        // while the user sits on the review screen, and a COINPAY that
        // confirms after expiry burns the coin with no token settlement.
        if (classifyObligation(summary.expiration).state === 'expired') {
            setSubmitError(EXPIRED_ERROR);
            setStage('review');
            return;
        }
        setStage('submitting');
        setSubmitError(null);
        try {
            // The explorer keeps listing the obligation until the payment
            // confirms, so a payment already signed or broadcast from this wallet
            // for the same match must stop a second one. An unreadable list is
            // unknown, never a refusal.
            const ownRows = typeof messaging.getPendingTxsForAddress === 'function'
                ? await messaging.getPendingTxsForAddress({
                    chainId: selected.chainId, address: selected.addr.address,
                }).catch(() => null)
                : null;
            const ownList = Array.isArray(ownRows) ? ownRows : (ownRows?.rows || ownRows?.data || []);
            if (hasAttemptedCoinpay(ownList, summary.actionIndex)) {
                setSubmitError('A payment for this order is already on its way from this wallet. Wait for it to confirm before paying again.');
                setStage('review');
                return;
            }
            const from = {
                address: selected.addr.address,
                publicKey: selected.addr.publicKey,
                derivationPath: selected.addr.derivationPath,
                addressId: selected.addr.id,
                source: selected.addr.source,
                signerId: selected.addr.signerId,
            };
            const base = {
                walletId,
                chainId: selected.chainId,
                from,
                orderMatchActionIndex: summary.actionIndex,
                payeeAddress: summary.payeeAddress,
                coinAmount: summary.coinAmount,
            };
            let r;
            if (ownerLane.isWatcherMode) {
                // Goes through the COINPAY-specific encode route, which
                // re-verifies the obligation before building the native output.
                // The generic buildActionPsbtRequest would happily encode a
                // payment to whatever payee/amount this screen handed it, and an
                // air-gapped signer only ever sees the outputs it is given.
                r = await messaging.buildCoinpayPsbtRequest({
                    ...base,
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else {
                // Compose the native payment output into the same PSBT that the
                // shared screen dry-runs and later hands to the signing flow.
                r = await ownerLane.run({
                    actionData: {
                        action: 'COINPAY',
                        params: { VERSION: '0', ORDER_MATCH_ACTION_INDEX: summary.actionIndex },
                    },
                    encoderOpts: {
                        customOutputs: [{ address: summary.payeeAddress, value: summary.coinAmount }],
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    submitExtra: {
                        orderMatchActionIndex: summary.actionIndex,
                        payeeAddress: summary.payeeAddress,
                        coinAmount: summary.coinAmount,
                    },
                });
            }
            setResult(r);
            setStage('done');
            // Only drop the obligation locally on a real broadcast; in
            // watcher mode the obligation stays open until the signed
            // PSBT actually broadcasts on a Full-mode wallet.
            if (!ownerLane.isWatcherMode) {
                setObligations((prev) => prev.filter((o) =>
                    !(o.chainId === selected.chainId
                      && String(o.obligation.action_index) === summary.actionIndex),
                ));
            }
        } catch (err) {
            if (isUserRejection(err)) {
                setStage('review');
                return;
            }
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: selected.chainId,
                coinTicker,
                verb: 'prepare this payment',
                fallback: "Couldn't prepare this payment. Check your connection and try again.",
            }));
            setStage('review');
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

    const titleText = (stage === 'review' || stage === 'submitting')
        ? 'Review Payment'
        : 'Pay for Matched Order';
    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={titleText}
        />
    );
    const wrap = (children, template = 'list') => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {template === 'list' ? <ListPage>{children}</ListPage> : children}
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

    if (ownerLane.open) {
        // The coin payment the matched order is owed, to its payee.
        const payCoins = summary?.coinAmount != null ? baseUnitsToCoinText(String(summary.coinAmount)) : null;
        const paySummary = {
            verb: t('components.confirmSummary.verbPay'),
            ...(payCoins && coinTicker ? { amount: payCoins, ticker: coinTicker } : {}),
            direction: 'out',
            chainId: selected?.chainId,
            address: selected?.addr?.address,
            ...(summary?.payeeAddress ? { recipient: summary.payeeAddress } : {}),
        };
        return (
            <ActionConfirmScreen
                {...ownerLane.confirmProps}
                summary={paySummary}
                screenVariant={variant}
                feeEstimate={feeEstimate}
                chainLabel={descriptor?.displayName || selected?.chainId}
                signerReady={signerReady}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result?.unsaved} />);
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <>
                <StatusMessage variant="success">
                    Payment broadcast successfully.
                </StatusMessage>
                {txid ? (
                    <p className={coinpayStyles.txid}>
                        Transaction: <code>{txid}</code>
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    // Review + submitting: show the obligation details, sign credentials,
    // and the confirm button. No signing happens until this stage.
    if (stage === 'review' || stage === 'submitting') {
        const feeRateLabel = feeEstimate?.rate || 'Unavailable';

        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review matched order payment"
                onSubmit={handleSubmit}
                errors={formErrors}
                status={submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : stage === 'submitting' ? (
                    <StatusMessage>Preparing payment for confirmation…</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="success"
                        icon={ownerLane.isWatcherMode ? <Icon.SignIcon /> : <Icon.TokenIcon />}
                        loading={stage === 'submitting' || ownerLane.composing}
                    >
                        {/* A verb only, never the amount or ticker
                            (the rows above state what is paid). */}
                        {ownerLane.isWatcherMode
                            ? 'Create Unsigned Transaction'
                            : 'Pay'}
                    </Button>
                )}
            >
                <dl id="coinpay-payment" className={styles.detailsList}>
                    {descriptor ? (
                        <DetailRow
                            label="Network"
                            value={<ChainBadge descriptor={descriptor} size="sm" showName={false} />}
                        />
                    ) : null}
                    <DetailRow
                        label="From"
                        value={<AddressText address={selected.address} />}
                    />
                    <DetailRow
                        label="Matched order"
                        value={<code>{summary.actionIndex}</code>}
                    />
                    <DetailRow
                        label="Paying to"
                        value={<AddressText address={summary.payeeAddress} />}
                    />
                    <DetailRow
                        label="Amount"
                        value={amountLabel}
                    />
                    {coinpayExpiryText(summary.expiration) ? (
                        <DetailRow label="Payment deadline" value={coinpayExpiryText(summary.expiration)} />
                    ) : null}
                    <DetailRow label="Network fee rate" value={feeRateLabel} />
                </dl>

                <FormNotice variant="status">{EXPIRY_LOSS_WARNING}</FormNotice>

                {ownerLane.isWatcherMode ? (
                    <p className={styles.hint}>
                        {t('common.watcherBuildsUnsigned')}
                    </p>
                ) : null}
            </FormPage>,
            'form',
        );
    }

    // Form stage: the one payment this page was opened for (or the one due
    // soonest), with no picker. No credentials shown here; the user
    // advances to review before signing.
    return wrap(
        <>
            {addressesByChain === null ? (
                <p className={styles.hint}>Loading addresses…</p>
            ) : null}
            {scanning && obligations.length === 0 ? (
                <p className={styles.hint}>Scanning for payments due…</p>
            ) : null}
            {scanError ? (
                <StatusMessage variant="error">{scanError}</StatusMessage>
            ) : null}
            {addressesByChain !== null && !scanning && !scanError && obligations.length === 0 ? (
                <EmptyState
                    title="No order selected"
                    body="Open a matched order from Payments due to pay it."
                />
            ) : null}
            {!scanning && !scanError && obligations.length > 0 && !selected ? (
                <EmptyState
                    title="Payment not found"
                    body="This payment is no longer due; Payments due lists what this wallet owes."
                />
            ) : null}

            {selected && summary ? (
                <FormFrame
                    demoGuard={demoGuard}
                    label="Selected payment"
                    onSubmit={handleReview}
                    errors={formErrors}
                    data-form-standard="coinpay"
                    status={[submitError ? (
                        <StatusMessage key="error" variant="error">
                            {submitError}
                        </StatusMessage>
                    ) : nativeBalance.loading ? (
                        <StatusMessage key="balance">Checking available balance…</StatusMessage>
                    ) : null]}
                    action={(
                        <FormAction
                            icon={<Icon.TokenIcon />}
                            loading={nativeBalance.loading}
                        >
                            Pay Order
                        </FormAction>
                    )}
                    /* From holds the network and the paying address.
                       Both are fixed by the matched order, so the Network is
                       locked and the address picker shows locked. */
                    from={(
                        <FromSection
                            {...formSections.bind('from')}
                            chainId={selected.chainId}
                            chainRegistry={chainRegistry}
                            lockNetwork
                            networkHelp="The chain this order is paid on. It is fixed by the matched order."
                            address={selected.address}
                            addressHelp="The address that owes this payment. It is fixed by the matched order."
                            pickerLockedReason="The matched order fixes the paying address"
                        />
                    )}
                    fee={(
                        <FeeSection
                            {...formSections.bind('fee')}
                            // The payment goes to one exact payee from the order's own
                            // inputs, so coin control and a custom change address cannot apply.
                            advanced={{ coins: false, change: false }}
                            chainId={selected.chainId}
                            coinTicker={coinTicker}
                            tiers={feeTiers}
                            value={feePick}
                            onChange={setFeePick}
                            customEstimate={feeCustomEstimate}
                            revealKey={submitError && errorSection === 'fee' ? reviewAttempt + 1 : 0}
                        />
                    )}
                >
                    <FormSection
                        id="main"
                        title="Payment"
                        icon={Icon.TokenIcon}
                        {...formSections.bind('main')}
                        revealKey={submitError && errorSection === 'main' ? reviewAttempt + 1 : 0}
                        summary={joinSummaryParts([
                            amountLabel,
                            summary.payeeAddress ? <>to <SummaryAddress address={summary.payeeAddress} /></> : null,
                        ], ' ') || null}
                    >
                    {/* One compact facts list: the amounts are fixed by the match. */}
                    <dl id="coinpay-payment" className={facts.list} data-coinpay-facts="">
                        <dt className={facts.label}>You pay</dt>
                        <dd className={facts.value}>
                            <span className={coinpayStyles.amountWithIcon}>
                                {coinTicker ? (
                                    <TickerIcon chainId={selected.chainId} tick={coinTicker} context="header" />
                                ) : null}
                                <span>
                                    {`${payCoinText ?? amountLabel}${coinTicker && payCoinText != null ? ` ${coinTicker}` : ''}`}
                                    {payFiat ? <span className={coinpayStyles.boxFiat}>{` ≈ ${payFiat}`}</span> : null}
                                </span>
                            </span>
                        </dd>
                        {youGet.status !== 'failed' ? (
                            <>
                                <dt className={facts.label}>You get</dt>
                                <dd className={facts.value} aria-busy={youGet.status === 'loading' || undefined}>
                                    {youGet.status === 'loading' ? (
                                        <Skeleton shape="text" width="8em" ariaLabel="Loading you get" />
                                    ) : (
                                        <span className={coinpayStyles.amountWithIcon}>
                                            {youGet.tick ? (
                                                <TickerIcon chainId={selected.chainId} tick={youGet.tick} context="header" />
                                            ) : null}
                                            <span>
                                                {`${youGet.amount ? formatWithThousands(youGet.amount, locale) : ''} ${youGet.tick || ''}`.trim()}
                                                {getFiat ? <span className={coinpayStyles.boxFiat}>{` ≈ ${getFiat}`}</span> : null}
                                            </span>
                                        </span>
                                    )}
                                </dd>
                            </>
                        ) : null}
                        {coinpayExpiryText(summary.expiration) ? (
                            <>
                                <dt className={facts.label}>Time left</dt>
                                <dd className={facts.value}>
                                    <TimeLeftPill expiration={summary.expiration} />
                                </dd>
                            </>
                        ) : null}
                        <dt className={facts.label}>Pay to</dt>
                        <dd className={facts.value}>
                            <AddressText address={summary.payeeAddress} />
                        </dd>
                        <dt className={facts.label}>Matched order</dt>
                        <dd className={facts.value}>#{summary.actionIndex}</dd>
                    </dl>
                    </FormSection>
                </FormFrame>
            ) : null}
        </>,
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

// Under an hour left the pill turns red, so a payment that still needs
// time to confirm stands out before the deadline does.
const URGENT_SECONDS = 60 * 60;

/** The Time left pill, counting down on its own so the form does not re-render each second. */
function TimeLeftPill({ expiration }) {
    const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const id = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(id);
    }, []);
    const { state, secondsLeft } = classifyObligation(expiration, nowSeconds);
    if (state === 'expired') {
        return <span className={`${coinpayStyles.pill} ${coinpayStyles.pillUrgent}`}>Expired, do not pay</span>;
    }
    const countdown = countdownText(secondsLeft);
    if (!countdown) return null;
    const urgent = secondsLeft != null && secondsLeft < URGENT_SECONDS;
    return (
        <span
            className={`${coinpayStyles.pill}${urgent ? ` ${coinpayStyles.pillUrgent}` : ''}`}
            data-urgent={urgent ? 'true' : undefined}
        >
            {`${countdown} left`}
        </span>
    );
}

// With no payment named, the page opens the one due soonest that can still
// be paid (an expired one only when nothing else is due). The scan collects
// rows in network-reply order, so the pick sorts rather than taking the first.
function soonestDue(found) {
    if (!Array.isArray(found) || found.length === 0) return null;
    const deadline = (row) => {
        const n = Number(row.obligation.expiration);
        return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
    };
    const byDeadline = (a, b) => deadline(a) - deadline(b)
        || String(a.obligation.action_index).localeCompare(String(b.obligation.action_index));
    const open = found.filter((row) => classifyObligation(row.obligation.expiration).state !== 'expired');
    return [...(open.length > 0 ? open : found)].sort(byDeadline)[0];
}

// The explorer's action detail arrives wrapped as { data }, as a one-row
// array, or nested under `action`; this returns the row itself or null.
function unwrapActionDetail(body) {
    if (!body || typeof body !== 'object') return null;
    let row = body.data !== undefined && body.data !== null ? body.data : body;
    if (Array.isArray(row)) row = row.length > 0 ? row[0] : null;
    if (!row || typeof row !== 'object') return null;
    if (row.action && typeof row.action === 'object' && !Array.isArray(row.action)
        && row.action.action_index !== undefined) return row.action;
    return row;
}

/**
 * The token side of a COINPAY match row: { tick, amount } or null.
 *
 * Each order_matches row stores both sides' ticks and amounts from one
 * order's point of view (see autopayPolicy orientMatch), so a tick and the
 * amount beside it always pair. A COINPAY match trades the native coin for
 * a token: the coin side has a blank tick (or the coin's own ticker) and
 * the token side names its tick. The coin side must also be the amount this
 * obligation owes, so a row that does not fit is never shown as a guess.
 */
function coinpayTokenSide(row, coinBaseUnits, coinTicker) {
    if (!row || typeof row !== 'object' || coinBaseUnits == null) return null;
    const native = (tick) => {
        const text = String(tick ?? '').trim().toUpperCase();
        return text.length === 0 || (Boolean(coinTicker) && text === coinTicker);
    };
    const sides = [
        { tick: row.give_tick, amount: row.give_amount },
        { tick: row.get_tick, amount: row.get_amount },
    ];
    const coinSides = sides.filter((s) => native(s.tick));
    const tokenSides = sides.filter((s) => !native(s.tick));
    if (coinSides.length !== 1 || tokenSides.length !== 1) return null;
    const coinBase = obligationBaseUnits(coinSides[0].amount);
    if (coinBase === null || coinBase !== BigInt(coinBaseUnits)) return null;
    const amount = String(tokenSides[0].amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) return null;
    return { tick: String(tokenSides[0].tick).trim(), amount };
}

// "$102.40" for an amount at a rate, or null when either is missing.
function fiatText(amount, rate, currency, locale) {
    if (amount == null || amount === '' || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        return null;
    }
    const value = multiplyDecimalStrings(expandDecimalNotation(String(amount)), expandDecimalNotation(String(rate)));
    if (value == null) return null;
    return formatFiatAmount(value, currency, locale) || null;
}

function obligationValidationError({
    selected, summary, descriptor, feePick, feeEstimate, feePerKb,
}) {
    if (!selected || !summary) return null;
    if (!selected.chainId || !descriptor?.coin || !descriptor?.networkKind) {
        return 'This payment uses a network the wallet does not recognize. Return to Payments due and refresh.';
    }
    const sourceAddress = String(selected.addr?.address || '').trim();
    if (!sourceAddress || sourceAddress !== String(selected.address || '').trim()) {
        return 'The paying address no longer matches this wallet. Return to Payments due and refresh.';
    }
    if (!isValidAddressForChain(sourceAddress, descriptor.coin, descriptor.networkKind)) {
        return 'The paying address is not valid for this network. Return to Payments due and refresh.';
    }
    if (!summary.actionIndex) {
        return 'This payment has no matched order number. Return to Payments due and refresh.';
    }
    const payeeAddress = String(summary.payeeAddress || '').trim();
    if (!payeeAddress) {
        return 'This payment has no recipient address. Return to Payments due and refresh.';
    }
    if (!isValidAddressForChain(payeeAddress, descriptor.coin, descriptor.networkKind)) {
        return addressValidationError(payeeAddress, descriptor)
            || 'The recipient address is not valid for this network. Return to Payments due and refresh.';
    }
    if (summary.coinAmount == null) {
        return 'This payment amount is missing, invalid, or too large to pay safely. Return to Payments due and refresh.';
    }
    if (!coinpayExpiryText(summary.expiration)) {
        return 'This payment has no valid deadline. Return to Payments due and refresh.';
    }
    if (!feeEstimate || (feePick.mode === 'custom' && feePerKb == null)) {
        return 'Choose a valid network fee before continuing.';
    }
    return null;
}

function loadFailureMessage(error, verb) {
    return submitFailureMessage(error, {
        verb,
        fallback: `Couldn't ${verb}. Check your connection and try again.`,
    });
}

// Parse an obligation's coin_amount into a safe positive base-unit
// integer, or null. Rejects values past Number.MAX_SAFE_INTEGER so a
// large-DOGE obligation can't be rounded into a wrong native-coin output.
function safeBaseUnitAmount(raw) {
    // The explorer serves the obligation's coin_amount as the match's DECIMAL
    // coin figure in every shape ("10" is ten coins), so it goes through the
    // one canonical reader (obligationBaseUnits) and this function keeps its
    // own contract: a positive, exactly-representable base-unit NUMBER, or
    // null.
    const base = obligationBaseUnits(raw);
    if (base === null || base <= 0n) return null;
    const n = Number(base);
    if (!Number.isSafeInteger(n)) return null;
    return n;
}

// Coin-scale copy for a base-unit amount, with the ticker: "10 DOGE" for
// 1000000000. Falls back to a labelled base-unit figure rather than a
// coin-labelled wrong number when the amount cannot be converted.
function coinAmountLabel(baseUnits, coinTicker) {
    if (baseUnits == null) return null;
    const coinText = baseUnitsToCoinText(String(baseUnits));
    return coinText != null
        ? `${coinText} ${coinTicker || 'coins'}`
        : `${baseUnits} base units`;
}

function nativeBalanceBaseUnits(balances, coinTicker) {
    const native = balances?.native;
    if (!native || (coinTicker && String(native.tick || '').toUpperCase() !== coinTicker)) {
        return null;
    }
    const quantity = String(native.quantity ?? '').trim();
    if (!/^\d+$/.test(quantity)) return null;
    try {
        return BigInt(quantity);
    } catch {
        return null;
    }
}

function isPendingForPayer(row, address) {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.coinpay_status || row.status || '').toLowerCase();
    if (status !== 'pending_coinpay') return false;
    const payer = row.payer_address || row.payerAddress;
    return typeof payer === 'string' && payer === address;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.obligations)) return resp.obligations;
    if (Array.isArray(resp.coinpay_obligations)) return resp.coinpay_obligations;
    return [];
}
