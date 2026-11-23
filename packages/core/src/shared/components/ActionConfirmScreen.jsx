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

import { useCallback, useContext, useEffect, useState } from 'react';
import { Input } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { MessagingContext } from '../MessagingContext.js';
import { ConfirmActionModal, composedActionName } from './ConfirmActionModal.jsx';

// The confirm screen's warnings card, for a form's own review step (a watcher
// build) that says the same lines this screen does.
export { ActionWarningsCard } from './ConfirmActionModal.jsx';
import { summaryFromDecoded } from './ConfirmSummary.jsx';
import { SignCredentials } from './SignCredentials.jsx';
import { PanicPasswordGate, SigningReadyNote } from '../safety/PanicFreezeNotice.jsx';
import { formatNativeBaseUnits, tickerForDescriptor } from '../../registry/coinTicker.js';
import { withOutcomeLabels } from '../utils/betOutcomeLabels.js';
import { readActiveWallet } from '../utils/activeWalletMemory.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/confirmStandard.js';
import '../../i18n/locales/en/extension.js';

const chainRegistry = registryLib.defaultRegistry();

// Native ticker for the §5.2.5 exact-fee line, resolved from the composed
// envelope's own chainId so no call site has to pass it.
function nativeTickerFor(chainId) {
    return tickerForDescriptor(chainId ? chainRegistry.get(chainId) : null);
}

function useSourceIdentity(address, chainId, walletId) {
    const messaging = useContext(MessagingContext)?.messaging;
    const [identity, setIdentity] = useState({ label: '', walletName: '', wallet: null });

    useEffect(() => {
        let cancelled = false;
        setIdentity({ label: '', walletName: '', wallet: null });
        if (typeof messaging?.listWallets !== 'function') return undefined;

        Promise.resolve().then(() => messaging.listWallets()).then(async (walletsValue) => {
            const wallets = Array.isArray(walletsValue) ? walletsValue : [];
            const signingWallet = walletId
                ? wallets.find((wallet) => wallet.id === walletId)
                : null;
            if (!address || typeof messaging?.getAddressesByChain !== 'function') {
                if (!cancelled) {
                    setIdentity({
                        label: '',
                        walletName: '',
                        wallet: signingWallet || (wallets.length === 1 ? wallets[0] : null),
                    });
                }
                return;
            }
            const matches = await Promise.all(wallets.map(async (wallet) => {
                try {
                    const byChain = await messaging.getAddressesByChain(wallet.id);
                    const records = chainId
                        ? (byChain?.[chainId] || [])
                        : Object.values(byChain || {}).flat();
                    const wanted = String(address).toLowerCase();
                    const record = records.find((item) => (
                        String(item?.address || '').toLowerCase() === wanted
                    ));
                    return record ? { record, wallet } : null;
                } catch {
                    return null;
                }
            }));
            if (cancelled) return;
            const signingMatch = walletId
                ? matches.find((item) => item?.wallet?.id === walletId)
                : null;
            const match = signingMatch
                || matches.find((item) => item?.record?.label)
                || matches.find(Boolean);
            setIdentity({
                label: match?.record?.label || '',
                walletName: wallets.length > 1 ? (match?.wallet?.name || '') : '',
                wallet: signingWallet || match?.wallet || (wallets.length === 1 ? wallets[0] : null),
            });
        }).catch(() => {});

        return () => { cancelled = true; };
    }, [address, chainId, messaging, walletId]);

    return identity;
}

/**
 * @param {object} props
 * @param {ReturnType<typeof import('../hooks/useActionConfirmFlow.js').useActionConfirmFlow>['confirmAction']} props.confirmAction
 * @param {string} [props.walletId]              wallet whose source record signs the action
 * @param {'small'|'full'} [props.screenVariant]
 * @param {string} props.chainLabel
 * @param {string} [props.feeText]               accepted for callers; the page reads the fee as a
 *   figure (the composed fee, else `feeEstimate`), never as a sentence
 * @param {string} [props.coinTicker]            ticker for the exact-fee line
 * @param {string} [props.requestOrigin]         browser-verified requesting site
 * @param {boolean} props.signerReady            wallet already unlocked (no password needed)
 * @param {string} props.password
 * @param {(value: string) => void} props.onPasswordChange
 * @param {boolean} [props.credentialsReady]     override; defaults to signerReady || password typed
 * @param {import('react').ReactNode} [props.extraCredentials]   form-specific gate rendered above the password
 * @param {string[]} [props.extraWarnings]       form-specific points merged into the shared warning slot
 * @param {string} [props.warningTestId]         id placed inside that slot when the producer needs one
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
 * @param {(amount: string) => string|null} [props.formatNativeFee]
 * @param {(amount: string) => string|null} [props.formatProtocolFee]
 * @param {(parts: { native?: string[], protocol?: string|null }) => string|null} [props.formatFeeTotal]
 *   useFeeFiat's formatFeeTotal: prices coin and XCHAIN fees together for the Total's fiat line
 * @param {string} [props.totalText]             accepted for callers; the Total block sums the payment and fees itself
 * @param {{ coinAmount?: string|number|null } | null} [props.feeEstimate]   the form's network fee
 *   ESTIMATE (feeEstimate.js's shape). Used only when the composed PSBT does not know its own
 *   fee, and then labelled as an estimate; without it an unknown fee reads "plus network fee".
 * @param {import('./ConfirmSummary.jsx').ConfirmSummaryInput|null} [props.summary]   what the
 *   form already holds ({ verb, amount, ticker, chainId, direction, address, recipient,
 *   recipients, totals, networkFee, protocolFee, notice, facts }). `notice` is information the
 *   form no longer shows as a standing warning, a neutral notice under the facts card; `facts`
 *   ({ label, value }[]) are rows only the form knows, added to the facts card. Without a
 *   summary the sentence comes from the decoded action, or the action's name.
 */
