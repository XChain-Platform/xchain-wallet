// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ActionConfirmScreen . Thin adapter that binds a form's
// useActionConfirmFlow state to <ConfirmActionModal> and renders the
// credentials block every software action form shares: an optional
// form-specific gate (e.g. DestroyForm's typed DESTROY) followed by
// either the "wallet unlocked" note or the password field.
//
// Forms render this in place of their own body while
// `actionConfirm.open` is true, exactly like a picker screen.

import { Input } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { ConfirmActionModal } from './ConfirmActionModal.jsx';
import { satsToCoinDecimal } from '../../flows/feeEstimate.js';

const chainRegistry = registryLib.defaultRegistry();

// Native ticker for the §5.2.5 exact-fee line, resolved from the composed
// envelope's own chainId so no call site has to pass it.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
function nativeTickerFor(chainId) {
    const coin = chainId ? chainRegistry.get(chainId)?.coin : null;
    if (!coin) return '';
    return NATIVE_TICKER_BY_COIN[coin] || String(coin).toUpperCase();
}

/**
 * @param {object} props
 * @param {ReturnType<typeof import('../hooks/useActionConfirmFlow.js').useActionConfirmFlow>['confirmAction']} props.confirmAction
 * @param {'small'|'full'} [props.screenVariant]
 * @param {object|null} props.decoded            decodeAction output for the composed action
 * @param {string} props.chainLabel
 * @param {string} [props.feeText]               the form's rate ESTIMATE, used only as a
 *   fallback: when the composed PSBT knows its own fee (§5.2.5) that exact value wins
 * @param {string} [props.coinTicker]            ticker for the exact-fee line
 * @param {boolean} props.signerReady            wallet already unlocked (no password needed)
 * @param {string} props.password
 * @param {(value: string) => void} props.onPasswordChange
 * @param {boolean} [props.credentialsReady]     override; defaults to signerReady || password typed
 * @param {import('react').ReactNode} [props.extraCredentials]   form-specific gate rendered above the password
 * @param {string} [props.hintClassName]
 * @param {object|null} [props.simulation]
 */
export function ActionConfirmScreen({
    confirmAction,
    screenVariant = 'small',
    decoded,
    chainLabel,
    feeText,
    signerReady,
    password,
    onPasswordChange,
    credentialsReady,
    extraCredentials = null,
    hintClassName,
    simulation = null,
    coinTicker = '',
}) {
    const credsComplete = credentialsReady !== undefined
        ? credentialsReady
        : (signerReady || password.length > 0);

    // §5.2.5: prefer the fee the composed PSBT actually pays. The caller's
    // `feeText` is a rate-table estimate and is only shown when the exact fee
    // is unknowable (an input value missing from the PSBT), in which case it
    // stays labelled as an estimate rather than passing for the real thing.
    const composed = confirmAction.composed;
    const exactSats = composed?.networkFeeSats;
    const ticker = coinTicker || nativeTickerFor(composed?.chainId);
    const exactFeeText = Number.isFinite(exactSats)
        ? `Network fee: ${satsToCoinDecimal(exactSats)} ${ticker}`.trim()
        : null;

    return (
        <ConfirmActionModal
            screenVariant={screenVariant}
            phase={confirmAction.phase}
            composed={confirmAction.composed}
            report={confirmAction.report}
            reportLoading={confirmAction.phase === 'preflighting'}
            acknowledged={confirmAction.acknowledged}
            onAcknowledge={confirmAction.acknowledge}
            canApprove={confirmAction.canApprove}
            onApprove={confirmAction.approve}
            onReject={confirmAction.reject}
            decoded={decoded}
            simulation={simulation}
            error={confirmAction.error}
            chainLabel={chainLabel}
            feeText={exactFeeText || feeText}
            credentialsReady={credsComplete}
            credentials={(
                <>
                    {extraCredentials}
                    {signerReady ? (
                        <p className={hintClassName}>
                            <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                        </p>
                    ) : (
                        <Input
                            type="password"
                            label="Password"
                            hint="Required to sign."
                            value={password}
                            onChange={(e) => onPasswordChange(e.target.value)}
                            autoComplete="current-password"
                        />
                    )}
                </>
            )}
        />
    );
}
