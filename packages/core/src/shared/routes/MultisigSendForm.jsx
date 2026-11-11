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
import { AddressField, Button, FeeSelector, FormNotice, FormPage, Icon, Input } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
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
            .catch((err) => { if (!cancelled) setError(err?.message || 'Could not load this multisig.'); });
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
        if (busy || taproot || !resolved || !to.trim() || !amountSats || amountSats <= 0n || !feeRate) return;
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: selectedEstimate });
        if (feeStop) { setError(feeStop.formError); return; }
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
            setError(err?.message || 'Could not start the signing session.');
        } finally {
            setBusy(false);
        }
    }

    return wrapPage(
        <FormPage
            id="multisig-send-form"
            label="Send from multisig"
            onSubmit={submit}
            status={error ? <FormNotice variant="error">{error}</FormNotice> : null}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={<Icon.SendIcon />}
                    loading={busy}
                    disabled={busy || taproot || !resolved || !to.trim() || !amountSats || amountSats <= 0n || !feeRate}
                >
                    Start signing
                </Button>
            )}
        >
            <Input label="Network" value={descriptor?.name || chainId} readOnly />
            <AddressField
                label="From"
                icon="addresses"
                value={resolved?.address || ''}
                readOnly
                onChange={() => {}}
                onIconClick={onChangeSource}
                iconLabel="Choose source address"
            />
            {resolved ? <p>Needs {resolved.threshold} of {resolved.cosignerCount} signatures</p> : null}
            {taproot ? <FormNotice variant="warning">{TAPROOT_MESSAGE}</FormNotice> : null}
            <AddressField
                label="To"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                autoComplete="off"
            />
            <Input
                label={`Amount (${tickerForDescriptor(descriptor)})`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                autoComplete="off"
            />
            {feeTiers ? (
                <FeeSelector
                    chainId={chainId}
                    label="Network fee"
                    coinTicker={tickerForDescriptor(descriptor)}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? selectedEstimate : null}
                />
            ) : null}
        </FormPage>,
    );
}

export { TAPROOT_MESSAGE };