export function ActionConfirmScreen({
    confirmAction,
    walletId: walletIdProp = null,
    screenVariant = 'small',
    chainLabel,
    signerReady,
    password,
    onPasswordChange,
    credentialsReady,
    extraCredentials = null,
    extraWarnings = [],
    warningTestId,
    hintClassName,
    simulation = null,
    coinTicker = '',
    requestOrigin = '',
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
    formatNativeFee,
    formatProtocolFee,
    formatFeeTotal,
    feeEstimate = null,
    summary = null,
}) {
    // The popup and side panel share the stored active wallet, so a switch in
    // one rewrites it under a review open in the other. The review names the
    // wallet that was active when it opened, which is the wallet it signs for.
    const [walletAtOpen] = useState(readActiveWallet);
    const walletId = walletIdProp || walletAtOpen;
    // A device that is only unplugged, or not connected since the app opened,
    // can still Approve: the hardware sign page then asks for it and its Try
    // again reconnects it, which a browser lets happen only after a click.
    const [hwReconnectable, setHwReconnectable] = useState(false);
    const handleHwStatus = useCallback((state) => {
        setHwReconnectable(state?.status === 'disconnected'
            || (state?.status === 'idle' && Boolean(state?.detail)));
        onHwStatusChange?.(state);
    }, [onHwStatusChange]);
    // A hardware signer has no password to type: readiness is the device being
    // connected, unlocked and on the right app (or reconnectable, above) - plus
    // the §18.5 cross-check tick when the risk classifier demands one. Until
    // then a tap on Approve sends nothing and says why (G130): the page's top
    // notice, and the password field's own error, which typing clears.
    const [passwordMissed, setPasswordMissed] = useState(false);
    const credsComplete = credentialsReady !== undefined
        ? credentialsReady
        : hwSource
            ? ((hwStatus === 'available' || hwReconnectable)
                && (!hwRequireExplicitConfirm || hwExplicitConfirmed))
            : (signerReady || password.length > 0);
    // What a tap on Approve names as missing: the password, the device, or a
    // form's own step above Approve (a typed confirmation word).
    const passwordMissing = !hwSource && !signerReady && !password;
    const credentialsBlockedText = credsComplete ? ''
        : passwordMissing ? t('confirmStandard.blocked.password')
            : hwSource
                ? ((hwStatus === 'available' || hwReconnectable) && hwRequireExplicitConfirm && !hwExplicitConfirmed
                    ? t('confirmStandard.blocked.deviceConfirm')
                    : t('confirmStandard.blocked.device'))
                : t('confirmStandard.blocked.confirmStep');

    // §5.2.5: prefer the fee the composed PSBT actually pays. The form's
    // estimate is used only when the exact fee is unknowable (an input value
    // missing from the PSBT), and it stays labelled as an estimate rather than
    // passing for the real thing.
    const composed = confirmAction.composed;
    const exactSats = composed?.networkFeeSats;
    const descriptor = composed?.chainId ? chainRegistry.get(composed.chainId) : null;
    const ticker = coinTicker || nativeTickerFor(composed?.chainId || chainId);
    const exactCoinAmount = Number.isFinite(exactSats)
        ? formatNativeBaseUnits(exactSats, descriptor)
        : null;
    const exactFeeFiat = exactCoinAmount && typeof formatNativeFee === 'function'
        ? formatNativeFee(exactCoinAmount)
        : null;
    // No change output: a remainder under the dust limit went to the fee.
    const dustChangeLimit = composed?.dustChangeLimitSats;
    const dustChange = Number.isFinite(dustChangeLimit) && dustChangeLimit > 0
        ? { amount: formatWithThousands(formatNativeBaseUnits(dustChangeLimit, descriptor)), ticker }
        : null;

    // (c): still the host's decode of the composed bytes, with the
    // outcome INDEX annotated by the market's own label for it. The index
    // survives verbatim, and a decode carrying no outcome row (every action
    // that is not a bet or a resolve) comes back untouched.
    const decoded = withOutcomeLabels(composed?.decoded, outcomeLabels);
    const amountDetail = decoded?.details?.find((detail) => detail?.label === 'Amount');
    const tokenDetail = decoded?.details?.find((detail) => detail?.label === 'Token');

    // #40: the spender, taken from the confirm hook rather than from a new
    // prop on all ~38 calling forms. Every form already passes `from` into
    // useActionConfirmFlow.run, which forwards it as `source`; the hook now
    // keeps it, so the row appears on every action surface at once and a new
    // form cannot forget to opt in. hwSource is the fallback for the same
    // value in record form, so a device signer is not the one case left blank.
    const sourceAddress = confirmAction.source || hwSource?.address || null;
    const sourceIdentity = useSourceIdentity(sourceAddress, composed?.chainId || chainId, walletId);
    const sourceName = [sourceIdentity.label, sourceIdentity.walletName].filter(Boolean).join(' · ');

    // K6: the hero and the address card. A form's own summary wins; any other
    // action shows what the host decoded, or its name when nothing was.
    // An amount and its ticker travel as a pair: a form that states either one
    // states the hero's figure, so a decoded amount is never shown beside the
    // form's ticker (a dividend's per-unit rate read as its total).
    const formStatesFigure = Boolean(summary) && ('amount' in summary || 'ticker' in summary);
    const resolvedSummary = {
        // A form summary overrides the decoded hero key by key, so a form that
        // only adds a notice keeps the decoded amount and verb.
        ...summaryFromDecoded({ decoded, actionName: composedActionName(composed) }),
        ...(formStatesFigure ? { amount: '', ticker: '' } : {}),
        ...(summary || {}),
        chainId: summary?.chainId || composed?.chainId || chainId,
    };
    if (!resolvedSummary.address && sourceAddress) resolvedSummary.address = sourceAddress;
    // The network fee as a figure: the composed transaction's exact fee, else
    // the form's estimate (its summary's, or the feeEstimate it computed),
    // which stays labelled as one.
    const estimateAmount = summary?.networkFee?.amount
        ? String(summary.networkFee.amount)
        : (feeEstimate?.coinAmount ? String(feeEstimate.coinAmount) : '');
    const networkFee = exactCoinAmount
        ? { amount: exactCoinAmount, ticker, fiat: exactFeeFiat, estimate: false }
        : estimateAmount
            ? {
                amount: estimateAmount,
                ticker: summary?.networkFee?.ticker || ticker,
                fiat: typeof formatNativeFee === 'function' ? formatNativeFee(estimateAmount) : null,
                estimate: true,
            }
            : null;
    // Native coin the action itself sends, so Total cost covers the payment
    // as well as its fees (a coin send), never a token amount.
    const summaryPaysCoin = summary?.direction === 'out'
        && summary?.amount
        && String(summary.ticker || '').toUpperCase() === String(ticker).toUpperCase();
    const paymentAmount = composed?.bareNativePayment
        && amountDetail?.value
        && String(tokenDetail?.value || '').toUpperCase() === String(ticker).toUpperCase()
        ? String(amountDetail.value)
        : (summaryPaysCoin ? String(summary.amount) : null);

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
            sourceAddress={sourceAddress}
            sourceName={sourceName}
            signingWallet={sourceIdentity.wallet}
            hardwareSigner={Boolean(hwSource)}
            chainLabel={chainLabel}
            requestOrigin={requestOrigin}
            nativeTicker={ticker}
            formatNativeFee={formatNativeFee}
            formatProtocolFee={formatProtocolFee}
            formatFeeTotal={formatFeeTotal}
            summary={resolvedSummary}
            networkFee={networkFee}
            paymentAmount={paymentAmount}
            dustChange={dustChange}
            extraWarnings={extraWarnings}
            warningTestId={warningTestId}
            credentialsReady={credsComplete}
            credentialsBlockedText={credentialsBlockedText}
            onApproveBlocked={(reason) => {
                if (reason === 'credentials' && passwordMissing) setPasswordMissed(true);
            }}
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
                            onStatusChange={handleHwStatus}
                            getSignerStatus={getSignerStatus}
                            signerInfo={hwSignerInfo}
                            requireExplicitConfirm={hwRequireExplicitConfirm}
                            requireExplicitConfirmReason={hwRequireExplicitConfirmReason}
                            onConfirmedChange={onHwConfirmedChange}
                        />
                    ) : signerReady ? (
                        // State a self-armed freeze without exposing a duress-armed freeze.
                        <SigningReadyNote />
                    ) : (
                        <PanicPasswordGate rejectLabel={t('extension.approval.reject')}>
                            <Input
                                type="password"
                                label={t('common.password')}
                                help={t('components.messageConfirmScreen.requiredToSign')}
                                value={password}
                                onChange={(e) => {
                                    setPasswordMissed(false);
                                    onPasswordChange(e.target.value);
                                }}
                                autoComplete="current-password"
                                error={passwordMissed && !password ? t('confirmStandard.blocked.passwordField') : undefined}
                            />
                        </PanicPasswordGate>
                    )}
                </>
            )}
        />
    );
}
