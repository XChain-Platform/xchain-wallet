// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ActionConfirmScreen. Thin adapter that binds a form's
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
import { SignCredentials } from './SignCredentials.jsx';
import { SigningReadyNote } from '../safety/PanicFreezeNotice.jsx';
import { satsToCoinDecimal } from '../../flows/feeEstimate.js';
import { withOutcomeLabels } from '../utils/betOutcomeLabels.js';

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
 * @param {object} [props.hwSource]: the source address record when it is a
 *   HARDWARE signer. Supplying it swaps the password field for <HwSignBlock> (§5.1) and
 *   gates Approve on the device being available, so hardware signers get the same
 *   single-encode surface (and its output-set tamper check) as software ones instead of
 *   falling back to the legacy rebuild-on-Approve review stage.
 * @param {(state: { status: string }) => void} [props.onHwStatusChange]
 * @param {string} [props.hwStatus]      the parent's latest device status
 * @param {object|null} [props.hwSignerInfo]
 * @param {string} [props.chainId]
 * @param {(opts: object) => Promise<any>} [props.getSignerStatus]
 * @param {boolean} [props.hwRequireExplicitConfirm]   §18.5: the sign-risk
 *   classifier wants an explicit "I checked the device screen" tick before
 *   Approve enables. Send is the surface that uses it today.
 * @param {string|null} [props.hwRequireExplicitConfirmReason]
 * @param {(confirmed: boolean) => void} [props.onHwConfirmedChange]
 * @param {boolean} [props.hwExplicitConfirmed]        the caller's tick state
 * @param {string[]} [props.outcomeLabels]: a BET market's outcome labels, in
 *   wire order. The composed bytes carry the outcome as an index, so the host's decode
 *   can only say "outcome 0"; supplying the market's own labels NAMES that index
 *   without replacing it. Display-only annotation, and the only caller-supplied text
 *   this screen renders - see withOutcomeLabels for why it is neutralized first.
 */
export function ActionConfirmScreen({
    confirmAction,
    screenVariant = 'small',
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
    hwSource = null,
    onHwStatusChange,
    hwStatus,
    hwSignerInfo = null,
    chainId,
    getSignerStatus,
    hwRequireExplicitConfirm = false,
    hwRequireExplicitConfirmReason = null,
    onHwConfirmedChange,
    hwExplicitConfirmed = false,
    outcomeLabels = null,
}) {
    // A hardware signer has no password to type: readiness is the device being
    // connected, unlocked and on the right app - plus the §18.5 cross-check
    // tick when the risk classifier demands one. Approve stays disabled until
    // then, exactly as the legacy review stage gated its Sign button.
    const credsComplete = credentialsReady !== undefined
        ? credentialsReady
        : hwSource
            ? (hwStatus === 'available'
                && (!hwRequireExplicitConfirm || hwExplicitConfirmed))
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

    // (c): still the host's decode of the composed bytes, with the
    // outcome INDEX annotated by the market's own label for it. The index
    // survives verbatim, and a decode carrying no outcome row (every action
    // that is not a bet or a resolve) comes back untouched.
    const decoded = withOutcomeLabels(composed?.decoded, outcomeLabels);

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
            // §1.1 / §5.2.2: the intent describes what was actually COMPOSED,
            // not what the form believes it asked for. The host derives it from
            // the same parsed action string the deltas read (through
            // sdk.decoder.describe), so the two provably agree.
            //
            // There is no caller-supplied fallback any more, and the
            // absence is the point. A caller may legitimately have a better
            // SIMULATION than the generic one; no caller can have a better
            // account of what the encoder built than the encoder's own output.
            // While a fallback existed, a host that failed to describe would
            // silently seat form state on the screen that says what you are
            // signing. Now an undescribable action shows no intent line, which
            // is a visible absence rather than a plausible substitute.
            decoded={decoded}
            // §5.2.3: the host computes deltas from the PARSED COMPOSED action
            // (one canonical source with the intent above). A caller-supplied
            // simulation still wins, for surfaces that have a better one.
            simulation={simulation || composed?.simulation || null}
            error={confirmAction.error}
            chainLabel={chainLabel}
            feeText={exactFeeText || feeText}
            credentialsReady={credsComplete}
            credentials={(
                <>
                    {extraCredentials}
                    {hwSource ? (
                        // §5.1: the device block replaces the password field.
                        // SignCredentials already dispatches on fromAddress.source,
                        // so this is the same HW surface every legacy review stage
                        // rendered, not a second implementation of it.
                        <SignCredentials
                            fromAddress={hwSource}
                            chainId={chainId}
                            onStatusChange={onHwStatusChange}
                            getSignerStatus={getSignerStatus}
                            signerInfo={hwSignerInfo}
                            requireExplicitConfirm={hwRequireExplicitConfirm}
                            requireExplicitConfirmReason={hwRequireExplicitConfirmReason}
                            onConfirmedChange={onHwConfirmedChange}
                        />
                    ) : signerReady ? (
                        // This is the last screen before Approve & Sign,
                        // and panic mode makes "no password needed" a claim the
                        // wallet cannot honour. SigningReadyNote withdraws it
                        // whenever signing is frozen, and explains why only for
                        // a self-armed freeze.
                        <SigningReadyNote>
                            <p className={hintClassName}>
                                <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                            </p>
                        </SigningReadyNote>
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
