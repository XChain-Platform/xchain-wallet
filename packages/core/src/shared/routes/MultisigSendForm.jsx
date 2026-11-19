// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useEffect, useMemo, useState } from 'react';
// FormPage, Button and FeeSelector come through the standard frame.
import { AddressField, FormNotice, Icon, Input, useFormErrors } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
// The Wallet Form Standard frame (From, Payment, Network fee, action).
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
import {
    customFeeEstimate,
    customFeeReviewStop,
    displayRateToPerByte,
    estimateNativeSendFeeTiers,
} from '../../flows/feeEstimate.js';
import {
    nativeUnitScaleFor,
    tickerForDescriptor,
} from '../../registry/coinTicker.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/multisig.js';
import { useMessaging } from '../useMessaging.js';

const chainRegistry = registryLib.defaultRegistry();
const TAPROOT_MESSAGE = 'Sending from a Taproot multisig is not available yet.';

function amountToBaseUnits(raw, descriptor) {
    const value = String(raw || '').trim();
    const decimals = String(nativeUnitScaleFor(descriptor)).length - 1;
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match || (match[2] || '').length > decimals) return null;
    return BigInt(match[1]) * nativeUnitScaleFor(descriptor)
        + BigInt((match[2] || '').padEnd(decimals, '0') || '0');
}

/** Native-coin spend form for one persisted multisig source. */
export function MultisigSendForm({
    walletId,
    chainId,
    multisigConfigId,
    multisig,
    onSessionStarted,
    onChangeSource,
    wrapPage = (page) => page,
}) {
    const { messaging } = useMessaging();
    const descriptor = chainRegistry.get(chainId);
    const [to, setTo] = useState('');
    const [amount, setAmount] = useState('');
    const [feePick, setFeePick] = useState({ mode: 'normal' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [resolved, setResolved] = useState(multisig || null);
    const formErrors = useFormErrors();
    // The standard sections' open state; From and the fee start
    // closed, Payment open. A fee refusal reopens the fee row on each try.
    const formSections = useFormSections({ from: false, payment: true, fee: false });
    const [feeErrorKey, setFeeErrorKey] = useState(0);

    useEffect(() => {
        if (multisig) {
            setResolved(multisig);
            return undefined;
        }
        let cancelled = false;
        messaging.listMultisigReceiveAddresses({ walletId, chainId })
            .then((rows) => {
                if (!cancelled) setResolved((rows || []).find((row) => row.multisigConfigId === multisigConfigId) || null);
            })
            .catch((err) => { if (!cancelled) setError(userFacingMessage(err, 'Could not load this multisig.')); });
        return () => { cancelled = true; };
    }, [walletId, chainId, multisigConfigId, multisig, messaging]);

    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const selectedEstimate = feePick.mode === 'custom'
        ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
        : feeTiers?.[feePick.mode];
    const rateValue = selectedEstimate?.rateValue;
    const feeRate = selectedEstimate?.unit && Number.isFinite(rateValue)
        ? displayRateToPerByte(selectedEstimate.unit, rateValue)
        : null;
    const amountSats = amountToBaseUnits(amount, descriptor);
    const taproot = resolved?.scheme === 'taproot-musig2';

    async function submit(event) {
        event.preventDefault();
        if (busy || taproot || !resolved) return;
        if (!formErrors.validate({
            'multisig-send-to': !to.trim() ? 'Enter the destination address.' : null,
            'multisig-send-amount': !amountSats || amountSats <= 0n
                ? `Enter an amount above 0 ${tickerForDescriptor(descriptor)}.`
                : null,
            'form:fee': !feeRate ? 'Choose a network fee.' : null,
        })) return;
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: selectedEstimate });
        // A custom-fee refusal opens the Network fee section.
        if (feeStop) {
            formErrors.validate({ 'form:fee': feeStop.formError });
            setFeeErrorKey((k) => k + 1);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const session = await messaging.startMultisigSend({
                walletId,
                chainId,
                multisigConfigId,
                destination: to.trim(),
                amountSats: amountSats.toString(),
                feeRate,
            });
            onSessionStarted?.(session?.id);
        } catch (err) {
            setError(userFacingMessage(err, 'Could not start the signing session.'));
        } finally {
            setBusy(false);
        }
    }

    // Closed-section summary, "0.001 BTC to bc1q...0a2".
    const ticker = tickerForDescriptor(descriptor);
    const paymentSummary = joinSummaryParts([
        amount.trim() ? `${amount.trim()} ${ticker}` : null,
        to.trim() ? <>to <SummaryAddress address={to.trim()} /></> : null,
    ], ' ') || null;

    // The standard order. From (closed) holds the network, which the
    // multisig decides, and the multisig address with its signature
    // threshold; Payment (open) holds To and Amount; then the Network fee row.
    return wrapPage(
        <FormFrame
            id="multisig-send-form"
            label="Send from multisig"
            onSubmit={submit}
            errors={formErrors}
            status={error ? <FormNotice variant="error">{error}</FormNotice> : null}
            action={(
                <FormAction
                    icon={<Icon.SendIcon />}
                    loading={busy}
                    disabled={taproot || !resolved}
                >
                    Start Signing
                </FormAction>
            )}
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={t('multisig.send.networkHelp')}
                    address={resolved?.address || null}
                    addressHelp={t('multisig.send.fromHelp')}
                    onOpenPicker={onChangeSource}
                    pickerLabel="Choose source address"
                    detail={resolved ? t('multisig.send.needsSignatures', { threshold: resolved.threshold, cosignerCount: resolved.cosignerCount }) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={ticker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={selectedEstimate}
                    revealKey={feeErrorKey}
                    formErrorKey="form:fee"
                    // A co-signer session fixes its inputs and change when it
                    // starts, so none of the Advanced options can apply.
                    advanced={false}
                />
            )}
        >
            <FormSection
                id="payment"
                title="Payment"
                icon={Icon.SendIcon}
                {...formSections.bind('payment')}
                summary={paymentSummary}
            >
                {taproot ? <FormNotice variant="warning">{TAPROOT_MESSAGE}</FormNotice> : null}
                <AddressField
                    id="multisig-send-to"
                    label="To"
                    help={t('multisig.send.toHelp')}
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    autoComplete="off"
                />
                <Input
                    id="multisig-send-amount"
                    label={`Amount (${ticker})`}
                    help={t('multisig.send.amountHelp')}
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    autoComplete="off"
                />
            </FormSection>
        </FormFrame>,
    );
}

export { TAPROOT_MESSAGE };

