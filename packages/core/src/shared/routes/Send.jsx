// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isDeviceAddressSource } from '../../schemas/constants.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    CopyButton,
    Input,
    AddressCombobox,
    ChainBadge,
    AddressText,
    // FeeSelector renders inside the standard FeeSection.
    FieldNote,
    FormNotice,
    FormPage,
    ListPage,
    EmptyState,
    Icon,
    InfoTip,
    StatusMessage,
    useFormErrors,
    Tabs,
    // Network and From come from the standard FromSection.
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
    uri as uriLib,
} from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    coinFromChainId,
    formatFiat,
    isAssetImageSourceAllowed,
    tickerColor,
} from '../components/BalanceList.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
import { buildRecentDestinations } from '../../flows/recentDestinations.js';
import { addressValidationError, detectAddressCoin, isValidAddressForChain } from '../utils/addressValidation.js';
import { neutralizeControlText, ZERO_WIDTH } from '../utils/textHardening.js';
import { findLookalike } from '../utils/lookalike.js';
import { checkPasteIntegrity } from '../utils/pasteIntegrity.js';
import { humanizeError } from '../utils/humanizeError.js';
import {
    SIGNED_NOT_BROADCAST_TITLE,
    isSpentCoinsRefusal,
    submitFailureMessage,
} from '../utils/submitFailureMessage.js';
import { t } from '../../i18n/index.js';
import { revealFormStatus } from '../../ui/FormErrorSummary.jsx';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/scan.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/confirmStandard.js';
import '../../i18n/locales/en/demo.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/home.js';
import '../../i18n/locales/en/firstPaint.js';
import '../../i18n/locales/en/transactionStatus.js';
import '../../i18n/locales/en/ui.js';
import '../../i18n/locales/en/undoSend.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useSettings } from '../hooks/useSettings.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { getActiveNetwork } from '../../flows/effectiveNetwork.js';
import { activeNetworkLabel } from '../utils/activeNetworkSwitch.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { createSendConfirmSnapshot } from './send/confirmSnapshot.js';
import { isHwSignBack } from '../../signers/hardwareSession.js';
import { prebuiltPsbtFromComposed } from '../../flows/prebuiltPsbtFromComposed.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { UndoSendToast } from '../components/UndoSendToast.jsx';
import { PanicFreezeNotice, PanicPasswordGate, SigningReadyNote } from '../safety/PanicFreezeNotice.jsx';
import { panicRefusalMessage } from '../safety/panicNotice.js';
import {
    lookalikeWarningsEnabled,
    resolveFeeConfig,
    resolvePreflightPrivacy,
    resolveTestSendFiat,
} from '../../schemas/settings.js';
import { createUndoHoldId, createUndoSendRequest, isUndoSendCancellation } from '../../flows/undoSend.js';
import { checkRecipientNovelty } from '../../flows/recipientNovelty.js';
import { classifySignRisk } from '../../flows/signRiskClassifier.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { exitDemoWallet } from '../utils/demoGraduation.js';
import { DemoExitConfirm } from '../components/DemoExitConfirm.jsx';
import { summarizeSendLegs, totalsByTick } from '../../flows/sendLegs.js';
import {
    addRecipient as addMultiRecipient,
    MAX_MULTI_RECIPIENTS,
    newRecipientId,
    parseRecipientText,
    recipientListFitError,
    recipientsToText,
    recipientTotalsText,
    removeRecipient as removeMultiRecipient,
    updateRecipient as updateMultiRecipient,
    validateRecipient,
    withoutByteOrderMark,
} from '../../flows/multiSendRecipients.js';
import { AdvancedRecipientText, MultiRecipientList } from '../components/MultiSendRecipients.jsx';
import { ConfirmDecisionFooter, ConfirmStandard } from '../components/ConfirmStandard.jsx';
import {
    confirmStatus,
    confirmWarning,
    feeFacts,
    multiSendSentence,
    recipientFacts,
} from '../utils/confirmStandardModel.js';
import '../../i18n/locales/en/confirmStandard.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { Settings } from './Settings.jsx';
import { MultisigSendForm } from './MultisigSendForm.jsx';
import {
    hasAvailableChain,
    NO_CHAINS_BODY,
    NO_CHAINS_TITLE,
} from '../utils/chainAvailability.js';
import { findContactByName, withEntriesAdded } from '../utils/contactMerge.js';
import { contactEntryChain } from '../utils/contactChain.js';
import {
    formatNativeBaseUnits,
    nativeDecimalsFor,
    nativeUnitScaleFor,
    tickerForDescriptor,
} from '../../registry/coinTicker.js';

// Exact decimal-string -> satoshi conversion for the send-risk gates (#2249).
// The old Math.floor(parseFloat(x) * 1e8) accumulated IEEE-754 rounding error
// and biased downward, so an amount right at testSendThresholdSats (or a
// classifySignRisk band edge) could gate one satoshi off. String/BigInt math
// is exact; the submitted transaction already uses the exact decimal string,
// so this only aligns the gates with what actually gets sent. Returns a
// non-negative Number of sats, or null when the input is not a plain decimal.
export function exactSatsFromDecimalString(raw, chain = 'bitcoin') {
    const s = String(raw).trim();
    const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    const decimals = nativeDecimalsFor(chain);
    const frac = (m[2] || '').slice(0, decimals).padEnd(decimals, '0');
    const sats = BigInt(m[1]) * nativeUnitScaleFor(chain) + BigInt(frac || '0');
    // Gate thresholds live far below 2^53; clamp instead of silently losing
    // precision if someone types an absurd amount.
    return sats > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(sats);
}

// BigInt sibling of exactSatsFromDecimalString for amount *arithmetic*
// (Max sweep, small-test reduction), where the result feeds back into the
// amount field and eventually gets signed, so no clamp and no Number
// round-trip is acceptable. Also accepts a bare leading dot ('.5') the way
// parseFloat did, since this parses user-typed field values. Returns a
// non-negative BigInt of sats, or null when the input is not a plain decimal.
export function exactSatsBigIntFromDecimalString(raw, chain = 'bitcoin') {
    const s = String(raw).trim();
    const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return null;
    const decimals = nativeDecimalsFor(chain);
    const frac = (m[2] || '').slice(0, decimals).padEnd(decimals, '0');
    return BigInt(m[1] || '0') * nativeUnitScaleFor(chain) + BigInt(frac || '0');
}

// Exact sats -> plain decimal string, never scientific notation. The old
// Number(x.toFixed(8)).toString() path rendered 1 sat as '1e-8', which the
// encoder treats as a malformed AMOUNT. Trailing zeros are stripped for a
// tidy display; negative inputs clamp to '0'.
export function decimalStringFromSats(sats, chain = 'bitcoin') {
    const clamped = sats < 0n ? 0n : sats;
    return formatNativeBaseUnits(clamped, chain) || '0';
}

// The Max amount for a NON-native (token) balance: the balance string itself, validated
// as a plain non-zero decimal, or null when it is neither.
//
// The two helpers above are fixed at the 8-dp satoshi grid, which is right for a coin and
// wrong for a tick: ticks are issued up to MAX_TOKEN_DECIMALS = 18 places, and
// balanceAdapter already hands this balance over exact at the tick's own divisibility.
// Round-tripping it through them truncated a '1.000000000000000001' balance to '1' and
// made Max do nothing at all for any balance below one satoshi, on a string that is what
// gets signed.
export function exactTokenMaxAmount(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    if (/^0+(\.0+)?$/.test(s)) return null;
    return s;
}

function isPositiveDecimalAmount(raw) {
    const value = String(raw ?? '').trim();
    return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && /[1-9]/.test(value);
}

export function getUnusualSendWarnings({
    sendTotals,
    balances,
    feeAmount,
    nativeTicker,
    isNativeSend,
}) {
    const warnings = [];
    const balancesByTick = new Map((balances || []).map((balance) => [
        String(balance?.tick || '').trim().toUpperCase(),
        String(balance?.amount || '').trim(),
    ]));

    for (const total of sendTotals || []) {
        const tick = String(total?.tick || '').trim().toUpperCase();
        const balance = balancesByTick.get(tick);
        if (!tick || compareDecimalStrings(balance, '0') !== 1) continue;
        const threshold = multiplyDecimalStrings(balance, '0.9');
        if (threshold !== null && compareDecimalStrings(total?.amount, threshold) === 1) {
            warnings.push(`This sends more than 90% of your ${tick} balance.`);
        }
    }

    if (isNativeSend && nativeTicker && feeAmount) {
        const sent = (sendTotals || []).find(
            (total) => String(total?.tick || '').trim().toUpperCase() === nativeTicker,
        )?.amount;
        const threshold = multiplyDecimalStrings(sent, '0.1');
        if (threshold !== null && compareDecimalStrings(feeAmount, threshold) === 1) {
            warnings.push(
                `The network fee is more than 10% of the ${nativeTicker} amount you are sending.`,
            );
        }
    }

    return warnings;
}
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    fetchNativeSendFeeTiers,
    customFeeEstimate,
    settingsCustomToDisplayRate,
    displayRateToSettingsCustom,
    resolveFeeUnit,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { coinToFiatExact, fiatToCoin } from '../../flows/priceLookup.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { usePriceAlertPrices } from '../hooks/usePriceAlertPrices.js';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { HwSignBlock } from '../components/HwSignBlock.jsx';
import { useToast } from '../components/ToastHost.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { DraftNotice } from '../components/DraftNotice.jsx';
import { TokenPicker } from './TokenPicker.jsx';
// The standard token chooser, in place of a big coin icon hero.
import { TokenField } from '../components/TokenField.jsx';
import { useHaptic } from '../hooks/useHaptic.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useScreenShortcuts } from '../keyboard/useScreenShortcuts.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useUndoSend } from '../hooks/useUndoSend.js';
import { useReachability } from '../hooks/useReachability.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { BalancesUncheckedState } from '../components/BalancesUncheckedState.jsx';
import { HideReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { readBalanceCache } from '../utils/balanceCache.js';
import { useFormLeaveGuard } from '../hooks/useFormLeaveGuard.js';
import {
    useDispenserDestination,
    useDispenserDestinations,
    dispenserDestinationNotice,
    multiDispenserDestinationNotice,
} from '../hooks/useDispenserDestination.js';
import {
    formatWithThousands,
    formatDisplayAmount,
    groupDecodedAmounts,
    sumDecimalStrings,
    countNonCommaBefore,
    indexAfterNonCommaCount,
    compareDecimalStrings,
    decimalToBaseUnits,
    multiplyDecimalStrings,
    roundDecimalString,
} from '../utils/amountFormat.js';
import { dustThresholdForCoin } from '../../sdk/nativeFeePreflight.js';
import { encoderFieldError } from '../../sdk/encoderFieldErrors.js';
import { protocolDestinationFindings } from '../utils/protocolDestination.js';
// Ahead of this file's own sheet, so the shared button base loads first and
// the hero's rules follow it; a CSS-file composes would inline a second copy
// of Button.module.css.
import buttonStyles from '../../ui/Button.module.css';
import styles from './Send.module.css';
// Send is the reference form of the Wallet Form Standard; its
// sections, fee row, status slot and action come from the shared frame.
import {
    advancedKey,
    COIN_CONTROL_ROW_LIMIT,
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    MemoSection,
    selectedUtxosOf,
    joinSummaryParts,
    summaryLineWithAddress,
    useAdvancedEntry,
    useFormSections,
} from '../components/formStandard/index.js';
import { normalizeHistoryRow } from '../utils/historyRow.js';
import { pendingTxToEntry } from '../utils/pendingHistory.js';
import { classifyEntryStatusWithoutMempool } from '../utils/historyFilter.js';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import { PENDING_POLL_INTERVAL_MS } from '../../flows/balances.js';
import {
    hasAnyAddress,
    newestDerivedExternalId,
    signingAddressesByChain,
    WATCH_ONLY_SIGNING_MESSAGE,
} from '../addressSelection.js';
import { pickDefaultChainId, recordLastUsedChain } from '../chainSelection.js';
import { MAX_MEMO_LENGTH, memoCharacterError, memoLengthError } from '../utils/memoLimit.js';

// §30.5 user-initiated cancel detection. HW-device libraries surface a
// rejection as an Error whose message contains words like "cancelled",
// "rejected", or "denied" (Trezor: "Action cancelled by user"; Ledger:
// "Transaction was rejected"). Treat any of those as a deliberate user
// cancel rather than a Send failure so the UI returns to the composing
// form with a calm "Transaction cancelled." toast instead of a red error.
const USER_CANCEL_RE = /cancel|reject|denied/i;

// How long the first balance check may hold the Send form back.
const FIRST_BALANCE_GATE_MS = 1500;

// Coin control lists at most this many inputs (the shared Advanced section
// owns the list); re-exported for the tests that read it from here.
export { COIN_CONTROL_ROW_LIMIT };
// The form's id, which also keys its Advanced choices.
const SEND_FORM_ID = 'send-form';
const chainRegistry = registryLib.defaultRegistry();
// The single-send Token field reuses the recipient token picker
// state; this sentinel marks the picker as open for the first recipient.
const PRIMARY_TOKEN_PICKER = '__primary__';
// The same picker state, open for one of Multi's recipient editors.
const MULTI_TOKEN_PICKER = '__multi__';
const MULTI_ADD_TOKEN_PICKER = '__multi_add__';

// Descriptor.coin is the long-form coin name ('bitcoin' / 'litecoin' /
// 'dogecoin'); the user-facing native ticker is the short symbol the SDK
// emits as `b.native.tick` (BTC / LTC / DOGE). Uppercasing descriptor.coin
// directly compares against the wrong string ('BITCOIN' !== 'BTC') and
// breaks every "is this the native asset?" check downstream (most
// visibly the SelectedTokenHero, which falls through to the letter-badge
// + chain-overlay branch meant for tokens.
function nativeTickerFor(descriptor) {
    if (!descriptor?.coin) return null;
    return tickerForDescriptor(descriptor);
}

function hasMeaningfulSendDraft(values) {
    if (!values || typeof values !== 'object') return false;
    if ([values.toAddress, values.amount, values.memo, values.advancedText]
        .some((value) => String(value || '').trim().length > 0)) return true;
    if (Array.isArray(values.multiRecipients) && values.multiRecipients.length > 0) return true;

    const tick = String(values.tick || '').trim().toUpperCase();
    if (!tick) return false;
    const descriptor = typeof values.chainId === 'string'
        ? chainRegistry.get(values.chainId)
        : null;
    return tick !== nativeTickerFor(descriptor);
}

// The Multi list a saved draft holds: its own list when it was saved from
// the Multi or Advanced tab, else the first recipient plus the extra rows a
// draft from before the tabs kept. Nothing is cut to the cap here; an
// over-long list is refused with the limit when the user presses Send.
function restoredRecipients(values) {
    const text = (value) => (typeof value === 'string' ? value : '');
    if ((values?.sendMode === 'multi' || values?.sendMode === 'advanced') && Array.isArray(values.multiRecipients)) {
        return values.multiRecipients.flatMap((row) => (
            row && typeof row.id === 'string'
                ? [{ id: row.id, to: text(row.to), tick: text(row.tick).toUpperCase(), amount: text(row.amount) }]
                : []
        ));
    }
    const legs = Array.isArray(values?.extraLegs) ? values.extraLegs.filter((leg) => leg && typeof leg.id === 'string') : [];
    if (legs.length === 0) return [];
    const firstTick = text(values.tick).toUpperCase();
    return [
        { id: newRecipientId(), to: text(values.toAddress), tick: firstTick, amount: text(values.amount) },
        ...legs.map((leg) => ({
            id: leg.id,
            to: text(leg.to),
            tick: (values.perRecipientToken === true && text(leg.tick).trim() ? text(leg.tick) : firstTick).toUpperCase(),
            amount: text(leg.amount),
        })),
    ];
}

function utxoValueSats(utxo) {
    try {
        const value = BigInt(utxo?.value ?? 0);
        return value >= 0n ? value : null;
    } catch {
        return null;
    }
}

// Validate the destination against the chain the SEND will be broadcast on.
// A SEND pays an on-chain output on that chain, so an address for another coin,
// for the right coin on the wrong network, or simply mistyped, is unspendable:
// the tokens are gone. `addressValidationError` decodes the base58check checksum
// (or bech32) against that coin+network's parameters, so it catches all three -
// unlike a leading-character guess, which passes any typo that preserves the
// first letter and cannot tell mainnet from testnet on the shared 'm'/'n'/'2'
// leaders. Returns an error string, or null when the address is good (or when
// there is not yet a chain to validate against).
const COIN_DISPLAY = { bitcoin: 'Bitcoin', litecoin: 'Litecoin', dogecoin: 'Dogecoin' };

function destinationAddressError(address, descriptor) {
    const a = (address || '').trim();
    if (a && descriptor?.coin && descriptor?.networkKind
        && !isValidAddressForChain(a, descriptor.coin, descriptor.networkKind)) {
        // A different coin gets the plain "looks like" wording; the same coin on
        // another network, or a checksum typo, takes the network-aware copy.
        const detected = detectAddressCoin(a);
        if (detected && detected !== descriptor.coin) {
            const chainName = COIN_DISPLAY[descriptor.coin] || descriptor.coin;
            return `This looks like a ${COIN_DISPLAY[detected] || detected} address, not a ${chainName} address.`;
        }
    }
    return addressValidationError(address, descriptor);
}

function normalizePastedRecipient(value) {
    return String(value || '').replace(ZERO_WIDTH, '').trim();
}

const PASTED_SECRET_TYPES = new Set(['wif', 'mnemonic-bip39', 'mnemonic-counterwallet']);

// The kind of secret a paste carries: 'wif', 'mnemonic', or null. A payment
// link can hide one in its address slot, bare or percent-encoded, so the
// slot is classified as well as the whole text. The To field autosaves to a
// plaintext draft, so a secret must never be written into it.
function pastedSecretKind(text, detected, chainRegistry) {
    const kindOf = (type) => {
        if (!PASTED_SECRET_TYPES.has(type)) return null;
        return type === 'wif' ? 'wif' : 'mnemonic';
    };
    const direct = kindOf(detected.type);
    if (direct) return direct;
    if (detected.type !== 'bip21') return null;
    const slot = String(detected.address || '');
    let decoded = slot;
    try { decoded = decodeURIComponent(slot); } catch { /* raw slot only */ }
    for (const candidate of new Set([slot, decoded])) {
        const found = kindOf(uriLib.detectQrContent(candidate, { chainRegistry }).type);
        if (found) return found;
    }
    return null;
}

/**
 * Send view (§29): authoring surface for the SEND action.
 *
 * Flow:
 *   form      -> review    -> submitting -> done | error
 *                 (back from review re-edits; error state re-opens form
 *                  pre-filled so the user doesn't retype everything)
 *
 * Review stage runs the user's draft through `decoder.decodeAction` so
 * the plain-English summary + warnings match SignApproval's sign-screen
 * (§21.1 / §30). A memo with `|` or `;` surfaces the same protocol-
 * reject warning there and here.
 *
 * The dev-SDK stub cannot encode / sign / broadcast; Send will surface
 * that error when the user hits Submit. Form + review paths still
 * exercise cleanly; good for UX review before real SDK lands.
 */

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, scopes source addresses to that account
 * @param {() => void} props.onBack
 * @param {{ address?: string, amount?: string, tick?: string, chainId?: string, memo?: string, requestMessage?: string, feePriority?: 'low' | 'normal' | 'fast', feeSelection?: { mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }, assetSwitchNotice?: string }} [props.prefill]
 *        §47 Cluster L FOLLOWUP 1: initial form values from a deep-link
 *        intent (parseXchainUri). Each field is applied once on mount;
 *        the user can override before submitting. Address comes from
 *        the URI path / `to=` param; chainId from the URI path or the
 *        BIP21 `chain=` param; tick from the URI path or `tick=`.
 * @param {(carry: { chainId: string | null, tick: string, address: string, amount: string, feeSelection: { mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number } }) => void} [props.onChangeAsset]
 *        tapped from the asset hero; should navigate to the SendPicker.
 *        Receives the current asset-sensitive draft so the shell can retain only
 *        fields that still apply to the newly selected asset. Omit to leave the
 *        hero non-interactive.
 * @param {(target: { chainId?: string, txHash?: string }) => void} [props.onViewHistory]
 *        M2.4: tapped from the success card's "View in history" action.
 *        The payload matches History's `initialFocus` shape (chainId +
 *        txHash) so the caller can pass it straight through unchanged.
 *        The merged entry exists immediately (built from this wallet's own
 *        pending record) even though the network has not sighted it yet;
 *        the card's copy says as much. Omit to hide the action.
 * @param {() => void} [props.onReceive] navigate to Receive when this wallet has no funds
 *        on the selected chain
 * @param {() => void} [props.onDone]
 *        Leaves a completed send for Home. Falls back to onBack for callers
 *        that do not distinguish completion from ordinary back navigation.
 * @param {(held: boolean, release?: { open: boolean }) => void} [props.onHoldLinks]
 *        Called with true when the user approves a payment and with false when
 *        this screen unmounts. While held, the shell keeps an incoming payment
 *        link waiting instead of replacing the screen that shows the outcome.
 *        The release carries open: true only when the user left through Back
 *        or Done on the result; any other route drops the waiting link.
 * @param {boolean} [props.linkWaiting]
 *        True while the shell holds a payment link; the result says so.
 * @param {(sessionId?: string) => void} [props.onSessionStarted]
 *        Opens the multisig signing tracker after creating a spend session.
 * @param {string} [props.title]
 *        Header title of the form, for a page that hosts this form under its
 *        own name (an agent account's Fund page). Review keeps its own title.
 * @param {import('react').ReactNode} [props.formLead]
 *        Shown above the form's sections, below the signing-freeze notice
 *        (the agent address QR on the Fund page).
 * @param {string} [props.draftView]
 *        Draft slot of this form; a hosted form keeps its own so its typed
 *        values never show as the plain Send page's unfinished draft.
 * @param {string} [props.presetTo]
 *        The destination the hosting page sets (the agent address on its Fund
 *        page). While To still holds it, it is not the user's input: alone it
 *        saves no draft and Back asks nothing. Other openers' prefills stay input.
 */
export function Send({ walletId, accountId, onBack, prefill = null, onDone, onChangeAsset, onViewHistory, onReceive, onHoldLinks, linkWaiting = false, onSessionStarted, title = null, formLead = null, draftView = 'send', presetTo = '' }) {
    const { messaging, shell } = useMessaging();
    // A demo wallet probes nothing; its fixtures never touch a network.
    const { overall: reachabilityOverall, refresh: recheckReachability } = useReachability({
        chainIds: isDemoWallet(walletId) ? [] : undefined,
    });
    // The shared offline verdict: a device with no network is offline from the
    // first render, and the probe's all-unreachable verdict counts as well.
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    const [balancesHidden] = useBalancesHidden();
    // The verdict behind the shell's "Some balances may be out of date".
    const balancesUnchecked = reachabilityOverall === 'degraded' || networkOffline;
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    // Once a payment is approved, this screen is the only place its outcome
    // (sent, failed, cancelled or signed for export) is shown, so the shell
    // holds incoming payment links until the user leaves it.
    const onHoldLinksRef = useRef(onHoldLinks);
    onHoldLinksRef.current = onHoldLinks;
    const linksHeldRef = useRef(false);
    const holdIncomingLinks = useCallback(() => {
        if (linksHeldRef.current) return;
        linksHeldRef.current = true;
        onHoldLinksRef.current?.(true);
    }, []);
    const leftByResultRef = useRef(false);
    useEffect(() => () => {
        if (linksHeldRef.current) onHoldLinksRef.current?.(false, { open: leftByResultRef.current });
    }, []);
    // Unlocked software session signs without a password.
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const { settings } = useSettings();
    // This wallet's own mode (§20); the form waits until it is known. Watcher
    // mode composes unsigned PSBTs, so balance empty states never replace it.
    const {
        walletMode,
        isWatcherMode,
        isSignerMode,
        walletModeKnown: walletModeReady,
    } = useWalletMode(walletId);
    // A demo wallet holds fixture balances and cannot move funds: the form
    // opens at once instead of waiting on a balance read, and Send refuses
    // when pressed. No notice warns in advance; the user knows it is a demo.
    const isDemo = isDemoWallet(walletId);
    const [demoRefused, setDemoRefused] = useState(false);
    const [demoExitConfirmOpen, setDemoExitConfirmOpen] = useState(false);
    const [demoExitBusy, setDemoExitBusy] = useState(false);
    const [demoExitError, setDemoExitError] = useState(/** @type {string | null} */ (null));
    const handleExitDemo = useCallback(async () => {
        if (demoExitBusy) return;
        setDemoExitBusy(true);
        setDemoExitError(null);
        try {
            const { reloaded } = await exitDemoWallet({ messaging, walletId });
            if (reloaded) return;
            setDemoExitConfirmOpen(false);
            onBack?.();
        } catch {
            setDemoExitError('Could not exit demo mode. Please try again.');
        } finally {
            setDemoExitBusy(false);
        }
    }, [demoExitBusy, messaging, walletId, onBack]);
    const { showToast, dismissToast, clearGeneration } = useToast();
    const haptic = useHaptic();
    const [undoHoldActive, setUndoHoldActive] = useState(false);
    const undoHoldIdRef = useRef(/** @type {string | null} */ (null));
    const clearUndoHold = useCallback(() => {
        undoHoldIdRef.current = null;
        setUndoHoldActive(false);
    }, []);
    const cancelUndoHold = useCallback(() => {
        const holdId = undoHoldIdRef.current;
        if (!holdId) return;
        const reportFailure = (err) => {
            console.error('Undo send cancellation failed:', err); // eslint-disable-line no-console
            showToast({
                message: 'Could not cancel this send. It may still be broadcast.',
                variant: 'error',
            });
        };
        try {
            Promise.resolve(messaging.sendHoldCancel(holdId)).then((outcome) => {
                // The host holds nothing for this id once its window has run out, or when
                // this cancel beat the hold. The countdown's "Send cancelled" is then
                // unconfirmed until the send's own outcome arrives.
                if (outcome && outcome.cancelled === false) {
                    clearUndoHold();
                    showToast({ message: 'Checking whether the send was stopped.' });
                }
            }).catch(reportFailure);
        } catch (err) {
            reportFailure(err);
        }
    }, [messaging, showToast, clearUndoHold]);
    const {
        status: undoSendStatus,
        remaining: undoSendRemaining,
        start: startUndoSend,
        cancel: cancelUndoSend,
        reset: resetUndoSend,
    } = useUndoSend({
        onElapsed: clearUndoHold,
        onCancelHold: cancelUndoHold,
    });
    // A held send outlives this screen: a wallet or account switch (here or in
    // another surface), a network change or a route change remounts Send while
    // the host still counts down. The countdown moves to the app toast stack,
    // so Cancel stays in reach, and the outcome is stated when the send settles.
    const undoLiveRef = useRef(/** @type {{ holdId: string, remaining: number } | null} */ (null));
    undoLiveRef.current = undoHoldActive && undoSendStatus === 'counting' && undoHoldIdRef.current
        ? { holdId: undoHoldIdRef.current, remaining: undoSendRemaining }
        : null;
    const undoHandoffRef = useRef(/** @type {{ toastId: string, generation: number } | null} */ (null));
    const undoHandoffDepsRef = useRef({ messaging, showToast, clearGeneration });
    undoHandoffDepsRef.current = { messaging, showToast, clearGeneration };
    // A layout cleanup, so a lock that unmounts Send clears this toast with the
    // rest of the session's toasts in the same commit (useClearToastsOnLock).
    useLayoutEffect(() => () => {
        const live = undoLiveRef.current;
        if (!live) return;
        const { messaging: host, showToast: show, clearGeneration: generationOf } = undoHandoffDepsRef.current;
        const toastId = show({
            message: t('undoSend.handoff.sendingInS', { remaining: live.remaining }),
            actionLabel: t('common.cancel'),
            onAction: () => host.sendHoldCancel(live.holdId),
            durationMs: Math.max(1, live.remaining) * 1000,
        });
        undoHandoffRef.current = { toastId, generation: generationOf() };
    }, []);
    const reportUndoHandoffOutcome = useCallback((outcome) => {
        const handoff = undoHandoffRef.current;
        if (!handoff) return;
        undoHandoffRef.current = null;
        dismissToast(handoff.toastId);
        // A lock cleared the stack since the handoff: the outcome stays off the lock screen.
        if (clearGeneration() !== handoff.generation) return;
        if (outcome === 'sent') showToast({ message: t('undoSend.handoff.sent') });
        else if (outcome === 'cancelled') showToast({ message: t('undoSend.handoff.cancelled') });
        else showToast({ message: t('undoSend.handoff.failed'), variant: 'error' });
    }, [clearGeneration, dismissToast, showToast]);

    // §5.6 slice 1: the single-encode confirm modal. Flag-gated
    // (read with code defaults, never vault-stamped). brought
    // hardware onto it; watcher sends stay on the legacy review->submit
    // stage machine below (they encode, they never sign).
    const confirmAction = useConfirmAction();
    const confirmBusy = ['composing', 'preflighting', 'ready', 'signing', 'rechecking']
        .includes(confirmAction.phase);
    const confirmLaunchRef = useRef(false);
    const confirmSendSnapshotRef = useRef(null);
    const submitInFlightRef = useRef(false);

    // §34.2: Cmd/Ctrl+Enter submits the visible stage's form (compose ->
    // review, review -> sign). requestSubmit (not submit()) so the form's
    // onSubmit validation path runs exactly as if the button was clicked.
    useScreenShortcuts({
        keys: {
            'mod+enter': () => {
                const form = document.getElementById('send-form')
                    || document.getElementById('send-review-form');
                if (!form) return false;
                form.requestSubmit();
                return true;
            },
        },
    });

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [addressLoadAttempt, setAddressLoadAttempt] = useState(0);
    const [networkSettingsOpen, setNetworkSettingsOpen] = useState(false);

    const [chainId, setChainId] = useState(/** @type {string | null} */ (
        prefill?.chainId || null
    ));
    const prefillChainIdRef = useRef(prefill?.chainId || null);
    prefillChainIdRef.current = prefill?.chainId || null;
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    // Active (operating) address per chain; Send DEFAULTS its from-address to
    // this so a send spends from the chain's active address unless the user
    // says otherwise.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    // source picker, matching the From field every other action form
    // carries. `pickedSourceChain` records the chain a manual pick was made on,
    // so the defaulting effect below re-defaults on a chain switch (where the
    // picked address does not exist) but never overwrites a deliberate choice.
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    // The standard sections' open state, held here so it survives the
    // picker pages (each an early return below). From starts closed, Payment
    // open, the rest closed.
    const formSections = useFormSections({ from: false, payment: true, memo: false, fee: false });
    const [pickedSourceChain, setPickedSourceChain] = useState(
        /** @type {string | null} */ (null),
    );
    const [multisigAddresses, setMultisigAddresses] = useState(/** @type {any[]} */ ([]));
    const [multisigSource, setMultisigSource] = useState(
        /** @type {{ chainId: string, id: string } | null} */ (null),
    );
    const [toAddress, setToAddress] = useState(prefill?.address || '');
    const [tick, setTick] = useState(prefill?.tick || '');
    const [amount, setAmount] = useState(prefill?.amount || '');
    const [maxActive, setMaxActive] = useState(false);
    const [maxBusy, setMaxBusy] = useState(false);
    const [maxUnavailable, setMaxUnavailable] = useState(false);
    const [maxNote, setMaxNote] = useState(/** @type {string | null} */ (null));
    const maxRequestRef = useRef(0);
    const maxContextRef = useRef(/** @type {string | null} */ (null));
    const maxUtxosRef = useRef(/** @type {any[] | null} */ (null));
    const cancelMax = useCallback(() => {
        setMaxActive(false);
        setMaxUnavailable(false);
        setMaxNote(null);
        maxUtxosRef.current = null;
        maxRequestRef.current += 1;
        setMaxBusy(false);
    }, []);
    const [memo, setMemo] = useState(prefill?.memo || '');
    const [requestMessage, setRequestMessage] = useState(
        prefill?.requestMessage || prefill?.memo || '',
    );
    const [assetSwitchNotice, setAssetSwitchNotice] = useState(prefill?.assetSwitchNotice || null);
    const [amountInputMode, setAmountInputMode] = useState(
        /** @type {'coin' | 'fiat'} */ ('coin'),
    );
    // PC-52: additional recipients. The fields above stay the FIRST recipient
    // (so every single-send affordance - contacts, paste checks, fiat entry,
    // Max, the gated-content rails - keeps working untouched), and these rows
    // are the extra legs of a SEND v1/v2. `perRecipientToken` lets each row
    // carry its own tick, which is what moves the action from v1 to v2.
    // Only the Multi and Advanced tabs fill them, from their recipient list
    // (see the projection below); the Single tab sends one leg.
    const [extraLegs, setExtraLegs] = useState(
        /** @type {Array<{ id: string, to: string, amount: string, tick: string }>} */ ([]),
    );
    const [perRecipientToken, setPerRecipientToken] = useState(false);
    // The Payment section's Single, Multi and Advanced tabs. Multi keeps a
    // list built one recipient at a time; Advanced keeps the typed or
    // uploaded `address,asset,amount` lines. Switching carries the
    // recipients across; Advanced text is regenerated from the list only
    // when the list was edited after the text was read, so lines Multi could
    // not take are never dropped by a switch.
    const [sendMode, setSendMode] = useState(/** @type {'single' | 'multi' | 'advanced'} */ ('single'));
    const [multiRecipients, setMultiRecipients] = useState(
        /** @type {Array<{ id: string, to: string, tick: string, amount: string }>} */ ([]),
    );
    const [multiDraft, setMultiDraft] = useState(
        /** @type {{ editingId: string, to: string, tick: string, amount: string, errors?: Record<string, string> } | null} */ (null),
    );
    const [multiAddDraft, setMultiAddDraft] = useState(
        /** @type {{ editingId: null, to: string, tick: string, amount: string, errors?: Record<string, string> } | null} */ (null),
    );
    const [advancedText, setAdvancedText] = useState('');
    const [advancedFileName, setAdvancedFileName] = useState('');
    const [advancedFileError, setAdvancedFileError] = useState(/** @type {string | null} */ (null));
    // Line errors show under the box once a submit has failed, and leave
    // when the text changes.
    const [advancedChecked, setAdvancedChecked] = useState(false);
    const multiListEditedRef = useRef(false);
    const [validationAttempt, setValidationAttempt] = useState(0);
    const [tokenPickerRecipientId, setTokenPickerRecipientId] = useState(
        /** @type {string | null} */ (null),
    );
    // The Asset picker's network filter; null follows the form's chain (G63).
    const [assetPickerNetwork, setAssetPickerNetwork] = useState(/** @type {string | null} */ (null));
    const [fiatAmount, setFiatAmount] = useState('');
    const [password, setPassword] = useState('');
    // Live mirror of `password` so the confirm-modal's onApprove closure
    // (captured when the modal opened) reads what the user typed INTO the
    // modal afterward, not the value at open time.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    // The form error standard: Review validates every field into this map, the notice at
    // the top lists the problems, and each field clears its own entry when it changes.
    const form = useFormErrors();
    // Inline error on the To field, e.g. a wrong-chain destination address.
    const [toError, setToError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    // Recognized recovery cause for affordances that must not match display copy.
    const [submitErrorCause, setSubmitErrorCause] = useState(/** @type {string | null} */ (null));
    // Remounts the freeze notice so it re-reads the freeze at once after a
    // refusal, instead of on its next tick: the notice is then the one
    // message for that state, and the submit error stays empty.
    const [panicNoticeKey, setPanicNoticeKey] = useState(0);
    // An encoder refusal the person fixes in one field (a fee rate under the
    // relay minimum, an amount the inputs cannot cover) shows under that field.
    const [submitFieldError, setSubmitFieldError] = useState(
        /** @type {{ field: 'fee' | 'amount', message: string } | null} */ (null),
    );
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    // The done screen follows the sent transaction from broadcast to
    // confirmation (or failure) instead of freezing on "pending".
    const [sentStatus, setSentStatus] = useState({
        status: 'pending',
        confirmations: null,
        blockIndex: null,
    });
    const sentStatusPollRef = useRef(0);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const reviewPageRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const reviewHeadingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));

    // The To as the user's own input: empty while it still holds the hosting
    // page's presetTo, so that preset alone neither saves a draft nor makes
    // Back ask to discard. Without presetTo this is just the To.
    const presetToAddress = typeof presetTo === 'string' ? presetTo.trim() : '';
    const typedToAddress = presetToAddress && toAddress.trim() === presetToAddress ? '' : toAddress;

    // §37 / G125: form-draft persistence. Persists only the user-visible
    // composition fields; password / mnemonic / passphrase NEVER touch
    // localStorage. The hook is keyed by walletId so a from-seed restore
    // doesn't surface a stranger's draft.
    // Cluster P FOLLOWUP 6: honor the user's privacy.formDraftTtlMs
    // setting (Off / 1h / 24h / 7d). Default 24h matches the prior
    // hardcoded behavior. `0` (Off) disables save() + evicts any
    // existing draft on load.
    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draftNetwork = settings ? getActiveNetwork(settings) : null;
    const draft = useFormDraft({ view: draftView, walletId, network: draftNetwork, ttlMs: formDraftTtlMs });
    // A stored draft waits for an explicit Restore. A fresh form starts
    // saving immediately so an auto-lock unmount cannot erase typed values.
    const [draftPending, setDraftPending] = useState(
        () => !hasMeaningfulSendDraft(draft.load()),
    );
    // Settings resolve after the first render; once the network is known a draft
    // from another network reads as absent, so the form saves from then on.
    useEffect(() => {
        if (draftNetwork && !hasMeaningfulSendDraft(draft.load())) setDraftPending(true);
    }, [draftNetwork]); // eslint-disable-line react-hooks/exhaustive-deps
    // A confirmed "Discard and leave" drops the saved draft and stops the
    // autosave, so no render between the confirm and the unmount can write
    // the discarded values back.
    const draftDiscardedRef = useRef(false);
    const discardDraft = useCallback(() => {
        draftDiscardedRef.current = true;
        draft.clear();
    }, [draft]);
    useEffect(() => {
        if (stage !== 'form' || !draftPending || draftDiscardedRef.current) return;
        // A mobile resume can remount the form, so every field the user set
        // rides in the draft, not just the first recipient.
        const values = {
            chainId,
            fromAddressId,
            pickedSourceChain,
            toAddress,
            tick,
            amount,
            memo,
            amountInputMode,
            fiatAmount,
            fiatCurrency: settings?.fiatCurrency || 'USD',
            extraLegs,
            perRecipientToken,
            sendMode,
            multiRecipients,
            advancedText,
        };
        // A hosting page's presetTo (an agent's Fund page) is not the user's
        // input, so it alone saves no draft.
        if (hasMeaningfulSendDraft({ ...values, toAddress: typedToAddress })) draft.save(values);
        else draft.clear();
    }, [
        stage, draftPending, draft, chainId, fromAddressId, pickedSourceChain,
        toAddress, typedToAddress, tick, amount, memo, amountInputMode, fiatAmount, extraLegs,
        perRecipientToken, settings?.fiatCurrency, sendMode, multiRecipients, advancedText,
    ]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(true); return; }
        cancelMax();
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.toAddress === 'string') setToAddress(v.toAddress);
        if (typeof v.tick === 'string') setTick(v.tick);
        if (typeof v.amount === 'string') setAmount(v.amount);
        if (typeof v.memo === 'string') setMemo(v.memo);
        if (typeof v.fromAddressId === 'string') setFromAddressId(v.fromAddressId);
        if (typeof v.pickedSourceChain === 'string') setPickedSourceChain(v.pickedSourceChain);
        // Typed fiat text belongs to the currency it was typed in. Under a
        // different display currency the coin amount is the value to keep.
        const sameFiat = !v.fiatCurrency || v.fiatCurrency === (settings?.fiatCurrency || 'USD');
        if (v.amountInputMode === 'coin' || (v.amountInputMode === 'fiat' && sameFiat)) {
            setAmountInputMode(v.amountInputMode);
        }
        if (typeof v.fiatAmount === 'string' && sameFiat) setFiatAmount(v.fiatAmount);
        const restored = restoredRecipients(v);
        if (v.sendMode === 'advanced' && typeof v.advancedText === 'string') {
            // The text comes back as typed, bad lines included; the list
            // stands as it was so a switch to Multi shows it.
            setMultiRecipients(restored);
            setAdvancedText(v.advancedText);
            multiListEditedRef.current = false;
            setSendMode('advanced');
        } else if (v.sendMode === 'multi' || restored.length > 1) {
            // A draft saved before the tabs kept its extra recipients as
            // rows under the first; they open as Multi's list, all of them.
            setMultiRecipients(restored);
            if (typeof v.advancedText === 'string') setAdvancedText(v.advancedText);
            multiListEditedRef.current = true;
            setSendMode('multi');
        }
        setDraftPending(true);
    }, [draft, cancelMax, settings?.fiatCurrency]);
    const discardSavedDraft = useCallback(() => {
        draft.clear();
        setDraftPending(true);
    }, [draft]);
    const hasRealInput = useMemo(() => (
        [typedToAddress, amount, memo, fiatAmount, password]
            .some((value) => String(value || '').trim().length > 0)
        || (tick.trim().length > 0
            && tick.trim().toUpperCase() !== nativeTickerFor(chainId ? chainRegistry.get(chainId) : null))
        || extraLegs.some((leg) => [leg.to, leg.amount, leg.tick]
            .some((value) => String(value || '').trim().length > 0))
        || multiRecipients.length > 0
        || advancedText.trim().length > 0
        || Boolean(multiDraft && [multiDraft.to, multiDraft.amount].some((value) => String(value || '').trim()))
        || Boolean(multiAddDraft && [multiAddDraft.to, multiAddDraft.amount].some((value) => String(value || '').trim()))
    ), [typedToAddress, amount, memo, fiatAmount, password, tick, chainId, extraLegs, multiRecipients, advancedText, multiDraft, multiAddDraft]);
    const stageRef = useRef(stage);
    stageRef.current = stage;
    const leaveGuard = useFormLeaveGuard({
        dirty: stage !== 'done' && hasRealInput,
        submitting: stage === 'submitting',
        signedUnbroadcast: stage === 'done' && result?.queued === true && result?.unsaved === true,
        onLeave: () => {
            if (stageRef.current === 'done') leftByResultRef.current = true;
            onBack?.();
        },
        onDiscard: discardDraft,
    });
    // Done on the result leaves for the shell's Home; either way it is a
    // leave from the result, so a waiting payment link opens.
    const leaveResultDone = () => {
        if (!onDone) { leaveGuard.guardedOnBack(); return; }
        leftByResultRef.current = true;
        onDone();
    };

    useEffect(() => {
        if (!prefill?.chainId) return;
        setChainId(prefill.chainId);
        if (typeof prefill.tick === 'string') setTick(prefill.tick);
    }, [prefill?.chainId, prefill?.tick]);

    // The settings read rides the address load so the last-used chain is
    // known in the render that first shows the form. Best-effort: a host
    // without `getSettings`, or a failed read, still yields a usable form.
    // Reset per wallet at mount, before the active-address, prefill and draft
    // effects below; only the load waits for the wallet mode, which decides
    // which addresses can send.
    useEffect(() => {
        setAddressesByChain(null);
        setLoadError(null);
        setChainId(prefillChainIdRef.current);
        setFromAddressId(null);
        setActiveByChain({});
        setPickedSourceChain(null);
        setHistoryRows([]);
    }, [walletId, accountId, messaging, addressLoadAttempt]);
    useEffect(() => {
        if (!walletModeReady) return undefined;
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId, accountId),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([loadedByChain, loadedSettings]) => {
                if (cancelled) return;
                const byChain = signingAddressesByChain(loadedByChain, walletMode);
                setAddressesByChain(byChain);
                if (!Object.keys(byChain)[0]) {
                    setLoadError(hasAnyAddress(loadedByChain)
                        ? WATCH_ONLY_SIGNING_MESSAGE
                        : 'This wallet has no addresses yet. Open Receive to create one.');
                    return;
                }
                // §47 Cluster L FOLLOWUP 1: a chain already set (a prefill,
                // a deep-link intent, a restored draft) is kept; otherwise
                // the last-used chain, then the first available one.
                setChainId((prev) => pickDefaultChainId(byChain, {
                    explicitChainId: prev,
                    settings: loadedSettings,
                }));
            })
            .catch(() => {
                if (!cancelled) {
                    setLoadError("Couldn't load addresses. Check your connection and try again.");
                }
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, addressLoadAttempt, walletMode, walletModeReady]);

    // §18.4 firmware-warning support. When the source address is HW we
    // need vendor / model / firmwareVersion to render the warning banner
    // inside HwSignBlock. The shared `useSignerInfo` hook (Cluster N
    // FOLLOWUP 2) consolidates the SignerRecord lookup and caches the
    // signer list across re-mounts.

    // §29.4 / §21.6 autocomplete source data. Contacts cover the whole
    // vault; history is per-chain × per-address and refetches when the chain
    // changes.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const contactsRequestRef = useRef(0);
    const refreshContacts = useCallback(async ({ warn = false } = {}) => {
        const requestId = contactsRequestRef.current + 1;
        contactsRequestRef.current = requestId;
        try {
            const rows = await messaging.listContacts();
            if (contactsRequestRef.current !== requestId) return false;
            setContacts(Array.isArray(rows) ? rows : []);
            return true;
        } catch {
            if (contactsRequestRef.current !== requestId) return false;
            if (warn) {
                showToast({ message: t('send.contacts.refreshFailed'), variant: 'error' });
            }
            return false;
        }
    }, [messaging, showToast]);
    useEffect(() => {
        refreshContacts();
        return () => { contactsRequestRef.current += 1; };
    }, [refreshContacts]);

    // Refresh when a web or desktop window regains focus, or when a mobile
    // shell returns to the foreground, so contacts edited elsewhere show up.
    useEffect(() => {
        const onVisible = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            refreshContacts();
        };
        globalThis.addEventListener?.('focus', onVisible);
        globalThis.document?.addEventListener?.('visibilitychange', onVisible);
        return () => {
            globalThis.removeEventListener?.('focus', onVisible);
            globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
        };
    }, [refreshContacts]);

    // Contacts UX state: which recipient opened the picker, plus the post-send save form.
    const [contactsPickerTarget, setContactsPickerTarget] = useState(
        /** @type {'single' | 'edit' | 'add' | null} */ (null),
    );
    const openContactsPicker = useCallback(async (target) => {
        // Read immediately before showing rows so edits made in another shell
        // cannot leave the picker on its mount-time snapshot.
        await refreshContacts({ warn: true });
        setContactsPickerTarget(target);
    }, [refreshContacts]);
    const [contactSaveStage, setContactSaveStage] = useState(
        /** @type {'idle' | 'editing' | 'saving' | 'saved'} */ ('idle'),
    );
    const [contactName, setContactName] = useState('');
    const [contactSaveError, setContactSaveError] = useState(/** @type {string | null} */ (null));
    const contactSaveBusyRef = useRef(false);

    const [historyRows, setHistoryRows] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        if (!chainId || !addressesByChain) return undefined;
        setHistoryRows([]);
        const ownAddrs = (addressesByChain[chainId] || []).map((a) => a.address);
        if (ownAddrs.length === 0) {
            setHistoryRows([]);
            return undefined;
        }
        if (isDemo) {
            setHistoryRows(ownAddrs.flatMap((address) => (
                flowsLib.synthesizeDemoHistory(chainId, address)
            )));
            return undefined;
        }
        let cancelled = false;
        Promise.all(
            ownAddrs.map((addr) =>
                messaging.getAddressHistory({ chainId, address: addr })
                    .then((response) => {
                        if (Array.isArray(response)) return response;
                        if (Array.isArray(response?.data)) return response.data;
                        if (Array.isArray(response?.rows)) return response.rows;
                        return [];
                    })
                    .catch(() => []),
            ),
        ).then((results) => {
            if (cancelled) return;
            setHistoryRows(results.flat());
        });
        return () => { cancelled = true; };
    }, [chainId, addressesByChain, messaging, isDemo]);

    const suggestions = useMemo(() => {
        const descriptor = chainId ? chainRegistry.get(chainId) : null;
        return buildRecentDestinations({
            contacts,
            chainCoin: descriptor?.coin,
            historyRows,
        });
    }, [contacts, chainId, historyRows]);

    // Contact rows that have an entry on the current chain: the
    // picker and resolved-name chip both filter against this set.
    const chainCoinFor = useCallback((cid) => {
        const d = cid ? chainRegistry.get(cid) : null;
        return d?.coin || null;
    }, []);

    const chainContacts = useMemo(() => {
        const coin = chainCoinFor(chainId);
        if (!coin) return [];
        const out = [];
        for (const c of contacts) {
            for (const e of c?.entries || []) {
                if (contactEntryChain(e) === coin && e?.address) {
                    out.push({ contact: c, entry: e });
                }
            }
        }
        return out;
    }, [contacts, chainId, chainCoinFor]);

    // If the typed address exactly matches a contact entry on this chain,
    // show the matched-contact name pill next to the To label.
    const matchedContact = useMemo(() => {
        const trimmed = toAddress.trim();
        if (!trimmed) return null;
        return chainContacts.find(({ entry }) => entry.address === trimmed) || null;
    }, [toAddress, chainContacts]);

    const handlePickRecipient = useCallback((entry) => {
        const address = String(entry?.address || '');
        const selectedDescriptor = chainId ? chainRegistry.get(chainId) : null;
        const error = destinationAddressError(address, selectedDescriptor);
        // Keep the current recipient when the picked address cannot be paid on
        // this chain; the inline message explains which network it belongs to.
        if (error) {
            setToError(error);
            return;
        }
        setToAddress(address);
        setToError(null);
    }, [chainId]);

    const handlePickContact = useCallback((entry) => {
        if (contactsPickerTarget === 'single') {
            handlePickRecipient(entry);
        } else {
            const address = String(entry?.address || '');
            const selectedDescriptor = chainId ? chainRegistry.get(chainId) : null;
            const error = destinationAddressError(address, selectedDescriptor);
            const setDraft = contactsPickerTarget === 'edit' ? setMultiDraft : setMultiAddDraft;
            setDraft((current) => {
                if (!current) return current;
                const errors = { ...(current.errors || {}) };
                if (error) errors.to = error;
                else delete errors.to;
                return error ? { ...current, errors } : { ...current, to: address, errors };
            });
        }
        setContactsPickerTarget(null);
    }, [chainId, contactsPickerTarget, handlePickRecipient]);


    // §29.5 smart paste: BIP21 URI pre-fills amount/token/memo;
    // pasting a WIF surfaces "import this private key instead?" rather
    // than letting the user paste a private key into the To field.
    // Also runs §21.5 paste-integrity: hashes the pasted text, then
    // re-reads navigator.clipboard.readText() and warns if the
    // clipboard rewrote itself between paste and re-read.
    const [pasteHint, setPasteHint] = useState(/** @type {string | null} */ (null));
    const [pasteWarning, setPasteWarning] = useState(/** @type {string | null} */ (null));
    const [pastedRecipient, setPastedRecipient] = useState(/** @type {string | null} */ (null));
    const pasteIntegritySeqRef = useRef(0);
    useEffect(() => () => { pasteIntegritySeqRef.current += 1; }, []);
    const onAddressPaste = useCallback((e) => {
        const text = e?.clipboardData?.getData?.('text');
        if (typeof text !== 'string' || text.length === 0) return;
        const trimmed = normalizePastedRecipient(text);
        const detected = uriLib.detectQrContent(trimmed, { chainRegistry });
        const applyRecipient = (value, targetChainId = chainId) => {
            const recipient = normalizePastedRecipient(value);
            setToAddress(recipient);
            setPastedRecipient(recipient || null);
            const targetDescriptor = targetChainId ? chainRegistry.get(targetChainId) : null;
            setToError(destinationAddressError(recipient, targetDescriptor));
        };
        const secretKind = pastedSecretKind(trimmed, detected, chainRegistry);
        if (secretKind) {
            e.preventDefault();
            setPastedRecipient(null);
            setPasteHint(secretKind === 'wif'
                ? 'That looks like a private key, not a payment address. To import it, open Settings and choose Import private key.'
                : t('scan.error.mnemonic'));
        } else if (detected.type === 'bip21') {
            e.preventDefault();
            const parts = detected.parts;
            const chainParam = parts.params?.chain;
            // A link with no `chain` still names its coin through the scheme,
            // and its amount is written in that coin. When the open chain is
            // another coin, the link moves Send to the scheme's coin on the
            // open network: testnet and regtest addresses of different coins
            // share version bytes, so the address cannot say which coin the
            // amount belongs to.
            const openDescriptor = chainId ? chainRegistry.get(chainId) : null;
            const schemeChainId = chainParam === undefined && openDescriptor
                && String(openDescriptor.uriScheme || '').toLowerCase() !== detected.scheme
                ? chainRegistry.supportedChains().find((candidate) => (
                    String(candidate.uriScheme || '').toLowerCase() === detected.scheme
                    && candidate.networkKind === openDescriptor.networkKind
                    && addressesByChain?.[candidate.id]?.length > 0
                ))?.id
                : undefined;
            const requestChainId = uriLib.safeChainIdParam(chainParam) || schemeChainId;
            const requestDescriptor = requestChainId ? chainRegistry.get(requestChainId) : null;
            const requestError = parts.required.length > 0
                ? 'This payment request requires a feature this wallet does not support.'
                : (chainParam !== undefined && (
                    !requestChainId
                    || !requestDescriptor
                    || String(requestDescriptor.uriScheme || '').toLowerCase() !== detected.scheme
                    || !(addressesByChain?.[requestChainId]?.length > 0)
                )
                    ? 'This payment request names a network this wallet cannot use.'
                    : null);
            if (requestError) {
                setPastedRecipient(null);
                setPasteHint(null);
                // A field error is recomputed from the (unchanged) address on the
                // next blur and would erase this, so the refusal is a note that
                // stays until the user types.
                setToError(null);
                setPasteWarning(requestError);
                return;
            }
            const tickParam = parts.params?.tick;
            const nextTick = typeof tickParam === 'string' && tickParam.length > 0
                ? neutralizeControlText(tickParam).toUpperCase()
                : (requestDescriptor?.uriScheme === detected.scheme && requestChainId !== chainId
                    ? (nativeTickerFor(requestDescriptor) || '')
                    : tick);
            const chainChanged = Boolean(
                requestDescriptor?.uriScheme === detected.scheme && requestChainId !== chainId,
            );
            const tokenChanged = nextTick.trim().toUpperCase() !== tick.trim().toUpperCase();
            const assetChanged = chainChanged || tokenChanged;
            applyRecipient(detected.address, requestChainId || chainId);
            if (parts.amount || assetChanged) cancelMax();
            if (parts.amount) setAmount(parts.amount);
            else if (assetChanged) setAmount('');
            if (assetChanged) {
                setFiatAmount('');
                setAmountInputMode('coin');
                if (chainChanged) {
                    setExtraLegs([]);
                    setPerRecipientToken(false);
                } else if (!perRecipientToken) {
                    setExtraLegs((rows) => rows.map((row) => ({ ...row, amount: '' })));
                }
                // A link that carries its own amount keeps it, so a notice saying
                // the amount was cleared would contradict the field.
                setAssetSwitchNotice(parts.amount ? null : (chainChanged
                    ? 'Network changed. The amount and network fee were reset because they may not be valid on the new network.'
                    : 'Token changed. The amount was cleared because the new token may use different decimal places.'));
            }
            if (nextTick !== tick) {
                // Pasted text is the same untrusted-URI class as
                // a deep link or a scanned QR, so tick/memo get the same
                // neutralization those paths apply. `address` stays raw; see
                // `hardenUriIntentText`'s comment for why.
                setTick(nextTick);
            }
            const memoParam = parts.message ?? parts.label;
            const safeMessage = memoParam ? neutralizeControlText(memoParam) : '';
            setRequestMessage(safeMessage);
            if (safeMessage) setMemo(safeMessage);
            else if (memo === requestMessage) setMemo('');
            if (chainChanged) {
                setChainId(requestChainId);
            }
            setPasteHint('Payment details filled from the pasted payment link.');
        } else if (detected.type === 'xchain-uri') {
            e.preventDefault();
            // Route through the richer parser so the new coin-code form
            // (xchain:TBTC/send?to=…) yields intent.address rather than the
            // raw "TBTC/send" that the BIP21 fallback would surface.
            const intent = uriLib.hardenUriIntentText(uriLib.parseXchainUri(trimmed, { chainRegistry }));
            // A link that names no chain pays on the one chain its address
            // belongs to, as a scanned or opened link does, when this wallet
            // has an address there to send from.
            const addressChainId = !intent.chainId && intent.address
                ? uriLib.resolvePaymentChain({ address: intent.address, chainRegistry }).chainId
                : undefined;
            const linkChainId = intent.chainId
                || (addressChainId && addressesByChain?.[addressChainId]?.length > 0 ? addressChainId : undefined);
            const nextChainId = linkChainId || chainId;
            const nextDescriptor = nextChainId ? chainRegistry.get(nextChainId) : null;
            const nextTick = intent.tick
                ? intent.tick.toUpperCase()
                : (nextChainId !== chainId ? (nativeTickerFor(nextDescriptor) || '') : tick);
            const chainChanged = Boolean(nextChainId && nextChainId !== chainId);
            const tokenChanged = nextTick.trim().toUpperCase() !== tick.trim().toUpperCase();
            const assetChanged = chainChanged || tokenChanged;
            if (intent.address) applyRecipient(intent.address, nextChainId);
            else if (chainChanged) setToAddress('');
            if (intent.amount || assetChanged) cancelMax();
            if (intent.amount) setAmount(intent.amount);
            else if (assetChanged) setAmount('');
            if (chainChanged && !intent.address) { setToError(null); setPastedRecipient(null); }
            if (assetChanged) {
                if (tokenChanged) setTick(nextTick);
                setFiatAmount('');
                setAmountInputMode('coin');
                if (chainChanged) {
                    setExtraLegs([]);
                    setPerRecipientToken(false);
                } else if (!perRecipientToken) {
                    setExtraLegs((rows) => rows.map((row) => ({ ...row, amount: '' })));
                }
                // A link that carries its own amount keeps it, so a notice saying
                // the amount was cleared would contradict the field.
                setAssetSwitchNotice(intent.amount ? null : (chainChanged
                    ? 'Network changed. The amount and network fee were reset because they may not be valid on the new network.'
                    : 'Token changed. The amount was cleared because the new token may use different decimal places.'));
            }
            const safeMessage = intent.message ?? intent.label ?? intent.memo ?? '';
            setRequestMessage(safeMessage);
            if (intent.memo) setMemo(intent.memo);
            else if (memo === requestMessage) setMemo('');
            if (linkChainId && linkChainId !== chainId) {
                setChainId(linkChainId);
            }
            setPasteHint('Payment details filled from the pasted payment link.');
        } else {
            e.preventDefault();
            setRequestMessage('');
            applyRecipient(trimmed);
            setPasteHint(null);
        }
        setPasteWarning(null);
        // Defer the integrity check so the paste event finishes first.
        // navigator.clipboard.readText is async and permission-gated;
        // skipped + ok results are silent.
        const integritySeq = pasteIntegritySeqRef.current + 1;
        pasteIntegritySeqRef.current = integritySeq;
        Promise.resolve().then(() => checkPasteIntegrity({ pastedText: text }))
            .then((res) => {
                if (!mountedRef.current || pasteIntegritySeqRef.current !== integritySeq) return;
                if (!res.ok) setPasteWarning(res.reason || 'The clipboard changed after you pasted. Check the address before sending.');
            })
            .catch(() => { /* silent */ });
    }, [addressesByChain, chainId, perRecipientToken, tick, cancelMax, memo, requestMessage]);

    // §21.4 test-send protection. Session-scoped acknowledgement set;
    // marking an address tested suppresses the gate for the rest of
    // the session. Persistence across reloads is intentionally out of
    // scope (avoids a wallet-schema migration just to track a UX
    // affordance); the user re-confirms after a reload, which is fine.
    const [testedThisSession, setTestedThisSession] = useState(
        /** @type {Set<string>} */ (() => new Set()),
    );
    const markTested = useCallback((addr) => {
        setTestedThisSession((prev) => {
            if (prev.has(addr)) return prev;
            const next = new Set(prev);
            next.add(addr);
            return next;
        });
    }, []);

    // §21.5 lookalike fuzzy-match. Compare the entered address against
    // the autocomplete candidate set (contacts + recent send history).
    // Surfaces a warning when the user is about to send to an address
    // that is one or two characters off from a known one.
    // Settings > Security > Lookalike address warnings turns this off
    // (operator ruling 2026-11-14); it is on unless switched off.
    const lookalikeOn = lookalikeWarningsEnabled(settings);
    const lookalikeWarning = useMemo(() => {
        if (!lookalikeOn) return null;
        const trimmed = toAddress.trim();
        if (!trimmed) return null;
        const hit = findLookalike({ address: trimmed, candidates: suggestions });
        if (!hit) return null;
        const sourceLabel = hit.match.source === 'contact'
            ? `contact "${hit.match.label}"`
            : 'an address you have sent to before';
        const pct = Math.round(hit.score * 100);
        return `Looks ${pct}% similar to ${sourceLabel}: ${hit.match.address}. Double-check this is the address you mean.`;
    }, [lookalikeOn, toAddress, suggestions]);

    // §29.2 Max + §29.3 fiat toggle.
    // Fiat rate for the approximate-value preview + the optional fiat-entry mode.
    // Oracle-primary with CoinGecko fallback (§45); the
    // fallback is gated on the privacy.priceDataEnabled setting.
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    // The amount may be a token while the network fee is always paid in the
    // chain coin. Resolve them separately so a token with no market shows no
    // fiat preview, while a token with its own oracle or DEX rate uses that
    // rate and retains its source label in AmountField.
    const amountFiatRate = useTickFiatRate({
        chainCoin: !isDemo && chainId ? chainRegistry.get(chainId)?.coin : null,
        tick,
        nativeTicker: nativeTickerFor(chainId ? chainRegistry.get(chainId) : null),
        fiatCurrency,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
        enabled: chainRegistry.get(chainId || '')?.networkKind === 'mainnet',
    });

    // The new-recipient test-send threshold is an amount in the display
    // currency (operator ruling 2026-11-14), converted to the chain's base
    // units at check time with the amount's own native price. With no price
    // there is nothing to compare, so the suggestion is skipped silently.
    const testSendThresholdFiat = resolveTestSendFiat(settings);
    const testSendThresholdUnits = useMemo(() => {
        if (!testSendThresholdFiat) return null;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        if (!desc || !nativeTicker || tick.trim().toUpperCase() !== nativeTicker) return null;
        // A native tick, so this is the coin's own rate.
        if (!amountFiatRate) return null;
        const coin = fiatToCoin(testSendThresholdFiat, amountFiatRate, nativeDecimalsFor(desc));
        if (coin === null) return null;
        const units = exactSatsBigIntFromDecimalString(coin, desc);
        return units !== null && units > 0n ? units : null;
    }, [testSendThresholdFiat, chainId, tick, amountFiatRate]);

    const primaryRecipientNovelty = useMemo(() => {
        if (testSendThresholdUnits === null) return null;
        const dest = toAddress.trim();
        const desc = chainId ? chainRegistry.get(chainId) : null;
        if (!dest || !desc?.coin) return null;
        const nativeTicker = nativeTickerFor(desc);
        if (!nativeTicker || tick.trim().toUpperCase() !== nativeTicker) return null;
        return checkRecipientNovelty({
            address: dest,
            chainCoin: desc.coin,
            contacts,
            historyRows,
        });
    }, [testSendThresholdUnits, toAddress, tick, chainId, contacts, historyRows]);

    // §21.4 test-send gate. Active when:
    //   - a fiat threshold is set (Settings > Security > New-recipient test
    //     send) and the wallet holds a price to convert it with
    //   - the send is a native-coin send (tick matches descriptor.coin
    //     uppercased; only the coin has the price the threshold converts at)
    //   - the amount in base units exceeds the converted threshold
    //   - recipient is novel (not in contacts on this chain, no past SEND
    //     to it from any of the wallet's addresses on this chain)
    //   - user hasn't already acknowledged this address in the session
    const testSendGate = useMemo(() => {
        const threshold = testSendThresholdUnits;
        if (threshold === null) return null;
        const dest = toAddress.trim();
        if (!dest) return null;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        if (!nativeTicker || tick.trim().toUpperCase() !== nativeTicker) return null;
        const amountSats = nativeDecimalsFor(desc) === 8
            ? exactSatsBigIntFromDecimalString(amount)
            : exactSatsBigIntFromDecimalString(amount, desc);
        if (amountSats === null || amountSats <= 0n) return null;
        if (amountSats <= threshold) return null;
        if (!primaryRecipientNovelty?.novel) return null;
        if (testedThisSession.has(dest)) return null;
        return {
            amountSats,
            threshold,
            ticker: nativeTicker,
        };
    }, [testSendThresholdUnits, toAddress, tick, amount, chainId, primaryRecipientNovelty, testedThisSession]);

    const isNativeSend = useMemo(() => {
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        return Boolean(nativeTicker && tick.trim().toUpperCase() === nativeTicker);
    }, [chainId, tick]);

    // PC-52 derived state. `sendLegs` is the whole recipient list (first row +
    // extras) in the shape the flows take; `isMultiSend` is what switches the
    // payload from the flat to/tick/amount fields to `legs`.
    const isMultiSend = extraLegs.length > 0;
    const sendLegs = useMemo(() => [
        {
            to: toAddress.trim(),
            tick: tick.trim(),
            amount: String(amount).trim(),
            ...(isNativeSend || !memo.trim() ? {} : { memo: memo.trim() }),
        },
        ...extraLegs.map((leg) => ({
            to: leg.to.trim(),
            tick: (perRecipientToken && leg.tick.trim()) ? leg.tick.trim() : tick.trim(),
            amount: String(leg.amount).trim(),
            ...(isNativeSend || !memo.trim() ? {} : { memo: memo.trim() }),
        })),
    ], [toAddress, tick, amount, memo, isNativeSend, extraLegs, perRecipientToken]);
    // Per-token totals, so the form can show what the whole send costs rather
    // than only the first row's amount.
    const sendTotals = useMemo(() => totalsByTick(sendLegs), [sendLegs]);
    // A native tick pays real outputs instead of writing an action, so it has
    // no multi-recipient form (flows/sendLegs.js refuses it, and the refusal is
    // mirrored here so the user learns it at compose time rather than at sign
    // time). Typed rows are KEPT, not silently dropped: switching the token
    // back is the fix, and discarding a list of addresses the user just entered
    // would be the worse failure.
    const nativeMultiSendBlock = isMultiSend && isNativeSend
        ? `${tick.trim().toUpperCase()} can be sent to only one recipient at a time. `
          + 'Remove the additional recipients or choose a token.'
        : null;

    // dust floor on the RECIPIENT amount, refused here rather than at the node.
    //
    // An output below the chain's dust threshold is non-standard, so the transaction is
    // rejected at relay: it never enters a mempool and costs no miner fee, but the wallet
    // has already composed it, opened the confirm screen and SIGNED it, and all the user
    // was told afterwards was that "the network rejected this transaction" - which names
    // neither the amount nor the floor, so retrying the same amount is the obvious next
    // move. The floor is a per-chain protocol constant the wallet already knows (the
    // native-fee lane refuses a below-dust FEE output by the same reasoning, (b)),
    // so this is predictable before anything is built.
    //
    // NATIVE sends only. A native amount is paid as a real output of exactly that size; a
    // token amount is written into the action instead, and the encoder sizes the
    // destination output itself (its own `dustAmount`, M-6), so a 109-unit token send is
    // perfectly ordinary. `amount` here is the first leg; extra legs are token-only,
    // because nativeMultiSendBlock above already refuses a multi-recipient native send.
    const dustBlock = useMemo(() => {
        if (!isNativeSend) return null;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const floor = dustThresholdForCoin(desc?.coin);
        if (!floor) return null;
        const sats = exactSatsBigIntFromDecimalString(amount, desc);
        if (sats === null || sats <= 0 || sats >= floor) return null;
        const ticker = nativeTickerFor(desc) || tick.trim().toUpperCase();
        const minimum = decimalStringFromSats(BigInt(floor), desc);
        return `That amount is too small to send. The smallest ${ticker} payment the network will `
            + `carry is ${minimum} ${ticker} (${formatWithThousands(String(floor))} sats), and anything `
            + 'under that is refused by every node, so it can never arrive. Enter at least '
            + `${minimum} ${ticker}.`;
    }, [isNativeSend, chainId, amount, tick]);

    // A value the code sets (Max, a payment link, a picker, a paste) never fires a field's
    // change handler, so a field whose value moves drops its own entry from the error map
    // here. Typing already clears through the kit fields; this covers the rest, and it also
    // retracts the dust refusal the moment the amount stops being dust.
    const clearFormError = form.clear;
    useEffect(() => { clearFormError('send-destination'); }, [toAddress, clearFormError]);
    useEffect(() => { clearFormError('send-token'); }, [tick, clearFormError]);
    useEffect(() => { clearFormError('send-amount'); }, [amount, clearFormError]);
    useEffect(() => { clearFormError('send-memo'); }, [memo, clearFormError]);
    useEffect(() => { clearFormError('send-from'); }, [fromAddressId, clearFormError]);

    // The amount's fiat rate (amountFiatRate) is resolved above the test-send
    // gate, which converts its fiat threshold with it.
    // The confirm page's cost card prices the fee as the other forms' do.
    const { formatNativeFee: formatConfirmFeeFiat } = useFeeFiat({
        chainId: chainId || undefined,
        // A demo wallet reads no prices, as the amount rate above.
        chainCoin: !isDemo && chainId ? chainRegistry.get(chainId)?.coin : undefined,
        nativeTicker: nativeTickerFor(chainId ? chainRegistry.get(chainId) : null),
        settings,
    });

    // Switching from the coin to a token while typing in fiat would leave the
    // field in a mode it can no longer convert, so fall back to coin entry.
    useEffect(() => {
        if (!amountFiatRate && amountInputMode === 'fiat') {
            setAmountInputMode('coin');
            setFiatAmount('');
        }
    }, [amountFiatRate, amountInputMode]);

    const onTickInputChange = useCallback((value) => {
        const changed = value.trim().toUpperCase() !== tick.trim().toUpperCase();
        setTick(value);
        if (!changed) return;
        // A row without its own token sends the first row's token, so its amount goes too.
        const sharesToken = (row) => !perRecipientToken || !row.tick.trim();
        const hasSharedAmounts = Boolean(amount)
            || extraLegs.some((row) => sharesToken(row) && Boolean(row.amount));
        if (!hasSharedAmounts) return;
        cancelMax();
        if (amount) setAmount('');
        setFiatAmount('');
        setAmountInputMode('coin');
        setExtraLegs((rows) => rows.map((row) => (sharesToken(row) ? { ...row, amount: '' } : row)));
        setAssetSwitchNotice('Token changed. The amount was cleared because the new token may use different decimal places.');
    }, [amount, extraLegs, perRecipientToken, tick, cancelMax]);

    // A network switch (Network field or From picker) moves the whole form to
    // the new chain, as a pasted payment link does: From and Token re-default,
    // amount, fee and extra recipients reset; To stays only if valid there.
    const onNetworkChange = useCallback((cid) => {
        if (!cid || cid === chainId) return;
        const nextDescriptor = chainRegistry.get(cid);
        setChainId(cid);
        setFromAddressId(null);
        setMultisigSource(null);
        setTick(nativeTickerFor(nextDescriptor) || '');
        cancelMax();
        const hadAmount = Boolean(amount) || extraLegs.length > 0;
        setAmount('');
        setFiatAmount('');
        setAmountInputMode('coin');
        setExtraLegs([]);
        setPerRecipientToken(false);
        // Multi's rows were checked against the old network's addresses and
        // assets, so they go with it, and the notice says so; the Advanced
        // text stays and is checked again on Send.
        const hadRecipients = multiRecipients.length > 0;
        setMultiRecipients([]);
        setMultiDraft(null);
        setMultiAddDraft(null);
        multiListEditedRef.current = false;
        if (toAddress.trim() && destinationAddressError(toAddress, nextDescriptor)) setToAddress('');
        setToError(null);
        setPastedRecipient(null);
        setPasteHint(null);
        setPasteWarning(null);
        setAssetSwitchNotice(hadRecipients
            ? 'Network changed. The recipients and network fee were reset because their addresses and assets belong to the old network.'
            : hadAmount
                ? 'Network changed. The amount and network fee were reset because they may not be valid on the new network.'
                : null);
    }, [chainId, amount, extraLegs, toAddress, cancelMax, multiRecipients]);

    const amountInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Amount-block input handler that branches on `amountInputMode`.
    // The canonical `amount` is always coin-scale (matches the payload
    // shape Send submits); when the user is typing in fiat, we keep
    // their raw text in `fiatAmount` for display fidelity and derive
    // the coin amount via fiatToCoin so the rest of the form (fee
    // estimate, simulator, Max guards) stays correct.
    //
    // Commas are formatting only; strip them before storing, then
    // restore the cursor by mapping its position from "non-comma chars
    // to the left" so typing across a thousands boundary doesn't fling
    // the caret around.
    const onAmountFieldChange = useCallback((rawValue, cursorPos) => {
        const stripped = String(rawValue).replace(/,/g, '');
        // Reject anything that isn't a valid partial decimal; keeps
        // the field from accepting "1.2.3" or random chars while still
        // allowing in-progress entries like "" / "." / "1.".
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        cancelMax();
        if (amountInputMode === 'fiat') {
            setFiatAmount(stripped);
            if (!amountFiatRate) {
                if (stripped === '') setAmount('');
            } else {
                const derivedCoin = fiatToCoin(stripped, amountFiatRate);
                setAmount(derivedCoin != null ? derivedCoin : '');
            }
        } else {
            setAmount(stripped);
        }
        if (typeof cursorPos === 'number' && amountInputRef.current) {
            const formattedNew = formatWithThousands(stripped);
            const nonCommaBefore = countNonCommaBefore(String(rawValue), cursorPos);
            const nextCursor = indexAfterNonCommaCount(formattedNew, nonCommaBefore);
            const el = amountInputRef.current;
            requestAnimationFrame(() => {
                if (el && document.activeElement === el) {
                    try { el.setSelectionRange(nextCursor, nextCursor); } catch { /* selection unavailable on some input types */ }
                }
            });
        }
    }, [amountInputMode, amountFiatRate, cancelMax]);

    const toggleAmountInputMode = useCallback(() => {
        if (!amountFiatRate) return;
        setAmountInputMode((prev) => {
            if (prev === 'coin') {
                const value = amount ? coinToFiatExact(amount, amountFiatRate) : null;
                setFiatAmount(value != null ? roundDecimalString(value, 2) : '');
                return 'fiat';
            }
            // fiat -> coin: keep canonical amount, clear typed fiat
            setFiatAmount('');
            return 'coin';
        });
    }, [amount, amountFiatRate]);

    const onSendSmallTest = useCallback(() => {
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const amtSats = exactSatsBigIntFromDecimalString(amount, desc);
        if (amtSats == null || amtSats <= 0n) return;
        // 1% of the original (floor division in sats).: the floor is the chain's
        // dust threshold, not one satoshi, because the gate only ever fires on a NATIVE
        // send and 1% of a modest amount lands under 546 sats routinely. A one-sat "test"
        // is a transaction no node relays, so the button that exists to build the user's
        // confidence would have handed them a failure instead. Exact BigInt math keeps
        // the result a plain decimal string ('0.00000001', never '1e-8').
        const floor = BigInt(dustThresholdForCoin(desc?.coin) || 1);
        const onePercent = amtSats / 100n;
        const lifted = onePercent > floor ? onePercent : floor;
        // Never propose a "small test" larger than what the user asked to send.
        const reduced = lifted < amtSats ? lifted : amtSats;
        const display = nativeDecimalsFor(desc) === 8
            ? decimalStringFromSats(reduced)
            : decimalStringFromSats(reduced, desc);
        cancelMax();
        setAmount(display);
        setStage('form');
    }, [amount, chainId, cancelMax]);

    // Latest-tick ref so the chainId effect below can preserve a
    // non-empty tick without subscribing to every keystroke.
    useEffect(() => {
        if (!walletId || typeof messaging.getActiveAddresses !== 'function') return undefined;
        let cancelled = false;
        setActiveByChain({});
        messaging.getActiveAddresses(walletId, accountId)
            .then((m) => { if (!cancelled) setActiveByChain(m || {}); })
            .catch(() => { if (!cancelled) setActiveByChain({}); });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    useEffect(() => {
        if (!walletId || !chainId || typeof messaging.listMultisigReceiveAddresses !== 'function') {
            setMultisigAddresses([]);
            return undefined;
        }
        let cancelled = false;
        messaging.listMultisigReceiveAddresses({ walletId, chainId })
            .then((rows) => { if (!cancelled) setMultisigAddresses(Array.isArray(rows) ? rows : []); })
            .catch(() => { if (!cancelled) setMultisigAddresses([]); });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    const tickRef = useRef(tick);
    tickRef.current = tick;
    useEffect(() => {
        if (stage !== 'form' || confirmBusy || !chainId || !addressesByChain) return;
        const all = addressesByChain[chainId] || [];
        // A source the user picked on THIS chain wins over the default.
        // The tick default below still runs either way, so only the
        // from-address half is skipped.
        if (pickedSourceChain !== chainId) {
            // Prefer the chain's active (operating) address; fall back to the
            // newest HD external address, then the newest hardware-device one,
            // when no active address is resolvable.
            const activeId = activeByChain[chainId]?.id;
            if (activeId && all.some((a) => a.id === activeId)) {
                setFromAddressId(activeId);
            } else {
                setFromAddressId(newestDerivedExternalId(all));
            }
        }
        // Default the tick to the native coin only when the field is
        // empty. Without this guard, SendPicker prefilling a non-native
        // token (e.g. PEPECREATURE on Bitcoin testnet4) gets clobbered
        // by 'TBTC' the moment this effect fires post-mount.
        const descriptor = chainRegistry.get(chainId);
        if (descriptor && !tickRef.current.trim()) {
            const nativeTicker = nativeTickerFor(descriptor);
            if (nativeTicker) setTick(nativeTicker);
        }
    }, [stage, confirmBusy, chainId, addressesByChain, activeByChain, pickedSourceChain]);

    useLayoutEffect(() => {
        if (stage !== 'review') return;
        const scroller = reviewPageRef.current?.querySelector('main');
        if (scroller) scroller.scrollTop = 0;
        reviewHeadingRef.current?.focus({ preventScroll: true });
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    // A chain from another network (a payment link for Testnet on a Mainnet
    // wallet) has no address here; the fix is the network switch, not Receive.
    const otherNetworkKind = settings && descriptor?.networkKind
        && descriptor.networkKind !== getActiveNetwork(settings)
        ? descriptor.networkKind
        : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Follow the sent transaction on the done screen: confirmed history wins,
    // then the pending record, so the card moves from pending to confirmed or
    // failed without the user opening History.
    useEffect(() => {
        const txid = result?.txid || result?.broadcast?.txid;
        const source = fromAddress?.address;
        if (stage !== 'done' || !txid || !chainId || !source || result?.queued) return undefined;
        let cancelled = false;
        sentStatusPollRef.current += 1;
        setSentStatus({ status: 'pending', confirmations: null, blockIndex: null });

        const rowsFrom = (response) => {
            if (Array.isArray(response)) return response;
            if (Array.isArray(response?.data)) return response.data;
            if (Array.isArray(response?.rows)) return response.rows;
            return [];
        };
        const poll = async () => {
            const requestId = ++sentStatusPollRef.current;
            const [historyRows, pendingRows, watermarkResult] = await Promise.all([
                messaging.getAddressHistory({ chainId, address: source })
                    .then(rowsFrom)
                    .catch(() => []),
                typeof messaging.getPendingTxsForAddress === 'function'
                    ? messaging.getPendingTxsForAddress({ chainId, address: source })
                        .then(rowsFrom)
                        .catch(() => [])
                    : Promise.resolve([]),
                typeof messaging.getIndexerWatermark === 'function'
                    ? messaging.getIndexerWatermark({ chainId }).catch(() => null)
                    : Promise.resolve(null),
            ]);
            if (cancelled || requestId !== sentStatusPollRef.current) return;

            const wanted = String(txid).toLowerCase();
            let entry = null;
            const historyRow = historyRows.find((row) => (
                String(row?.tx_hash ?? row?.txHash ?? '').toLowerCase() === wanted
            ));
            if (historyRow) {
                entry = normalizeHistoryRow(historyRow, { chainId, address: source });
            } else {
                const pendingRecord = pendingRows.find((record) => (
                    String(record?.txid || '').toLowerCase() === wanted
                ));
                if (pendingRecord) {
                    entry = pendingTxToEntry({
                        chainId,
                        address: source,
                        pendingTx: pendingRecord,
                        ownAddresses: new Set([source.toLowerCase()]),
                        observedAtMs: Date.now(),
                    });
                }
            }
            if (!entry) return;

            // This poll reads no mempool, so a send still waiting for its
            // block must not be called dropped.
            const status = classifyEntryStatusWithoutMempool(entry);
            const blockIndex = Number(entry.blockIndex || entry.pending?.confirmedBlockIndex || 0);
            const watermark = Number(watermarkResult?.watermark || 0);
            const chainTip = Math.max(blockIndex, Number.isFinite(watermark) ? watermark : 0);
            setSentStatus({
                status,
                confirmations: status === 'confirmed' && blockIndex > 0
                    ? chainTip - blockIndex + 1
                    : null,
                blockIndex: blockIndex || null,
            });
        };

        void poll();
        const stop = startVisibleInterval(() => { void poll(); }, PENDING_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            sentStatusPollRef.current += 1;
            stop();
        };
    }, [chainId, fromAddress?.address, messaging, result, stage]);

    // Fee bumping, coin control and the change address live in the shared
    // Advanced section (FeeSection draws it above Speed and Fees). Its
    // choices are kept per network and source address, so a new source
    // starts from the defaults, and Send reads them here for compose and
    // for the review rows.
    const advancedEntry = useAdvancedEntry(advancedKey({
        formKey: SEND_FORM_ID,
        chainId,
        address: fromAddress?.address,
    }));
    const coinControlEnabled = advancedEntry.shown.coins && advancedEntry.coinControl;
    const selectedUtxos = useMemo(() => selectedUtxosOf(advancedEntry), [advancedEntry]);
    const selectedUtxoTotalSats = useMemo(
        () => selectedUtxos.reduce((total, utxo) => total + (utxoValueSats(utxo) ?? 0n), 0n),
        [selectedUtxos],
    );
    const chosenChange = advancedEntry.shown.change ? advancedEntry.change : '';
    const changeAddress = useMemo(() => (chosenChange ? { address: chosenChange } : null), [chosenChange]);
    const coinControlLabel = coinControlEnabled
        ? `${selectedUtxos.length} selected input${selectedUtxos.length === 1 ? '' : 's'}`
        : 'Automatic input selection';
    const trimmedMemo = memo.trim();
    // The first problem with the memo as sent: its length, then unsafe characters.
    const memoTooLong = memoLengthError(trimmedMemo) || memoCharacterError(trimmedMemo);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        // PC-52: the decoder summarizes ONE leg, so a multi-recipient send is
        // summarized here instead of being decoded into a line that names the
        // first recipient and hides the rest. Every leg is listed in Details.
        if (isMultiSend) {
            return {
                summary: summarizeSendLegs(sendLegs),
                details: sendLegs.map((leg, i) => ({
                    label: `Recipient ${i + 1}`,
                    value: `${formatWithThousands(leg.amount) || leg.amount} ${leg.tick.toUpperCase()} to ${leg.to}`,
                })),
                warnings: [],
            };
        }
        return groupDecodedAmounts(decoderLib.decodeAction({
            action: 'SEND',
            params: {
                TICK: tick.trim(),
                AMOUNT: String(amount).trim(),
                DESTINATION: toAddress.trim(),
                MEMO: memo.trim() || undefined,
            },
            chainId: chainId || undefined,
            chainRegistry,
        }));
    }, [stage, tick, amount, toAddress, memo, chainId, isMultiSend, sendLegs]);

    // §21.2 balance-change preview. Fetched on entering review against
    // the source address; the result feeds `decoder.simulateAction` and
    // renders inside `<BalanceChanges>` between the headline and details.
    // Fetch failure is non-blocking; the section renders muted with a
    // "(preview unavailable)" line and the user can still sign.
    // Bumped when a send is refused over coins another send took, so the
    // balance line and Max read the address again instead of offering them.
    const [balanceReread, setBalanceReread] = useState(0);
    const sendFailureCopy = useCallback((err, opts) => {
        if (isSpentCoinsRefusal(err)) setBalanceReread((n) => n + 1);
        return submitFailureMessage(err, opts);
    }, []);
    const [previewBalances, setPreviewBalances] = useState(
        /** @type {{ loading: boolean, error: string | null, sdkShape: any | null }} */
        ({ loading: false, error: null, sdkShape: null }),
    );
    useEffect(() => {
        // Fetch on review (for the simulator) AND on form (so Max + the
        // "Available: X" hint know what's spendable). Form-stage fetches
        // are non-blocking; failure leaves Max disabled, the hint hidden.
        if ((stage !== 'review' && stage !== 'form') || !chainId || !fromAddress) {
            setPreviewBalances({ loading: false, error: null, sdkShape: null });
            return undefined;
        }
        // Offline the read cannot finish (the request layer retries it for up
        // to a minute), so the hint shows Home's saved copy of this address
        // when there is one and says the balance is unavailable when not.
        if (networkOffline && !isDemo) {
            const saved = (readBalanceCache(walletId, accountId, settings?.activeNetwork || 'mainnet')
                ?.balances?.[chainId] || [])
                .find((row) => row?.address === fromAddress.address);
            setPreviewBalances({ loading: false, error: null, sdkShape: saved?.balances || null });
            return undefined;
        }
        let cancelled = false;
        setPreviewBalances({ loading: true, error: null, sdkShape: null });
        if (isDemo) {
            const entry = (flowsLib.synthesizeDemoBalances(addressesByChain)[chainId] || [])
                .find((row) => row.address === fromAddress.address);
            setPreviewBalances({ loading: false, error: null, sdkShape: entry?.balances || null });
            return undefined;
        }
        messaging.getAddressBalances(chainId, fromAddress.address)
            .then((sdkShape) => {
                if (cancelled) return;
                setPreviewBalances({ loading: false, error: null, sdkShape });
            })
            .catch(() => {
                if (cancelled) return;
                setPreviewBalances({
                    loading: false,
                    error: 'Balances could not be loaded. Check your connection and try again.',
                    sdkShape: null,
                });
            });
        return () => { cancelled = true; };
    }, [stage, chainId, fromAddress, messaging, isDemo, addressesByChain, networkOffline, walletId, accountId, settings?.activeNetwork, balanceReread]);

    // Set once the first balance check settles; see the loading gate below.
    const balanceGateSettledRef = useRef(false);
    // The first balance check holds the form back for a moment only. A read
    // that hangs (services unreachable while the device reports a network)
    // would otherwise keep "Loading" up until the reachability probe decides
    // offline, so the form shows after the wait and its balance hint says the
    // balance is unavailable until the read returns.
    const [balanceGateWaived, setBalanceGateWaived] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!balanceGateSettledRef.current) setBalanceGateWaived(true);
        }, FIRST_BALANCE_GATE_MS);
        return () => clearTimeout(timer);
    }, []);
    // Bumped by Try again so the empty-chain check runs again.
    const [balanceRecheck, setBalanceRecheck] = useState(0);
    const [chainBalanceState, setChainBalanceState] = useState(
        /** @type {{ chainId: string | null, status: 'loading' | 'funded' | 'empty' | 'unknown' }} */
        ({ chainId: null, status: 'loading' }),
    );
    useEffect(() => {
        // Until the address map and chain are known the status stays at its
        // loading default, so the form never flashes before the check runs.
        if (!chainId || !addressesByChain) return undefined;
        // Offline the read cannot finish (the request layer retries it for up
        // to a minute), so the form shows at once and the check runs again
        // when the connection returns.
        if (isWatcherMode || isSignerMode || isDemo || networkOffline) {
            setChainBalanceState({ chainId, status: 'unknown' });
            return undefined;
        }
        if (typeof messaging.getWalletBalances !== 'function') {
            setChainBalanceState({ chainId, status: 'unknown' });
            return undefined;
        }
        let cancelled = false;
        // A re-check for a chain already judged keeps its last status, so a
        // refreshed address map never swaps the form for a loading line.
        setChainBalanceState((prev) => (
            prev.chainId === chainId ? prev : { chainId, status: 'loading' }
        ));
        messaging.getWalletBalances(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                const entries = byChain?.[chainId];
                const addressCount = (addressesByChain[chainId] || []).length;
                // An incomplete or failed aggregate, or one whose coin balance could not be
                // read, cannot prove the chain is empty.
                if (!Array.isArray(entries) || entries.length < addressCount
                    || entries.some((entry) => entry?.error || !entry?.balances
                        || (Array.isArray(entry.balances.unavailable) && entry.balances.unavailable.includes('native')))) {
                    setChainBalanceState({ chainId, status: 'unknown' });
                    return;
                }
                const nativeTicker = nativeTickerFor(chainRegistry.get(chainId));
                const funded = entries.some((entry) => {
                    const native = decoderLib.balancesFromSdk(entry.balances)
                        .find((row) => String(row.tick || '').toUpperCase() === nativeTicker);
                    return compareDecimalStrings(String(native?.amount || '0'), '0') === 1;
                });
                setChainBalanceState({ chainId, status: funded ? 'funded' : 'empty' });
            })
            .catch(() => {
                if (!cancelled) setChainBalanceState({ chainId, status: 'unknown' });
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, chainId, addressesByChain, messaging, isWatcherMode, isSignerMode, isDemo, balanceRecheck, networkOffline]);

    // PC-26 gated-send readiness. A tick with active gated content can
    // only be sent as BATCH(SEND, MESSAGE-with-key); the host guard
    // enforces that at compose time, and this probe mirrors its key
    // resolution (secret-free) so the form can explain BEFORE submit:
    // ready = keys attach silently, partial = warn (recipient can't open
    // the missing packs), blocked = no keys held, submit disabled and a
    // recovery scan offered (software signers only; the scan decrypts
    // with the address keys, which HW/watch-only cannot do - §5).
    const [gatedInfo, setGatedInfo] = useState(
        /** @type {{ state: 'ungated' | 'ready' | 'partial' | 'blocked', groups: any[] } | null} */ (null),
    );
    const [gatedScanPassword, setGatedScanPassword] = useState('');
    const [gatedScanBusy, setGatedScanBusy] = useState(false);
    const [gatedScanError, setGatedScanError] = useState(/** @type {string | null} */ (null));
    const gatedProbeSeq = useRef(0);
    const gatedScanBusyRef = useRef(false);
    useEffect(() => {
        const seq = gatedProbeSeq.current + 1;
        gatedProbeSeq.current = seq;
        gatedScanBusyRef.current = false;
        setGatedScanBusy(false);
        setGatedScanPassword('');
        setGatedInfo(null);
        setGatedScanError(null);
        if (isDemo || !walletId || !chainId || !tick.trim()) return undefined;
        if (typeof messaging.gatedSendReadiness !== 'function') return undefined; // older host build
        // Debounced: `tick` changes per keystroke when typed by hand.
        const timer = setTimeout(() => {
            messaging.gatedSendReadiness({
                walletId,
                chainId,
                tick: tick.trim(),
                sourceAddress: fromAddress?.address,
                // PC-29: destination + amount feed the unlock-threshold
                // lane host-side (inert until the GATE_MIN_AMOUNT flag
                // day), keeping this banner in agreement with compose.
                to: toAddress.trim() || undefined,
                amount: amount || undefined,
            })
                .then((resp) => {
                    if (gatedProbeSeq.current === seq && resp && resp.state !== 'ungated') setGatedInfo(resp);
                })
                .catch(() => {
                    // Detection failure degrades to no banner; the compose-time
                    // guard (and ultimately the indexer) still protects the send.
                });
        }, 400);
        return () => {
            clearTimeout(timer);
            if (gatedProbeSeq.current === seq) gatedProbeSeq.current += 1;
        };
    }, [walletId, chainId, tick, toAddress, amount, fromAddress?.address, messaging, isDemo]);

    // PC-52 + PC-26: a gated tick's SEND is only valid inside
    // BATCH(SEND, MESSAGE) carrying an unlock key encrypted to the RECIPIENT,
    // so an N-recipient send needs N handoffs. Only the single-recipient path
    // composes that today, and the flows refuse the rest, so the form refuses
    // it here too instead of letting compose fail after the modal opens.
    // `gatedInfo` is non-null only for a tick with active gated content
    // (an 'ungated' probe result is never stored).
    const gatedMultiSendBlock = isMultiSend && gatedInfo
        ? `${tick.trim().toUpperCase()} includes protected content. Each recipient needs a separate `
          + 'unlock key, so send this token to one recipient at a time.'
        : null;

    // A matching coin or token payment to an open dispenser is a purchase, and
    // a refused payment keeps the sent asset. Show that above the credentials.
    const dispensersAtDestination = useDispenserDestination({
        messaging,
        chainId,
        to: toAddress,
        paymentTick: tick,
        isNativePayment: isNativeSend,
        enabled: !isDemo && !isMultiSend,
    });
    // Each recipient of a multi-recipient Send triggers the open dispensers at
    // its own address, so every row gets the same lookup and notice.
    const sendLegsNativeTicker = nativeTickerFor(descriptor);
    const dispensersByRecipient = useDispenserDestinations({
        messaging,
        chainId,
        payments: isMultiSend ? sendLegs.map((leg) => ({
            to: leg.to,
            paymentTick: leg.tick,
            isNativePayment: Boolean(sendLegsNativeTicker) && leg.tick.toUpperCase() === sendLegsNativeTicker,
        })) : [],
        enabled: !isDemo && isMultiSend,
    });
    const dispenserFiatAlerts = useMemo(() => {
        const codes = new Set();
        const groups = isMultiSend ? dispensersByRecipient : [dispensersAtDestination];
        for (const group of groups) {
            for (const dispenser of group || []) {
                const code = String(dispenser?.row?.fiat_code || '').trim().toUpperCase();
                if (code) codes.add(code);
            }
        }
        return [...codes].sort().map((fiatCurrency) => ({ chainId, fiatCurrency }));
    }, [chainId, isMultiSend, dispensersByRecipient, dispensersAtDestination]);
    const dispenserFiatPriceFor = usePriceAlertPrices({
        alerts: dispenserFiatAlerts,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
    });
    const dispenserFiatRateFor = useCallback((fiatCurrency) => dispenserFiatPriceFor({
        chainId,
        fiatCurrency,
    }), [chainId, dispenserFiatPriceFor]);
    const dispenserNotice = useMemo(() => (isMultiSend
        ? multiDispenserDestinationNotice({
            dispensersByRecipient, payer: fromAddress?.address, amounts: sendLegs.map((leg) => leg.amount),
            fiatRateFor: dispenserFiatRateFor,
        })
        : dispenserDestinationNotice({
            dispensers: dispensersAtDestination, payer: fromAddress?.address, amount: String(amount).trim(),
            fiatRateFor: dispenserFiatRateFor,
        })), [
        isMultiSend, dispensersByRecipient, sendLegs, dispensersAtDestination,
        fromAddress?.address, amount, dispenserFiatRateFor,
    ]);
    const protocolDestinationWarnings = useMemo(() => {
        const destinations = isMultiSend ? sendLegs.map((leg) => leg.to) : [toAddress];
        return protocolDestinationFindings(destinations, chainId).map(({ index, kind }) => {
            const warning = t(kind === 'bridge'
                ? 'send.destination.bridgeWarning'
                : 'send.destination.burnWarning');
            return isMultiSend
                ? t('send.destination.recipientWarning', { number: index + 1, warning })
                : warning;
        });
    }, [isMultiSend, sendLegs, toAddress, chainId]);
    const dispenserNoticeBlock = dispenserNotice ? (
        <div data-testid="send-dispenser-notice">
            <StatusMessage variant="status">
                {dispenserNotice.summaries
                    ? dispenserNotice.summaries.map((line) => <p key={line}>{line}</p>)
                    : dispenserNotice.summary}
            </StatusMessage>
        </div>
    ) : null;
    async function handleGatedScan(event) {
        event.preventDefault();
        if (gatedScanBusyRef.current) return;
        // G130: Recover stays enabled; an empty password is said on the field.
        if (gatedScanPassword.length === 0) {
            setGatedScanError(t('locked.enterYourPassword'));
            return;
        }
        const seq = gatedProbeSeq.current;
        gatedScanBusyRef.current = true;
        setGatedScanBusy(true);
        setGatedScanError(null);
        try {
            const res = await messaging.gatedContentScan({
                walletId,
                password: gatedScanPassword,
                chainId,
                tick: tick.trim(),
            });
            if (!mountedRef.current || gatedProbeSeq.current !== seq) return;
            setGatedScanPassword('');
            if (!res || res.recoveredKeyHashes?.length === 0) {
                setGatedScanError(
                    'No unlock keys were found for this wallet. '
                    + 'Ask the sender to send the token and its key to you again.',
                );
            }
            // Re-probe either way so the banner reflects the vault state.
            const resp = await messaging.gatedSendReadiness({
                walletId, chainId, tick: tick.trim(), sourceAddress: fromAddress?.address,
                to: toAddress.trim() || undefined, amount: amount || undefined,
            });
            if (!mountedRef.current || gatedProbeSeq.current !== seq) return;
            setGatedInfo(resp && resp.state !== 'ungated' ? resp : null);
        } catch (err) {
            if (!mountedRef.current || gatedProbeSeq.current !== seq) return;
            const bad = err?.name === 'WrongPasswordError' || err?.name === 'InvalidPasswordError';
            setGatedScanError(bad
                ? 'Incorrect password.'
                : 'Could not recover unlock keys. Check your connection and try again.');
        } finally {
            if (gatedProbeSeq.current === seq) gatedScanBusyRef.current = false;
            if (mountedRef.current && gatedProbeSeq.current === seq) setGatedScanBusy(false);
        }
    }

    // §44.2 user-selectable fee tiers. Selector backs both the §21.2
    // simulator's fee row + the §29.2 Max button. Default tier is
    // 'normal'; user picks via FeeSelector. Custom mode accepts a
    // sat/vB or DOGE/kB rate via the bound input.
    const [feePick, setFeePick] = useState(() => {
        // Prefill-encoded fee priority from a scanned receive-request URI
        // wins over saved settings on first render; user can still change
        // via the FeeSelector.
        const fp = prefill?.feePriority;
        if (fp && ['low', 'normal', 'fast'].includes(fp)) {
            return /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: fp });
        }
        const selection = prefill?.feeSelection;
        if (selection && ['low', 'normal', 'fast', 'custom'].includes(selection.mode)) {
            return selection.mode === 'custom'
                ? { mode: 'custom', customRate: Number(selection.customRate) || 0 }
                : { mode: selection.mode };
        }
        return /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' });
    });
    const prefillFeeConsumedRef = useRef(Boolean(
        (prefill?.feePriority && ['low', 'normal', 'fast'].includes(prefill.feePriority))
        || (prefill?.feeSelection && ['low', 'normal', 'fast', 'custom'].includes(prefill.feeSelection.mode)),
    ));
    const chainFeeSettings = chainId ? settings?.fees?.[chainId] : undefined;

    // Step 5 of §44: initial mode + custom rate seeded from
    // settings.fees[chainId]. Persisted preference flows from the §35
    // Fees panel's Strategy picker; user can still flip per-tx via the
    // FeeSelector without touching the saved default. Re-seeds when
    // the active chain changes.
    useEffect(() => {
        if (!chainId) return;
        // Skip the very first run when a scanned URI carried a feePriority
        // hint; that pick already seeded feePick and should beat the
        // saved default on initial render.
        if (prefillFeeConsumedRef.current) {
            prefillFeeConsumedRef.current = false;
            return;
        }
        const desc = chainRegistry.get(chainId);
        // §35.10: a stored null strategy follows the release default,
        // resolved against the chain descriptor.
        const chainFees = resolveFeeConfig(chainFeeSettings, desc);
        // Display unit comes from the descriptor's declared feeStrategy.unit
        // (one home), never from a coin-name check here.
        const tableUnit = resolveFeeUnit(desc);
        if (chainFees.strategy === 'custom' && Number.isFinite(chainFees.customSatsPerKb)) {
            setFeePick({
                mode: 'custom',
                customRate: settingsCustomToDisplayRate(tableUnit, chainFees.customSatsPerKb),
            });
        } else {
            setFeePick({
                mode: ['low', 'normal', 'fast'].includes(chainFees.strategy)
                    ? chainFees.strategy
                    : 'normal',
            });
        }
    }, [chainId, chainFeeSettings]);

    // §44.3 RBF toggle, in the shared Advanced section. The per-send
    // preference seeds from the chain's resolved fee config (§35.10: resolved
    // even with no stored entry, so a chain switch always reseeds) until the
    // user flips it; the encoder turns `rbf` into BIP125 input sequence
    // numbers (sequence < 0xfffffffe). Clamped to the descriptor's declared
    // capability (DOGE declares false; no descriptor means no RBF).
    const rbfByDefault = chainId
        ? resolveFeeConfig(settings?.fees?.[chainId], chainRegistry.get(chainId)).rbfByDefault
        : false;
    const rbfSupported = descriptor?.feeStrategy?.rbfSupported === true;
    const rbfForSend = rbfSupported && (advancedEntry.rbf ?? rbfByDefault);

    // Step 4 of §44: async fetcher probes the shell's messaging
    // layer for an SDK-backed `estimateFee` method; falls back to the
    // synchronous placeholder when the method isn't registered. The
    // sync helper still backs the initial render so the form stays
    // responsive on first paint; the effect upgrades to live tiers
    // when the SDK responds.
    const [feeTiers, setFeeTiers] = useState(/** @type {any} */ (null));
    useEffect(() => {
        if (!chainId || isDemo) {
            setFeeTiers(null);
            return undefined;
        }
        // Synchronous initial seed.
        setFeeTiers(estimateNativeSendFeeTiers({ chainId, chainRegistry }));
        let cancelled = false;
        fetchNativeSendFeeTiers({ messaging, chainId, chainRegistry })
            .then((tiers) => { if (!cancelled && tiers) setFeeTiers(tiers); })
            .catch(() => { /* keep the placeholder seed */ });
        return () => { cancelled = true; };
    }, [chainId, messaging, isDemo]);

    const feeEstimate = useMemo(() => {
        if (!chainId) return null;
        if (feePick.mode === 'custom') {
            return customFeeEstimate({
                chainId,
                chainRegistry,
                rate: Number(feePick.customRate) || 0,
            });
        }
        // Prefer the live tier (SDK-sourced when available); fall back
        // to the synchronous placeholder if the async fetch hasn't
        // populated yet.
        const liveTier = feeTiers ? feeTiers[feePick.mode] : null;
        if (liveTier) return liveTier;
        return estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode });
    }, [chainId, feePick, feeTiers]);

    const coinControlChange = useMemo(() => {
        const ticker = nativeTickerFor(descriptor) || '';
        if (selectedUtxos.length === 0) return `0 ${ticker}`.trim();
        if (!isNativeSend) return 'Calculated during review';
        const amountSats = exactSatsBigIntFromDecimalString(amount, descriptor);
        const feeSats = utxoValueSats({ value: feeEstimate?.sats });
        if (amountSats === null || feeSats === null) return 'Enter an amount to estimate';
        const changeSats = selectedUtxoTotalSats - amountSats - feeSats;
        if (changeSats < 0n) return 'Selected inputs do not cover this payment';
        return `${decimalStringFromSats(changeSats, descriptor)} ${ticker}`.trim();
    }, [amount, descriptor, feeEstimate?.sats, isNativeSend, selectedUtxoTotalSats, selectedUtxos.length]);

    // The picked rate converted to the encoder's feePerKb unit (smallest-unit
    // per KB), so the tier/custom choice actually prices the broadcast tx (not
    // just the on-screen estimate). Null when there's no usable estimate (e.g.
    // an empty custom rate), which falls back to the encoder's own default.
    // Mirrors ComposeMessage / DispenserDetail.
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // Native-unit balance available for the selected tick on the
    // source address, derived from the same SDK call the simulator
    // already runs. Drives Max + the "Available: X" hint. Lives below
    // the previewBalances + feeEstimate declarations because both are
    // referenced in the factory bodies; the original placement above
    // those `useState`/`useMemo` calls hit a TDZ during render.
    const sourceBalance = useMemo(() => {
        if (!previewBalances.sdkShape) return null;
        const tickUpper = tick.trim().toUpperCase();
        if (!tickUpper) return null;
        const decoded = decoderLib.balancesFromSdk(previewBalances.sdkShape)
            .find((balance) => balance.tick === tickUpper);
        if (!decoded) return null;
        return {
            ...decoded,
            divisibility: heldDivisibility(previewBalances.sdkShape, tickUpper),
        };
    }, [previewBalances.sdkShape, tick]);

    const firstAmountBalanceError = useMemo(() => {
        if (!sourceBalance || balancesUnchecked || balancesHidden) return null;
        const divisibility = sourceBalance.divisibility
            ?? (isNativeSend ? nativeDecimalsFor(descriptor) : null);
        if (!Number.isInteger(divisibility) || divisibility < 0) return null;
        const amountUnits = decimalToBaseUnits(String(amount).trim(), divisibility);
        const balanceUnits = decimalToBaseUnits(
            String(sourceBalance.amount ?? '').trim(),
            divisibility,
        );
        if (amountUnits === null || balanceUnits === null || amountUnits <= balanceUnits) {
            return null;
        }
        return 'Amount exceeds the available balance.';
    }, [amount, balancesHidden, balancesUnchecked, descriptor, isNativeSend, sourceBalance]);

    // A multi-recipient send spends the SUM of its legs, and each leg can sit
    // under the balance while the total does not (500 + 500.00000001 against
    // 1,000). The first-row check above only sees its own amount, so the form
    // composed, previewed and offered to sign an action the chain rejects after
    // the network fee is spent. Totals are exact decimal sums per token.
    const legTotalsBalanceError = useMemo(() => {
        if (!isMultiSend || nativeMultiSendBlock || balancesUnchecked || balancesHidden) return null;
        if (!previewBalances.sdkShape) return null;
        const held = decoderLib.balancesFromSdk(previewBalances.sdkShape);
        for (const total of sendTotals) {
            const balance = held.find((entry) => entry.tick === total.tick);
            if (!balance) continue;
            if (compareDecimalStrings(total.amount, String(balance.amount ?? '0').trim()) === 1) {
                return `The total ${total.tick} across all recipients exceeds the available balance.`;
            }
        }
        return null;
    }, [isMultiSend, nativeMultiSendBlock, balancesUnchecked, balancesHidden, previewBalances.sdkShape, sendTotals]);
    const amountBalanceError = firstAmountBalanceError || legTotalsBalanceError;

    const unusualSendWarnings = useMemo(() => {
        const exactFeeSats = confirmAction.composed?.networkFeeSats;
        const feeAmount = Number.isSafeInteger(exactFeeSats) && exactFeeSats >= 0
            ? decimalStringFromSats(BigInt(exactFeeSats))
            : feeEstimate?.coinAmount;
        const balances = previewBalances.sdkShape
            ? decoderLib.balancesFromSdk(previewBalances.sdkShape)
            : [];
        return getUnusualSendWarnings({
            sendTotals,
            balances,
            feeAmount,
            nativeTicker: nativeTickerFor(descriptor),
            isNativeSend,
        });
    }, [
        confirmAction.composed?.networkFeeSats, feeEstimate?.coinAmount,
        previewBalances.sdkShape, sendTotals, descriptor, isNativeSend,
    ]);
    const nativeSourceBalance = useMemo(() => {
        if (!previewBalances.sdkShape) return null;
        const nativeTicker = String(previewBalances.sdkShape.native?.tick || '').toUpperCase();
        if (!nativeTicker) return null;
        return decoderLib.balancesFromSdk(previewBalances.sdkShape)
            .find((balance) => String(balance.tick || '').toUpperCase() === nativeTicker) || null;
    }, [previewBalances.sdkShape]);

    // Multi and Advanced. A recipient row or an Advanced line must name an
    // address on this network, a token (the coin pays its own output and has
    // no multi-recipient form), one this address holds once the balances are
    // known, and an amount within that token's decimal places.
    const recipientRules = useMemo(() => {
        const shape = previewBalances.sdkShape;
        const held = shape && !previewBalances.loading && !previewBalances.error
            ? new Set(decoderLib.balancesFromSdk(shape).map((balance) => String(balance.tick || '').toUpperCase()))
            : null;
        return {
            addressError: (address) => destinationAddressError(address, descriptor),
            nativeTicker: nativeTickerFor(descriptor),
            isHeld: held ? (heldTick) => held.has(heldTick) : null,
            decimalsFor: shape ? (heldTick) => heldDivisibility(shape, heldTick) : null,
        };
    }, [descriptor, previewBalances.sdkShape, previewBalances.loading, previewBalances.error]);
    const advancedParsed = useMemo(
        () => parseRecipientText(advancedText, recipientRules),
        [advancedText, recipientRules],
    );
    // A balances refresh re-reads the text into a new array with the same
    // recipients; keeping the old one means nothing is re-projected, so a
    // ticked hardware cross-check (reset whenever the legs change) stays.
    const advancedListRef = useRef({ key: '', list: [] });
    const advancedRecipients = useMemo(() => {
        const key = recipientsToText(advancedParsed.recipients);
        if (key !== advancedListRef.current.key) advancedListRef.current = { key, list: advancedParsed.recipients };
        return advancedListRef.current.list;
    }, [advancedParsed]);
    const activeRecipients = sendMode === 'multi'
        ? multiRecipients
        : (sendMode === 'advanced' ? advancedRecipients : null);
    // One transaction's ceiling, said before review and never met by
    // splitting or dropping recipients.
    const recipientFitError = activeRecipients
        ? recipientListFitError(activeRecipients, isNativeSend ? '' : memo.trim())
        : null;

    // The list is projected onto the first-recipient fields and the extra
    // legs, so validation, compose, the confirm screen, watch-only review and
    // hardware signing run exactly as they do for any send with legs.
    const projectedRef = useRef(false);
    const projectRecipients = useCallback((list) => {
        const [first, ...rest] = list;
        cancelMax();
        setAmountInputMode('coin');
        setFiatAmount('');
        setPastedRecipient(null);
        setToError(null);
        setPasteHint(null);
        setPasteWarning(null);
        setToAddress(first ? first.to : '');
        if (first) setTick(first.tick);
        setAmount(first ? first.amount : '');
        setExtraLegs(rest.map((row) => ({ id: row.id, to: row.to, tick: row.tick, amount: row.amount })));
        setPerRecipientToken(rest.length > 0);
    }, [cancelMax]);
    useEffect(() => {
        if (!activeRecipients) { projectedRef.current = false; return; }
        // Entering an empty tab leaves Single's fields alone until a
        // recipient exists, so going back to Single loses nothing.
        if (activeRecipients.length === 0 && !projectedRef.current) return;
        projectedRef.current = true;
        projectRecipients(activeRecipients);
    }, [activeRecipients, projectRecipients]);
    // The legs Send would compose are exactly the list on screen, leg for leg.
    // Anything that wrote the hidden first-recipient fields behind the list
    // breaks this, and Send then re-projects instead of composing.
    const legsMatchList = useCallback((list) => (
        sendLegs.length === list.length
        && list.every((row, index) => sendLegs[index].to === row.to
            && sendLegs[index].tick.toUpperCase() === row.tick
            && sendLegs[index].amount === row.amount)
    ), [sendLegs]);

    // A change to the list or the text, or a tab switch, takes the list's
    // entries (and each bad line or row) out of the form's error notice; the
    // next Send checks again (G120).
    const formErrorMap = form.errors;
    const clearFormEntry = form.clear;
    const clearListEntries = useCallback(() => {
        for (const key of Object.keys(formErrorMap || {})) {
            if (key === 'send-multi-list' || key === 'send-advanced-text'
                || key.startsWith('form:advanced-line-') || key.startsWith('form:multi-row-')) {
                clearFormEntry(key);
            }
        }
    }, [formErrorMap, clearFormEntry]);

    // Single's recipient, when it is a complete token payment, opens as the
    // first row of an empty list.
    const singleAsRecipients = useCallback(() => {
        const row = { to: toAddress, tick, amount };
        return Object.keys(validateRecipient(row, recipientRules)).length === 0
            ? [{ id: newRecipientId(), to: toAddress.trim(), tick: tick.trim().toUpperCase(), amount: String(amount).trim() }]
            : [];
    }, [toAddress, tick, amount, recipientRules]);
    const switchSendMode = useCallback((next) => {
        if (next === sendMode) return;
        let list = multiRecipients;
        if (sendMode === 'advanced' && next === 'multi') {
            list = advancedParsed.recipients.map((row) => ({ ...row, id: newRecipientId() }));
            setMultiRecipients(list);
            multiListEditedRef.current = false;
        } else if (sendMode === 'single' && list.length === 0 && !(next === 'advanced' && advancedText.trim())) {
            list = singleAsRecipients();
            if (list.length > 0) {
                setMultiRecipients(list);
                multiListEditedRef.current = true;
            }
        }
        if (next === 'advanced' && (multiListEditedRef.current || !advancedText.trim())) {
            setAdvancedText(recipientsToText(list));
            multiListEditedRef.current = false;
        }
        if (next === 'single') {
            // Single keeps the first recipient in To, Asset and Amount.
            setExtraLegs([]);
            setPerRecipientToken(false);
        }
        setAdvancedChecked(false);
        setMultiDraft(null);
        setMultiAddDraft(null);
        clearListEntries();
        setSendMode(next);
    }, [sendMode, multiRecipients, advancedParsed, advancedText, singleAsRecipients, clearListEntries]);

    const multiMaxFor = useCallback((heldTick) => {
        const shape = previewBalances.sdkShape;
        if (!shape) return null;
        const balance = decoderLib.balancesFromSdk(shape)
            .find((entry) => String(entry.tick || '').toUpperCase() === heldTick);
        return balance ? exactTokenMaxAmount(balance.amount) : null;
    }, [previewBalances.sdkShape]);
    const startAddRecipient = useCallback(() => {
        // A new row starts on the asset the last one used.
        const lastTick = multiRecipients.length > 0 ? multiRecipients[multiRecipients.length - 1].tick : '';
        setMultiAddDraft({ editingId: null, to: '', tick: lastTick, amount: '', errors: {} });
    }, [multiRecipients]);
    const toggleEditRecipient = useCallback((id) => {
        const row = multiRecipients.find((item) => item.id === id);
        if (!row) return;
        setMultiDraft((current) => (current?.editingId === id
            ? null
            : { editingId: id, to: row.to, tick: row.tick, amount: row.amount, errors: {} }));
    }, [multiRecipients]);
    const changeMultiDraft = useCallback((patch) => {
        setMultiDraft((current) => {
            if (!current) return current;
            const errors = { ...(current.errors || {}) };
            for (const key of Object.keys(patch)) delete errors[key];
            return { ...current, ...patch, errors };
        });
    }, []);
    const changeMultiAddDraft = useCallback((patch) => {
        setMultiAddDraft((current) => {
            if (!current) return current;
            const errors = { ...(current.errors || {}) };
            for (const key of Object.keys(patch)) delete errors[key];
            return { ...current, ...patch, errors };
        });
    }, []);
    const commitMultiDraft = useCallback(() => {
        if (!multiDraft) return;
        const errors = validateRecipient(multiDraft, recipientRules);
        if (Object.keys(errors).length > 0) {
            setMultiDraft({ ...multiDraft, errors });
            return;
        }
        setMultiRecipients((list) => updateMultiRecipient(list, multiDraft.editingId, multiDraft));
        multiListEditedRef.current = true;
        setMultiDraft(null);
        clearListEntries();
    }, [multiDraft, recipientRules, clearListEntries]);
    const commitMultiAddDraft = useCallback(() => {
        if (!multiAddDraft) return;
        const errors = validateRecipient(multiAddDraft, recipientRules);
        if (Object.keys(errors).length > 0) {
            setMultiAddDraft({ ...multiAddDraft, errors });
            return;
        }
        setMultiRecipients((list) => addMultiRecipient(list, multiAddDraft));
        multiListEditedRef.current = true;
        setMultiAddDraft(null);
        clearListEntries();
    }, [multiAddDraft, recipientRules, clearListEntries]);
    const removeMultiRow = useCallback((id) => {
        setMultiRecipients((list) => removeMultiRecipient(list, id));
        multiListEditedRef.current = true;
        setMultiDraft((current) => (current?.editingId === id ? null : current));
        clearListEntries();
    }, [clearListEntries]);

    const changeAdvancedText = useCallback((text) => {
        setAdvancedText(text);
        setAdvancedChecked(false);
        setAdvancedFileError(null);
        multiListEditedRef.current = false;
        clearListEntries();
    }, [clearListEntries]);
    const advancedFileTextRef = useRef('');
    // A file fills the box only when every line is a recipient; otherwise the
    // box keeps what it had and the file field names the bad lines.
    const loadAdvancedFile = useCallback(({ name, text }) => {
        const parsed = parseRecipientText(text, recipientRules);
        const label = name || 'The file';
        if (parsed.errors.length > 0) {
            setAdvancedFileName('');
            setAdvancedFileError(`${label} was not loaded: ${parsed.errors.length === 1 ? 'one line is' : `${parsed.errors.length} lines are`} not a recipient. `
                + parsed.errors.map((entry) => entry.message).join(' '));
            return;
        }
        if (parsed.recipients.length === 0) {
            setAdvancedFileName('');
            setAdvancedFileError(`${label} has no recipient lines.`);
            return;
        }
        const content = withoutByteOrderMark(String(text)).replace(/\r\n?/g, '\n').trim();
        advancedFileTextRef.current = content;
        setAdvancedText(content);
        setAdvancedFileName(name || 'CSV file');
        setAdvancedFileError(null);
        setAdvancedChecked(false);
        multiListEditedRef.current = false;
        clearListEntries();
    }, [recipientRules, clearListEntries]);
    const clearAdvancedFile = useCallback(() => {
        // The file's lines leave the box only while it still holds them unedited.
        if (advancedText === advancedFileTextRef.current) setAdvancedText('');
        advancedFileTextRef.current = '';
        setAdvancedFileName('');
        setAdvancedFileError(null);
    }, [advancedText]);
    const advancedLineErrors = advancedChecked && advancedParsed.errors.length > 0
        ? advancedParsed.errors.map((entry) => entry.message).join(' ')
        : null;
    // The count as the lines are typed, or why they cannot go as one
    // transaction (the limit, the size, the balance) before review.
    const advancedNoteWarns = sendMode === 'advanced' && Boolean(recipientFitError || amountBalanceError);
    const advancedNote = sendMode !== 'advanced'
        ? null
        : (recipientFitError
            || amountBalanceError
            || (advancedParsed.recipients.length > 0
                ? `${advancedParsed.recipients.length} of ${MAX_MULTI_RECIPIENTS} recipients: ${recipientTotalsText(advancedParsed.recipients).join(' + ')}.`
                : null));

    const [otherAddressHasTick, setOtherAddressHasTick] = useState(
        /** @type {boolean | null} */ (null),
    );
    useEffect(() => {
        const tickUpper = tick.trim().toUpperCase();
        if (!chainId || !fromAddress || !addressesByChain || !tickUpper
            || previewBalances.loading || previewBalances.error || !previewBalances.sdkShape) {
            setOtherAddressHasTick(null);
            return undefined;
        }
        if (sourceBalance) {
            const held = compareDecimalStrings(String(sourceBalance.amount || '0'), '0');
            if (held === null || held > 0) {
                setOtherAddressHasTick(null);
                return undefined;
            }
        }

        const others = (addressesByChain[chainId] || [])
            .filter((address) => address.address !== fromAddress.address);
        if (others.length === 0) {
            setOtherAddressHasTick(false);
            return undefined;
        }

        let cancelled = false;
        setOtherAddressHasTick(null);
        if (isDemo) {
            const demoRows = flowsLib.synthesizeDemoBalances(addressesByChain)[chainId] || [];
            const hasTick = demoRows.some((entry) => {
                if (entry.address === fromAddress.address) return false;
                const balance = decoderLib.balancesFromSdk(entry.balances)
                    .find((row) => String(row.tick || '').toUpperCase() === tickUpper);
                return compareDecimalStrings(String(balance?.amount || '0'), '0') === 1;
            });
            setOtherAddressHasTick(hasTick);
            return undefined;
        }
        Promise.all(others.map((address) =>
            messaging.getAddressBalances(chainId, address.address)))
            .then((balancesByAddress) => {
                if (cancelled) return;
                const hasTick = balancesByAddress.some((sdkShape) => {
                    const balance = decoderLib.balancesFromSdk(sdkShape)
                        .find((row) => String(row.tick || '').toUpperCase() === tickUpper);
                    if (!balance) return false;
                    const held = compareDecimalStrings(String(balance.amount || '0'), '0');
                    return held !== null && held > 0;
                });
                setOtherAddressHasTick(hasTick);
            })
            .catch(() => {
                if (!cancelled) setOtherAddressHasTick(null);
            });
        return () => { cancelled = true; };
    }, [chainId, fromAddress, addressesByChain, tick, previewBalances, sourceBalance, messaging, isDemo]);

    // The asset picker is wallet-scoped, the funding is address-scoped, and this
    // is where they disagree. A WARNING rather than a refusal, deliberately: the only
    // evidence is a balance read, and a lagging or failed one must never be able to block
    // a send the address can genuinely pay for. Both of those states are excluded here, so
    // this fires only when the balances came back clean and this address holds none of the
    // selected token.
    // The balance read can come back with the half this send spends from marked
    // unavailable; then its amount is unknown, not zero.
    const sourceHalfUnavailable = Array.isArray(previewBalances.sdkShape?.unavailable)
        && previewBalances.sdkShape.unavailable.includes(isNativeSend ? 'native' : 'tokens');
    const sourcePendingUnknown = isNativeSend && !sourceHalfUnavailable
        && previewBalances.sdkShape?.native?.pendingUnknown === true;
    const sourceLacksTick = useMemo(() => {
        if (previewBalances.loading || previewBalances.error || !previewBalances.sdkShape || sourceHalfUnavailable) return null;
        const tickUpper = tick.trim().toUpperCase();
        // A native coin always comes back as a row, holding "0" when empty, so a
        // zero amount counts as none too (an empty BTC address on a phone showed
        // "0 BTC available" and no warning until the encoder refused the send).
        if (!tickUpper) return null;
        if (sourceBalance) {
            const held = compareDecimalStrings(String(sourceBalance.amount || '0'), '0');
            if (held === null || held > 0) return null;
        }
        if (otherAddressHasTick === false) {
            return 'This wallet has no funds to send yet. Open Receive to add funds first.';
        }
        return `This address holds no ${tickUpper}. A send spends from one address, not from the `
            + 'whole wallet, so pick the address that holds it in the From field above.';
    }, [previewBalances, sourceBalance, tick, otherAddressHasTick, sourceHalfUnavailable]);

    /**
     * The amount to fill in for "send everything", priced by the encoder that
     * will build the transaction.
     *
     * WHY THIS IS NOT ARITHMETIC ON `feeEstimate`. That estimate is a static
     * assumed vsize (250 vB) times the tier rate; the fee the transaction pays
     * is the encoder's size for the transaction it actually builds. Measured on
     * BTC regtest: the estimate said 1500, the transaction paid 924, and the
     * 576-sat difference stayed at the address the user was told they had
     * emptied. See flows/maxSendable.js for how the exact number is obtained.
     *
     * Returns null when the quote cannot be had - no host support, no valid
     * destination to size the payment output against, an encoder that did not
     * answer - and the caller falls back to the static estimate, which is the
     * behaviour that shipped. Over-estimating strands satoshis; under-estimating
     * would make Max unbuildable, so a doubtful quote is no quote.
     */
    const quoteMaxSats = useCallback(async () => {
        if (!isNativeSend || !chainId || !fromAddress) return null;
        if (typeof messaging.quoteMaxSendable !== 'function') return null; // older host build
        // The destination's script type is part of the price, so there has to be
        // one. Before it is filled the static estimate stands, exactly as before.
        const to = toAddress.trim();
        if (!to || destinationAddressError(to, descriptor)) return null;
        try {
            const quote = await messaging.quoteMaxSendable({
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
                to,
                rbf: rbfForSend,
                ...(changeAddress ? { change: changeAddress.address } : {}),
                ...(coinControlEnabled ? { utxos: selectedUtxos } : {}),
                ...(feePerKb != null ? { feePerKb } : {}),
            });
            if (!quote || typeof quote.maxSats !== 'string') return null;
            const sats = BigInt(quote.maxSats);
            return sats >= 0n ? { ...quote, maxSats: sats } : null;
        } catch {
            // A quote is an optimisation, never a gate: a failed one must not be
            // able to stop the user filling the field.
            return null;
        }
    }, [
        isNativeSend, chainId, fromAddress, toAddress, descriptor, walletId, rbfForSend,
        changeAddress, coinControlEnabled, selectedUtxos, feePerKb,
    ]);

    const applyMax = useCallback(async () => {
        if (!sourceBalance || !sourceBalance.amount) return;
        const requestId = maxRequestRef.current + 1;
        maxRequestRef.current = requestId;
        setMaxBusy(true);
        let display;
        let note;
        if (isNativeSend) {
            // Exact string/BigInt math: this string is what gets signed, and a
            // parseFloat round-trip on a large (>~90M-sat DOGE) balance drifts
            // by whole sats, leaving dust behind or overshooting the balance.
            const balanceSats = exactSatsBigIntFromDecimalString(sourceBalance.amount, descriptor);
            if (balanceSats == null || balanceSats <= 0n) {
                // The available line leaves out coins other sends hold, so a
                // zero here can mean those sends hold every coin; the quote
                // says which, and the note names that reason.
                const heldQuote = balanceSats == null ? null : await quoteMaxSats().catch(() => null);
                if (!mountedRef.current || requestId !== maxRequestRef.current) return;
                setAmount('');
                setFiatAmount('');
                maxUtxosRef.current = null;
                setMaxUnavailable(true);
                setMaxNote(heldQuote?.coinsHeld
                    ? t('send.max.coinsHeld')
                    : 'There is no spendable balance, so Max cannot create a payment.');
                setMaxBusy(false);
                return;
            }
            let maxSats = balanceSats;
            const quoted = await quoteMaxSats();
            if (!mountedRef.current || requestId !== maxRequestRef.current) return;
            maxUtxosRef.current = Array.isArray(quoted?.utxos) ? quoted.utxos : null;
            let leftBehindSats = null;
            try {
                leftBehindSats = typeof quoted?.leftBehindSats === 'string'
                    ? BigInt(quoted.leftBehindSats)
                    : null;
            } catch {
                leftBehindSats = null;
            }
            if (quoted?.coinsHeld) {
                setAmount('');
                setFiatAmount('');
                setMaxUnavailable(true);
                setMaxNote(t('send.max.coinsHeld'));
                setMaxBusy(false);
                return;
            }
            if (quoted != null) {
                maxSats = quoted.maxSats;
            } else if (feeEstimate) {
                const feeSats = exactSatsBigIntFromDecimalString(feeEstimate.coinAmount, descriptor);
                if (feeSats != null) maxSats = balanceSats > feeSats ? balanceSats - feeSats : 0n;
            }
            const floor = BigInt(dustThresholdForCoin(descriptor?.coin) || 0);
            const tickerUpper = nativeTickerFor(descriptor) || tick.trim().toUpperCase();
            if (maxSats <= 0n || (floor > 0n && maxSats < floor)) {
                setAmount('');
                setFiatAmount('');
                setMaxUnavailable(true);
                setMaxNote(maxSats <= 0n
                    ? (leftBehindSats != null && leftBehindSats > 0n
                        ? t('send.max.uneconomicalInputs', {
                            amount: decimalStringFromSats(leftBehindSats, descriptor),
                            ticker: tickerUpper,
                        })
                        : 'The selected network fee uses the available balance, so Max cannot create a payment.')
                    : `The spendable balance after the selected network fee is below the ${decimalStringFromSats(floor, descriptor)} `
                        + `${tickerUpper} dust minimum, so Max cannot create a payment.`);
                setMaxBusy(false);
                return;
            }
            display = nativeDecimalsFor(descriptor) === 8
                ? decimalStringFromSats(maxSats)
                : decimalStringFromSats(maxSats, descriptor);
            note = leftBehindSats != null && leftBehindSats > 0n
                ? t('send.max.uneconomicalInputs', {
                    amount: decimalStringFromSats(leftBehindSats, descriptor),
                    ticker: tickerUpper,
                })
                : 'Max sends the spendable balance after the selected network fee. '
                    + 'A coin amount that costs more to spend than it is worth may remain at this address.';
        } else {
            // A TOKEN balance is not satoshi-denominated and pays no coin fee out of itself,
            // so it is swept verbatim at the tick's own divisibility. The 8-dp sats path
            // truncated anything finer.
            display = exactTokenMaxAmount(sourceBalance.amount);
            if (display == null) {
                setMaxBusy(false);
                return;
            }
            const nativeTicker = nativeTickerFor(descriptor) || 'native coin';
            const feeAmount = feeEstimate?.coinAmount;
            const nativeAmount = nativeSourceBalance?.amount;
            const feeSats = feeAmount ? exactSatsBigIntFromDecimalString(feeAmount) : null;
            const nativeSats = nativeAmount ? exactSatsBigIntFromDecimalString(nativeAmount) : null;
            if (feeSats != null && nativeSats != null && nativeSats < feeSats) {
                note = `Max sends the full ${tick.trim().toUpperCase()} balance without spending it on fees. `
                    + `This address has ${formatWithThousands(nativeAmount)} ${nativeTicker}, below the estimated ${formatWithThousands(feeAmount)} `
                    + `${nativeTicker} network fee.`;
            } else {
                note = `Max sends the full ${tick.trim().toUpperCase()} balance and keeps the native coin `
                    + `separate for the network fee${feeAmount ? ` (estimated ${formatWithThousands(feeAmount)} ${nativeTicker})` : ''}.`;
            }
        }
        if (requestId !== maxRequestRef.current) return;
        setMaxUnavailable(false);
        setAmount(display);
        setMaxNote(note);
        if (amountInputMode === 'fiat' && amountFiatRate) {
            const value = coinToFiatExact(display, amountFiatRate);
            setFiatAmount(value != null ? roundDecimalString(value, 2) : '');
        }
        if (requestId === maxRequestRef.current) setMaxBusy(false);
    }, [
        sourceBalance, isNativeSend, quoteMaxSats, feeEstimate, descriptor, tick,
        nativeSourceBalance, amountInputMode, amountFiatRate,
    ]);

    const maxContext = [
        chainId || '', fromAddress?.address || '', toAddress.trim(), tick.trim().toUpperCase(),
        feePerKb ?? 'default', rbfForSend ? 'rbf' : 'final', changeAddress?.address || '',
        coinControlEnabled ? [...advancedEntry.selectedKeys].sort().join(',') : 'all',
    ].join('|');

    const onMax = useCallback(() => {
        if (maxBusy) return;
        setMaxActive(true);
        maxContextRef.current = maxContext;
        applyMax();
    }, [maxBusy, maxContext, applyMax]);

    useEffect(() => {
        if (!maxActive || maxContextRef.current === maxContext) return;
        maxContextRef.current = maxContext;
        applyMax();
    }, [maxActive, maxContext, applyMax]);

    function handleReview(event) {
        event.preventDefault();
        // A demo wallet never composes; the press answers with the refusal.
        if (isDemo) { setDemoRefused(true); return; }
        // G130: Send is never disabled. Offline, the tap brings the form's
        // offline notice into view and focuses it (one notice, never two); a
        // Max that found nothing to send names it on the amount.
        if (networkOffline) {
            if (!revealFormStatus(event.currentTarget)) form.validate({ 'form:offline': t('send.offline.bodyNoCache') });
            return;
        }
        if (maxUnavailable) {
            form.validate({ 'send-amount': maxNote || t('send.max.nothingToSend') });
            return;
        }
        setValidationAttempt((attempt) => attempt + 1);
        // Every check runs, one message per field (the first failing rule), so the notice at
        // the top lists every problem at once. Keys are field ids; 'form:' keys have no field.
        const problems = {};
        if (!chainId || !fromAddress) {
            problems['send-from'] = 'Choose the address to send from.';
        }
        const listFieldId = sendMode === 'advanced' ? 'send-advanced-text' : 'send-multi-list';
        const multiRowProblems = sendMode === 'multi'
            ? multiRecipients.flatMap((row, index) => {
                const rowErrors = validateRecipient(row, recipientRules);
                const first = rowErrors.to || rowErrors.tick || rowErrors.amount;
                return first ? [`Recipient ${index + 1}: ${first}`] : [];
            })
            : [];
        if (sendMode === 'single') {
            const addressError = toAddress.trim() ? destinationAddressError(toAddress, descriptor) : null;
            if (!toAddress.trim()) {
                problems['send-destination'] = 'Enter a recipient address.';
            } else if (addressError) {
                setToError(addressError);
                problems['send-destination'] = addressError;
            }
            if (!tick.trim()) {
                problems['send-token'] = 'Choose a token.';
            }
            const amt = String(amount).trim();
            // The field refuses typed digits past the asset's decimal places, but a payment link
            // fills it directly; compose keeps only the places the asset has, so the payment
            // would carry less than the field shows.
            const amountDecimalLimit = sourceBalance?.divisibility
                ?? (isNativeSend ? nativeDecimalsFor(descriptor) : null);
            if (!isPositiveDecimalAmount(amt)) {
                problems['send-amount'] = 'Amount must be a positive number.';
            } else if (Number.isInteger(amountDecimalLimit)
                && (amt.split('.')[1] || '').length > amountDecimalLimit) {
                problems['send-amount'] = `Amount can have at most ${amountDecimalLimit} decimal places.`;
            } else if (isNativeSend) {
                // A native amount past 2^53 base units cannot be carried as a safe integer, so compose
                // would drop it and the tamper check would report an output the user never approved.
                const sats = exactSatsBigIntFromDecimalString(amt, descriptor);
                if (sats !== null && sats > BigInt(Number.MAX_SAFE_INTEGER)) {
                    problems['send-amount'] = 'Amount is too large to send.';
                }
            }
            if (!problems['send-amount'] && amountBalanceError) problems['send-amount'] = amountBalanceError;
        } else if (sendMode === 'advanced' && advancedParsed.errors.length > 0) {
            // Each bad line is its own entry in the notice; the box carries the
            // first entry's red outline and lists every line under it.
            setAdvancedChecked(true);
            advancedParsed.errors.forEach((entry, index) => {
                problems[index === 0 ? listFieldId : `form:advanced-line-${entry.line}`] = entry.message;
            });
        } else if (sendMode === 'multi' && (multiAddDraft || multiDraft)) {
            if (multiAddDraft) problems[listFieldId] = 'Add or cancel the recipient you started.';
            if (multiDraft) {
                problems[multiAddDraft ? 'form:multi-edit-draft' : listFieldId]
                    = 'Update or collapse the recipient you are editing.';
            }
        } else if ((activeRecipients || []).length === 0) {
            problems[listFieldId] = sendMode === 'advanced'
                ? 'Enter at least one recipient line: address, asset, amount.'
                : 'Add at least one recipient.';
        } else if (sendMode === 'multi' && multiRowProblems.length > 0) {
            // A row is checked again here with what is known now: one added
            // before the balances loaded, one restored from a draft, or one
            // left from another From address can fail a rule it skipped.
            multiRowProblems.forEach((message, index) => {
                problems[index === 0 ? listFieldId : `form:multi-row-${index}`] = message;
            });
        } else if (recipientFitError) {
            problems[listFieldId] = recipientFitError;
        } else if (amountBalanceError) {
            // Every row passed its own checks; what is left is the list as a
            // whole against the balance.
            problems[listFieldId] = amountBalanceError;
        } else if (!legsMatchList(activeRecipients)) {
            // Something wrote the hidden first-recipient fields behind the
            // list: put the list back and say so, never compose the drift.
            projectRecipients(activeRecipients);
            problems[listFieldId] = 'The recipients were refreshed. Check them and press Send again.';
        }
        const feeStop = problems['send-amount'] || problems['send-token']
            || (sendMode !== 'single' && problems[listFieldId])
            ? null
            : customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeEstimate });
        // A stop with no message is one the Fees field already shows itself; it still holds Review.
        if (feeStop?.formError) problems['form:fee'] = feeStop.formError;
        // Refuse a below-dust amount BEFORE composing. Enter also submits this
        // form, so the inline warning alone would not be enough (same reasoning as the
        // test-send gate below). Only Single can send the coin.
        if (sendMode === 'single' && !problems['send-amount'] && dustBlock) problems['send-amount'] = dustBlock;
        if (/[|;]/.test(memo)) {
            problems['send-memo'] = t('send.memoForbiddenChars');
        } else if (memoTooLong) {
            problems['send-memo'] = memoTooLong;
        }
        if (coinControlEnabled && selectedUtxos.length === 0) {
            problems['form:inputs'] = 'Choose at least one payment input.';
        }
        // PC-52: the extra recipients come only from Multi and Advanced, whose
        // rows passed the same address, asset and amount checks the first
        // recipient gets when they were added or read. The coin never reaches
        // a list; this refusal stays as the guard behind that rule.
        if (nativeMultiSendBlock) problems['form:multisend'] = nativeMultiSendBlock;
        // PC-26: no unlock key held for a gated tick = the network would
        // reject the send anyway; stop it here with the recovery path
        // visible instead of surfacing a compose error later.
        if (gatedInfo?.state === 'blocked') {
            problems['form:gated'] = `${tick.trim().toUpperCase()} includes protected content, but this wallet has none of its unlock keys. `
                + 'Recover the keys below before sending.';
        }
        if (gatedMultiSendBlock) problems['form:gatedMultisend'] = gatedMultiSendBlock;
        // §21.4: an un-acknowledged test-send warning stops the send here.
        // Send is never disabled (G130), and a form submits on Enter too; the
        // whole value of this gate is that it cannot be walked past by accident.
        // It judges a payment that is otherwise valid, so it speaks last.
        if (testSendGate && Object.keys(problems).length === 0) {
            problems['form:testSend'] = 'This is your first payment to this address. Send a small test first, '
                + 'or choose "Continue with the full amount" above.';
        }
        if (!form.validate(problems) || feeStop) return;
        // slice 1: with the flag on, sends go straight to the
        // single-encode confirm modal instead of the legacy review stage.
        // brought hardware in with them; watcher still branches.
        if (!isWatcherMode) {
            void openConfirmModal();
            return;
        }
        setStage('review');
    }

    const isHwSource = isDeviceAddressSource(fromAddress?.source);
    const hasNovelSendRecipient = useMemo(() => {
        const desc = chainId ? chainRegistry.get(chainId) : null;
        if (!isHwSource || !desc?.coin) return false;
        const sendLegs = [{ to: toAddress }, ...extraLegs.map((leg) => ({ to: leg.to }))];
        const recipientNovel = sendLegs.some((leg) => leg.to.trim() && checkRecipientNovelty({
            address: leg.to,
            chainCoin: desc.coin,
            contacts,
            historyRows,
        }).novel === true);
        return recipientNovel;
    }, [isHwSource, toAddress, extraLegs, chainId, contacts, historyRows]);
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState(/** @type {string} */ ('idle'));
    const onHwStatusChange = useCallback(({ status }) => {
        setHwStatus(status);
    }, []);

    // §18.5 / Cluster N FOLLOWUP 3: risk classifier drives the explicit
    // cross-check confirm checkbox on HW signs. Re-runs whenever the
    // risk inputs change (signer, amount, recipient, settings). HW path
    // only; software signers never render the cross-check block.
    const [hwExplicitConfirmed, setHwExplicitConfirmed] = useState(false);
    const signRisk = useMemo(() => {
        if (!isHwSource) return { requireExplicitConfirm: false, reason: null };
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const nativeTicker = nativeTickerFor(desc);
        const sats = exactSatsBigIntFromDecimalString(amount, desc);
        const isNativeSend = !!nativeTicker
            && tick.trim().toUpperCase() === nativeTicker
            && sats !== null && sats > 0n;
        const amountSats = isNativeSend ? sats : 0n;
        return classifySignRisk({
            signerKind: fromAddress?.source,
            amountSats,
            recipientNovel: hasNovelSendRecipient,
            multisig: false, // Send.jsx is single-sig; multisig flow is separate.
            settings: {
                // The fiat threshold in this send's base units; 0 (no
                // large-amount band) when it is Off or there is no price.
                testSendThresholdSats: String(testSendThresholdUnits ?? 0n),
                alwaysRequireHwExplicitConfirm: settings?.privacy?.alwaysRequireHwExplicitConfirm === true,
            },
        });
    }, [isHwSource, fromAddress?.source, chainId, tick, amount, hasNovelSendRecipient, settings, testSendThresholdUnits]);
    // Reset the confirm state whenever the requirement flips on, so a
    // user can't carry a stale "yes" through a recipient/amount change.
    // Editing ANY recipient row counts as that change (PC-52).
    useEffect(() => {
        setHwExplicitConfirmed(false);
    }, [signRisk.requireExplicitConfirm, fromAddress?.address, sendLegs, amount]);

    // slice 1: the single-encode confirm-modal path. The modal is
    // rendered only while the pipeline is live (preflighting..rechecking);
    // on a terminal phase this component's own state takes over (done
    // screen on success, form error on failure), so the modal cleanly
    // unmounts. Phases where the modal is shown:
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);

    // Open the single-encode confirm modal for a software send. compose +
    // tamper-check + pre-flight all run HOST-side (composeForConfirm /
    // preflight over messaging); Approve signs the byte-identical prebuilt
    // PSBT via sendToken.prebuiltPsbt. Resolves with sendToken's result.
    const openConfirmModal = useCallback(async () => {
        if (!chainId || !fromAddress || confirmLaunchRef.current) return;
        confirmLaunchRef.current = true;
        try {
            const from = {
                address: fromAddress.address,
                publicKey: fromAddress.publicKey,
                derivationPath: fromAddress.derivationPath,
                addressId: fromAddress.id,
                source: fromAddress.source,
                signerId: fromAddress.signerId,
            };
            const sendBase = {
                walletId,
                ...(accountId ? { accountId } : {}),
                chainId,
                from,
                to: toAddress.trim(),
                tick: tick.trim(),
                amount: String(amount).trim(),
                memo: isNativeSend ? undefined : (memo.trim() || undefined),
                rbf: rbfForSend,
                ...(changeAddress ? { change: changeAddress.address } : {}),
                ...(maxActive && Array.isArray(maxUtxosRef.current)
                    ? { utxos: maxUtxosRef.current }
                    : (coinControlEnabled ? { utxos: selectedUtxos } : {})),
                ...(feePerKb != null ? { feePerKb } : {}),
                // PC-52: `legs` supersedes to/tick/amount host-side. Sent only for a
                // real multi-recipient send so a single send composes the identical
                // v0 bytes it always has.
                ...(isMultiSend ? { legs: sendLegs } : {}),
                ...(createUndoSendRequest(settings) || {}),
            };
            confirmSendSnapshotRef.current = createSendConfirmSnapshot({
                sendBase,
                sendTotals,
                isMultiSend,
                isNativeSend,
                coinControlEnabled,
                coinControlLabel,
                feeEstimateAmount: feeEstimate?.coinAmount,
            });
            setSubmitError(null);
            setSubmitErrorCause(null);
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: {
                    mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
                },
                // §4.7 two-window race: reserve this amount at Approve on the
                // host-shared ledger; a concurrent window's preflight nets it.
                // The ledger lives host-side (messaging), release on any terminal.
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // §4.7: reserve what this send actually spends of the primary
                // token, which for a multi-recipient send is the SUM of its
                // legs, not the first row's amount. Legs on OTHER ticks are not
                // reserved: the ledger descriptor carries one tick, so a
                // multi-tick send under-reserves the secondary ticks (recorded
                // as a PC-52 residual rather than silently mis-reserving).
                reserve: {
                    tick: tick.trim(),
                    amount: sendTotals.find((t) => t.tick === tick.trim().toUpperCase())?.amount
                        || String(amount).trim(),
                },
                compose: () => messaging.composeForConfirm(sendBase),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // §4.6: the input-liveness half of the Approve-time re-check.
                // A send left on the confirm page past a competing spend used
                // to sign a PSBT whose coins were already gone and find out at
                // broadcast, in the permanent terminal §5.3.4 forbids
                // re-signing out of.
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
                releaseEncoderInputs: (token) => messaging.releaseEncoderInputs({ token }),
                // And the native-fee half, for the sends that carry a
                // protocol fee (a gated tick composes as BATCH, and a
                // multi-recipient send is priced per leg).
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                // The HW route runs the SAME send flow with a remote
                // signer, so it signs the prebuilt PSBT byte-identically.
                onApprove: (_creds, composed) => {
                    // Approve is the point of no return: the payment lives in the
                    // pending-activity record, not in the form draft. A draft left behind
                    // would tell a user who locked or reloaded mid-send that nothing was
                    // sent and offer to restore and send it a second time.
                    draftDiscardedRef.current = true;
                    draft.clear();
                    holdIncomingLinks();
                    // The shared mapping: a multi-recipient send takes the chunk
                    // lane, so its deferred outputs and any envelope must ride along.
                    const prebuiltPsbt = prebuiltPsbtFromComposed(composed);
                    const holding = Boolean(sendBase.holdId && sendBase.undoSeconds);
                    const attempt = holding ? { ...sendBase, holdId: createUndoHoldId() } : sendBase;
                    if (holding) {
                        undoHoldIdRef.current = attempt.holdId;
                        setUndoHoldActive(true);
                        startUndoSend(sendBase.undoSeconds);
                    }
                    const dispatched = isHwSource
                        ? messaging.sendAssetHw({
                            ...attempt, signerId: fromAddress.signerId, prebuiltPsbt,
                        })
                        : messaging.sendToken({
                            ...attempt, password: passwordValueRef.current, prebuiltPsbt,
                        });
                    // A rejected attempt (wrong password, device retry) leaves the confirm
                    // open for another Approve. Its countdown ends here, or the retry
                    // would start a second one while the first still counts.
                    return holding
                        ? Promise.resolve(dispatched).catch((err) => {
                            if (!isUndoSendCancellation(err)) {
                                resetUndoSend();
                                clearUndoHold();
                            }
                            throw err;
                        })
                        : dispatched;
                },
            });
            recordLastUsedChain(messaging, chainId);
            draft.clear();
            if (!mountedRef.current) {
                reportUndoHandoffOutcome('sent');
                return;
            }
            setStage('done');
            haptic.success();
            setResult(res);
            clearUndoHold();
            setPassword('');
            setDraftPending(false);
        } catch (err) {
            if (!mountedRef.current) {
                reportUndoHandoffOutcome(isUndoSendCancellation(err) ? 'cancelled' : 'failed');
                return;
            }
            // A send that stays on this form resumes saving the next edit.
            draftDiscardedRef.current = false;
            if (isUndoSendCancellation(err)) {
                clearUndoHold();
                form.reset();
                setPassword('');
                setStage('form');
                showToast({ message: 'Transaction cancelled.' });
                return;
            }
            // Rejection returns to the intact draft without carrying a signing
            // credential into the next review.
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) {
                setPassword('');
                return;
            }
            // A freeze the user armed is stated by the notice at the top of
            // the form; a second, generic "try again" line under it would
            // contradict it.
            if (panicRefusalMessage(err)) {
                setSubmitError(null);
                setSubmitErrorCause(null);
                setPanicNoticeKey((k) => k + 1);
                haptic.error();
                return;
            }
            // Everything else (compose/tamper failure, bad password, broadcast
            // failure) surfaces in the form's existing error banner; the modal
            // has already unmounted (terminal phase leaves CONFIRM_MODAL_PHASES).
            console.error('Send (confirm) failed:', err); // eslint-disable-line no-console
            const fieldError = isMultiSend ? null : encoderFieldError(err, {
                coinTicker: nativeTickerFor(chainId ? chainRegistry.get(chainId) : null) || '',
                feeUnit: feeTiers?.unit,
            });
            if (fieldError) {
                setSubmitFieldError(fieldError);
                setSubmitError(null);
                setSubmitErrorCause(null);
            } else {
                setSubmitError(sendFailureCopy(err, {
                    verb: 'send',
                    coinTicker: nativeTickerFor(chainId ? chainRegistry.get(chainId) : null) || undefined,
                }));
            }
            haptic.error();
        } finally {
            confirmLaunchRef.current = false;
        }
    }, [
        chainId, fromAddress, walletId, toAddress, tick, amount, memo, rbfForSend,
        feePerKb, settings, messaging, confirmAction, draft, haptic,
        isNativeSend, isHwSource, isMultiSend, sendLegs, sendTotals, startUndoSend,
        clearUndoHold, resetUndoSend, reportUndoHandoffOutcome, showToast, changeAddress, coinControlEnabled, selectedUtxos, maxActive,
        feeTiers, feeEstimate?.coinAmount, coinControlLabel,
    ]);

    // Why the review's Approve cannot send yet, or null. Approve never looks
    // disabled (G130): a tap that cannot go ahead says why at the top of the
    // review (G129) and sends nothing.
    function sendReviewBlock() {
        if (networkOffline) return { cause: 'offline', text: t('confirmStandard.blocked.offline') };
        if (testSendGate) return { cause: 'test_send', text: t('confirmStandard.blocked.testSend') };
        if (isWatcherMode) return null;
        if (isHwSource) {
            if (hwStatus !== 'available') return { cause: 'device', text: t('confirmStandard.blocked.device') };
            // Cluster N FOLLOWUP 3: the risk classifier demands an explicit
            // cross-check confirm and the user hasn't ticked the box.
            if (signRisk.requireExplicitConfirm && !hwExplicitConfirmed) {
                return { cause: 'device_confirm', text: t('confirmStandard.blocked.deviceConfirm') };
            }
            return null;
        }
        if (!signerReady && password.length === 0) return { cause: 'password_required', text: t('confirmStandard.blocked.password') };
        return null;
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submitInFlightRef.current) return;
        const blocked = sendReviewBlock();
        if (blocked) {
            setSubmitError(blocked.text);
            setSubmitErrorCause(blocked.cause);
            const reviewForm = document.getElementById('send-review-form');
            const scroller = reviewForm?.closest('main');
            if (scroller) scroller.scrollTop = 0;
            if (blocked.cause === 'password_required') passwordRef.current?.focus?.({ preventScroll: true });
            return;
        }
        submitInFlightRef.current = true;
        holdIncomingLinks();
        setStage('submitting');
        setSubmitError(null);
        setSubmitErrorCause(null);
        try {
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
                to: toAddress.trim(),
                tick: tick.trim(),
                amount: String(amount).trim(),
                memo: isNativeSend ? undefined : (memo.trim() || undefined),
                rbf: rbfForSend,
                ...(changeAddress ? { change: changeAddress.address } : {}),
                ...(maxActive && Array.isArray(maxUtxosRef.current)
                    ? { utxos: maxUtxosRef.current }
                    : (coinControlEnabled ? { utxos: selectedUtxos } : {})),
                ...(feePerKb != null ? { feePerKb } : {}),
                // PC-52: multi-recipient legs, on the watcher and HW paths too
                // (buildSendPsbt and the HW send handler take the same shape).
                ...(isMultiSend ? { legs: sendLegs } : {}),
                ...(!isWatcherMode ? (createUndoSendRequest(settings) || {}) : {}),
            };
            // §20 / G040: watcher mode encodes only. No password, no signer,
            // no broadcast. The result envelope carries `psbtHex` instead of
            // a `txid` and the done stage branches on that to render the
            // PSBT-export UI.
            // Software path: send password; background unlocks + signs.
            // HW path: bypass password; background routes the sign
            // request through the signer-bridge RPC to the renderer-
            // hosted Trezor/Ledger signer identified by `signerId`.
            let res;
            if (isWatcherMode) {
                res = await messaging.buildSendPsbtRequest(base);
            } else if (isHwSource) {
                res = await messaging.sendAssetHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.sendToken({ ...base, password });
            }
            recordLastUsedChain(messaging, chainId);
            draft.clear();
            if (!mountedRef.current) return;
            setStage('done');
            haptic.success();
            setResult(res);
            setPassword('');
            setDraftPending(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            const rawMsg = err?.message || '';
            const isUserCancel = !isBadPassword && USER_CANCEL_RE.test(rawMsg);
            if (!mountedRef.current) return;
            // Back on the hardware sign page returns to the review, not the form.
            if (isHwSignBack(err)) {
                setSubmitError(null);
                setSubmitErrorCause(null);
                setStage('review');
                return;
            }
            if (isUserCancel) {
                // §30.5: user-initiated cancel returns to the composing
                // form with a dismissible "Transaction cancelled." toast.
                // Form values stay intact so the user can edit and retry.
                setSubmitError(null);
                setSubmitErrorCause(null);
                setPassword('');
                setStage('form');
                showToast({ message: 'Transaction cancelled.' });
                return;
            }
            if (panicRefusalMessage(err)) {
                setSubmitError(null);
                setSubmitErrorCause(null);
                setPanicNoticeKey((k) => k + 1);
                setPassword('');
                setStage('form');
                haptic.error();
                return;
            }
            if (isBadPassword) {
                setSubmitError('Incorrect password.');
                setSubmitErrorCause(null);
            } else {
                console.error('Send failed:', err); // eslint-disable-line no-console
                const coinTicker = nativeTickerFor(chainId ? chainRegistry.get(chainId) : null) || '';
                const fieldError = isMultiSend ? null : encoderFieldError(err, {
                    coinTicker, feeUnit: feeTiers?.unit,
                });
                if (fieldError) {
                    setSubmitFieldError(fieldError);
                    setSubmitError(null);
                    setSubmitErrorCause(null);
                    setPassword('');
                    setStage('form');
                    haptic.error();
                    return;
                }
                const message = sendFailureCopy(err, { verb: 'send', coinTicker: coinTicker || undefined });
                setSubmitError(message);
                setSubmitErrorCause(humanizeError(err, 'send').cause);
            }
            setStage('review');
            haptic.error();
        } finally {
            submitInFlightRef.current = false;
        }
    }

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setPassword(''); setStage('form'); }
                : leaveGuard.guardedOnBack}
            backDisabled={stage === 'submitting'}
            // Back returns to whichever page opened Send (G06), so it names no page.
            backLabel={stage === 'review' ? t('send.backToEdit') : undefined}
            title={stage === 'review' || stage === 'submitting' ? t('common.confirm') : (title || t('send.title'))}
            titleRef={stage === 'review' ? reviewHeadingRef : undefined}
        />
    );

    const wrap = (children, footer = null) => (
        <Screen
            rootRef={reviewPageRef}
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
            {footer}
            {leaveGuard.confirmation}
            {demoExitConfirmOpen ? (
                <DemoExitConfirm
                    busy={demoExitBusy}
                    error={demoExitError}
                    onConfirm={handleExitDemo}
                    onCancel={() => { setDemoExitConfirmOpen(false); setDemoExitError(null); }}
                />
            ) : null}
        </Screen>
    );

    // §21.4 test-send banner.: this used to be inlined in the
    // `stage === 'review'` branch only, and then routed every
    // non-watcher send from the compose form straight into the confirm
    // modal - so the branch stopped rendering and the warning silently
    // stopped existing for the overwhelming majority of sends. It is a
    // shared const now and renders on the COMPOSE form, which is also
    // where it belongs: the whole point is to intervene before the user
    // commits, and it is the last screen every send path passes through.
    const testSendGateBanner = testSendGate ? (
        <StatusMessage variant="info" role="alert" title={t('send.testGate.title')}>
            <p className={styles.testSendBody}>
                {t('send.testGate.body', {
                    amount: decimalStringFromSats(BigInt(testSendGate.amountSats), descriptor),
                    ticker: testSendGate.ticker,
                })}
            </p>
            <div className={styles.testSendActions}>
                <Button
                    type="button"
                    variant="secondary"
                    icon={<Icon.ForwardIcon />}
                    onClick={() => markTested(toAddress.trim())}
                >
                    {t('send.testGate.continue')}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    icon={<Icon.SendIcon />}
                    onClick={onSendSmallTest}
                >
                    {t('send.testGate.sendSmall')}
                </Button>
            </div>
        </StatusMessage>
    ) : null;
    if (!walletModeReady) {
        return wrap(<ListPage><p className={styles.hint}>{t('common.loading')}</p></ListPage>);
    }

    // §20: an air-gapped signer wallet does not spend, so the form is
    // refused rather than rendered. The mode belongs to the wallet and is
    // fixed at create, import or pair, so the refusal points at Wallet
    // Details, where it is shown.
    if (isSignerMode) {
        return wrap(
            <ListPage>
                <StatusMessage variant="status">
                    {t('send.signerMode')}
                </StatusMessage>
            </ListPage>,
        );
    }
    if (networkSettingsOpen) {
        return (
            <Settings
                onBack={() => setNetworkSettingsOpen(false)}
                activeWallet={{ id: walletId }}
                initialSubpageId="network"
            />
        );
    }
    if (!hasAvailableChain({ settings }, chainRegistry)) {
        return wrap(
            <ListPage>
                <EmptyState
                    title={NO_CHAINS_TITLE}
                    body={NO_CHAINS_BODY}
                    actionLabel={t('common.openNetworkSettings')}
                    onAction={() => setNetworkSettingsOpen(true)}
                    actionIcon={<Icon.GearIcon />}
                />
            </ListPage>,
        );
    }
    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage
                    variant="error"
                    recovery={{
                        label: t('common.tryAgain'),
                        onAction: () => setAddressLoadAttempt((attempt) => attempt + 1),
                    }}
                >
                    {loadError}
                </StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(<ListPage><p className={styles.hint}>{t('common.loading')}</p></ListPage>);
    }
    // Switching chains after a first check keeps the form mounted (typed or
    // pasted values stay put) while the new chain is checked.
    const selectedChainBalanceStatus = chainBalanceState.chainId === chainId
        ? chainBalanceState.status
        : (chainBalanceState.chainId === null ? 'loading' : 'unknown');
    if (selectedChainBalanceStatus !== 'loading') balanceGateSettledRef.current = true;
    // Only the first balance check holds the form back. A later chain switch
    // (a pasted payment request, the asset picker) sets the new chain to
    // loading too, and the form must stay mounted through that as well.
    if (!isWatcherMode && selectedChainBalanceStatus === 'loading'
        && !balanceGateSettledRef.current && !balanceGateWaived) {
        return wrap(<ListPage><p className={styles.hint}>{t('common.loading')}</p></ListPage>);
    }
    if (!isWatcherMode && selectedChainBalanceStatus === 'empty' && balancesUnchecked) {
        // A zero read while balances could not be checked proves nothing, so
        // the page says that once instead of "Nothing to send yet" beside the
        // stale-balances notice.
        return wrap(
            <ListPage>
                <BalancesUncheckedState
                    onRetry={() => {
                        recheckReachability();
                        setBalanceRecheck((n) => n + 1);
                    }}
                    onReceive={onReceive}
                />
            </ListPage>,
        );
    }
    if (!isWatcherMode && selectedChainBalanceStatus === 'empty') {
        // The empty state is the page's whole content, so it sits in ListPage
        // at full content width rather than in a form card.
        return wrap(
            <ListPage>
                <EmptyState
                    plain
                    title={t('send.empty.title')}
                    body={t('send.empty.body')}
                    icon={<Icon.ReceiveIcon />}
                    actionLabel={onReceive ? t('home.receive') : undefined}
                    onAction={onReceive}
                    actionIcon={<Icon.ReceiveIcon />}
                />
            </ListPage>,
        );
    }

    // The confirm page renders in place of the form (an overlay modal did not
    // fit small viewports); all other form state stays intact behind it. It goes
    // through the SHARED <ActionConfirmScreen>, which owns the exact fee and deltas.
    if (confirmModalOpen) {
        // Transaction-defining copy comes from the same immutable snapshot
        // handed to compose, never from the draft that remains behind it.
        const snapshot = confirmSendSnapshotRef.current;
        const summaryChainId = snapshot?.chainId || chainId;
        const summaryDescriptor = chainRegistry.get(summaryChainId) || descriptor;
        const snapshotLegs = Array.isArray(snapshot?.legs) ? snapshot.legs : [];
        const snapshotTotals = Array.isArray(snapshot?.totals) ? snapshot.totals : [];
        const snapshotMulti = snapshot?.isMultiSend === true;
        const snapshotNative = snapshot?.isNativeSend === true;
        const sendTick = String(snapshot?.tick || '').trim().toUpperCase();
        const nativeTick = nativeTickerFor(summaryDescriptor) || '';
        const composedFeeSats = confirmAction.composed?.networkFeeSats;
        const sendFeeAmount = Number.isSafeInteger(composedFeeSats) && composedFeeSats >= 0
            ? decimalStringFromSats(BigInt(composedFeeSats), summaryDescriptor)
            : snapshot?.feeEstimateAmount;
        const sendAmount = String(snapshot?.amount || '').trim();
        // A hidden balance stays hidden here too. An unchecked one (the
        // network could not confirm it is current) is still the balance the
        // form shows, so it is the "before" this page shows.
        const showBalances = !balancesHidden && !snapshotMulti;
        const sendChanges = [];
        const nativeBefore = showBalances && nativeSourceBalance?.amount != null
            ? String(nativeSourceBalance.amount).trim()
            : '';
        if (showBalances && snapshotNative && nativeBefore && sendFeeAmount && sendAmount) {
            const nativeAfter = sumDecimalStrings([nativeBefore, `-${sendAmount}`, `-${sendFeeAmount}`]);
            sendChanges.push({
                label: t('components.confirmSummary.your', { tick: nativeTick }),
                before: formatDisplayAmount(nativeBefore),
                after: formatDisplayAmount(nativeAfter),
                tick: nativeTick,
            });
            const rateValue = Number(amountFiatRate?.rate);
            if (Number.isFinite(rateValue) && rateValue > 0) {
                const code = String(amountFiatRate?.fiatCurrency || fiatCurrency).toUpperCase();
                const fiatOf = (coin) => {
                    const value = Number(coinToFiatExact(coin, amountFiatRate));
                    return Number.isFinite(value) ? formatFiat(value, code) : null;
                };
                const valueBefore = fiatOf(nativeBefore);
                const valueAfter = fiatOf(nativeAfter);
                if (valueBefore && valueAfter) {
                    sendChanges.push({
                        label: t('home.tabs.value'),
                        before: valueBefore,
                        after: valueAfter,
                    });
                }
            }
        } else if (showBalances && !snapshotNative && sourceBalance?.amount != null && sendAmount) {
            const tokenBefore = String(sourceBalance.amount).trim();
            sendChanges.push({
                label: t('components.confirmSummary.your', { tick: sendTick }),
                before: formatDisplayAmount(tokenBefore),
                after: formatDisplayAmount(sumDecimalStrings([tokenBefore, `-${sendAmount}`])),
                tick: sendTick,
            });
            if (nativeBefore && sendFeeAmount) {
                sendChanges.push({
                    label: t('components.confirmSummary.your', { tick: nativeTick }),
                    before: formatDisplayAmount(nativeBefore),
                    after: formatDisplayAmount(sumDecimalStrings([nativeBefore, `-${sendFeeAmount}`])),
                    tick: nativeTick,
                });
            }
        }
        const sendSummary = {
            verb: t('send.title'),
            amount: snapshotMulti ? '' : sendAmount,
            // Several assets have no one icon to show.
            ticker: snapshotMulti && snapshotTotals.length > 1 ? '' : sendTick,
            chainId: summaryChainId,
            direction: 'out',
            address: snapshot?.fromAddress || undefined,
            recipient: snapshotMulti ? undefined : (String(snapshot?.to || '').trim() || undefined),
            // A multi-recipient send names its high-level count in the hero;
            // the facts card has one exact summary row per asset.
            ...(snapshotMulti ? {
                target: `${snapshotLegs.length} recipients`,
                recipients: snapshotLegs.map((leg) => ({ to: leg.to, tick: leg.tick.toUpperCase(), amount: leg.amount })),
                totals: recipientTotalsText(snapshotLegs),
            } : {}),
            changes: sendChanges,
            networkFee: snapshot?.feeEstimateAmount ? { amount: snapshot.feeEstimateAmount, ticker: nativeTick } : undefined,
            // The advanced choices the user made, as facts card rows (G127):
            // a default (automatic inputs, change back to the source, no fee
            // bumping) is not a detail that matters for this send. A decoded
            // Memo row, when the host sends one, wins over this one.
            facts: [
                ...(snapshot?.memo ? [{ label: t('send.memo'), value: snapshot.memo }] : []),
                ...(snapshot?.rbf ? [{ label: t('send.advanced.feeBumping'), value: t('send.advanced.allowed') }] : []),
                ...(snapshot?.coinControlEnabled ? [{ label: t('send.advanced.coinControl'), value: snapshot.coinControlLabel }] : []),
                ...(snapshot?.changeAddress ? [{ label: t('send.advanced.changeAddress'), value: snapshot.changeAddress, address: true }] : []),
            ],
        };
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                summary={sendSummary}
                formatNativeFee={formatConfirmFeeFiat}
                walletId={walletId}
                screenVariant={variant}
                chainLabel={summaryDescriptor?.displayName || summaryChainId}
                // Fallback only: the composed PSBT's exact fee wins (§5.2.5).
                feeText={snapshot?.feeEstimateAmount
                    ? t('send.networkFeeValue', {
                        amount: snapshot.feeEstimateAmount,
                        ticker: nativeTick,
                    }).trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device
                // block, and Approve additionally waits on the §18.5
                // cross-check when the risk classifier demands one. Dropping
                // that gate here would have quietly removed a control the
                // legacy review stage enforced.
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hwRequireExplicitConfirm={signRisk.requireExplicitConfirm}
                hwRequireExplicitConfirmReason={signRisk.reason}
                extraWarnings={[
                    ...unusualSendWarnings,
                    ...protocolDestinationWarnings,
                    ...(dispenserNotice?.warnings || []),
                ]}
                warningTestId={unusualSendWarnings.length > 0 || protocolDestinationWarnings.length > 0
                    ? 'send-unusual-warnings'
                    : undefined}
                extraCredentials={(
                    <>
                        {dispenserNoticeBlock}
                        <UndoSendToast
                            status={undoHoldActive ? undoSendStatus : 'idle'}
                            remaining={undoSendRemaining}
                            onCancel={cancelUndoSend}
                        />
                    </>
                )}
                onHwConfirmedChange={setHwExplicitConfirmed}
                hwExplicitConfirmed={hwExplicitConfirmed}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        const desc = chainId ? chainRegistry.get(chainId) : null;
        const explorerBase = desc?.explorer?.defaultUrl || '';
        const explorerUrl = txid && explorerBase
            ? explorerPageUrl({
                chainId,
                kind: 'transaction',
                value: txid,
                settings,
            })
            : null;
        const sentAmount = amount && tick ? `${formatWithThousands(amount) || amount} ${tick}` : null;
        const recipient = toAddress || null;
        const sendAnother = () => {
            cancelMax();
            setStage('form');
            setAmount('');
            setFiatAmount('');
            setToAddress('');
            // A new payment starts on Single with no list behind it, so no
            // sent recipient is carried into the next send.
            setExtraLegs([]);
            setPerRecipientToken(false);
            setMultiRecipients([]);
            setMultiDraft(null);
            setMultiAddDraft(null);
            setAdvancedText('');
            setAdvancedFileName('');
            multiListEditedRef.current = false;
            setSendMode('single');
            setResult(null);
            setContactSaveStage('idle');
            setContactName('');
            setContactSaveError(null);
        };
        const canSaveRecipient = Boolean(txid && toAddress && desc?.coin && !matchedContact);
        const saveRecipient = async (event) => {
            event.preventDefault();
            if (contactSaveBusyRef.current) return;
            const name = contactName.trim();
            if (!name) {
                setContactSaveError('Enter a contact name.');
                return;
            }
            contactSaveBusyRef.current = true;
            setContactSaveStage('saving');
            setContactSaveError(null);
            const entry = { chain: desc.coin, address: toAddress.trim(), label: '' };
            const existing = findContactByName(contacts, name);
            try {
                const saved = existing
                    ? await messaging.saveContact({ record: withEntriesAdded(existing, [entry]) })
                    : await messaging.saveContact({ input: { name, notes: '', entries: [entry] } });
                if (!mountedRef.current) return;
                if (saved) {
                    setContacts((current) => existing
                        ? current.map((contact) => contact.id === existing.id ? saved : contact)
                        : [...current, saved]);
                }
                setContactSaveStage('saved');
            } catch {
                if (!mountedRef.current) return;
                setContactSaveError('Could not save this contact. Check your connection and try again.');
                setContactSaveStage('editing');
            } finally {
                contactSaveBusyRef.current = false;
            }
        };

        // §20 / G040: watcher mode result. The submit returned an unsigned
        // PSBT instead of a broadcast txid; render the export UI (paste +
        // animated QR) so the user can transport it to a Signer-mode wallet.
        // The pending payment-link notice leads the result as ListPage's notice.
        const doneNotices = linkWaiting ? (
            <StatusMessage variant="status">{t('send.linkWaiting')}</StatusMessage>
        ) : null;

        if (result?.psbtHex && !txid) {
            return wrap(
                <ListPage notices={doneNotices}>
                    <ResultScreen state="unsigned" result={result} onSendAnother={sendAnother} onDone={leaveResultDone} />
                </ListPage>,
            );
        }

        // §5.3.4 TRANSIENT broadcast failure: the transaction IS signed and
        // sitting in the broadcast queue, so this is emphatically not an
        // error - but it is not confirmed-pending either. Say exactly that,
        // and do not offer "Send another" (re-sending the same payment while
        // a signed copy is queued is the double-broadcast trap §5.3.4 forbids).
        //
        // this screen used to promise an automatic re-broadcast.
        // Nothing in the wallet re-broadcasts anything: the
        // queue drains only when the user presses "Broadcast now" in
        // QueuedBroadcastBanner, and all the wallet does on its own is toast
        // the user when reachability returns. The copy now promises that
        // reminder and names who does the sending.
        if (result?.queued) {
            return wrap(
                <ListPage notices={doneNotices}>
                    <div role="status" aria-live="polite">
                        <EmptyState
                            role="presentation"
                            icon={<Icon.ClockIcon />}
                            title={SIGNED_NOT_BROADCAST_TITLE}
                            body={t('send.queued.body')}
                            actionLabel={t('common.done')}
                            onAction={leaveResultDone}
                        />
                    </div>
                </ListPage>,
            );
        }

        return wrap(
            <ListPage notices={doneNotices}>
                <div className={styles.successCard} data-transaction-status={sentStatus.status}>
                    <div className={styles.successIcon} aria-hidden="true">
                        {sentStatus.status === 'failed' ? '!' : '✓'}
                    </div>
                    <div role="status" aria-live="polite" aria-atomic="true">
                        <h2 className={styles.successTitle}>
                            {sentStatus.status === 'confirmed'
                                ? t('history.status.confirmed')
                                : sentStatus.status === 'failed'
                                    ? t('history.status.failed')
                                    : t('send.success.broadcastPending')}
                        </h2>
                        <p className={styles.successHint}>
                            {sentStatus.status === 'confirmed'
                                ? (sentStatus.confirmations == null
                                    ? t('send.success.confirmedBody')
                                    : t('transactionStatus.confirmations', { count: sentStatus.confirmations }))
                                : sentStatus.status === 'failed'
                                    ? t('send.success.failedBody')
                                    : t('send.success.broadcastPendingBody')}
                        </p>
                    </div>
                    {sentAmount || recipient ? (
                        <dl className={styles.successSummary}>
                            {sentAmount ? (
                                <div className={styles.successRow}>
                                    <dt>{t('send.fields.amount')}</dt>
                                    <dd>{sentAmount}</dd>
                                </div>
                            ) : null}
                            {recipient ? (
                                <div className={styles.successRow}>
                                    <dt>{t('send.fields.to')}</dt>
                                    <dd className={styles.successMono}><AddressText address={recipient} /></dd>
                                </div>
                            ) : null}
                            {desc ? (
                                <div className={styles.successRow}>
                                    <dt>{t('send.fields.chain')}</dt>
                                    <dd><ChainBadge descriptor={desc} showName={false} /></dd>
                                </div>
                            ) : null}
                        </dl>
                    ) : null}
                    {txid ? (
                        <div className={styles.successTxidBlock}>
                            <p className={styles.successLabel}>{t('send.txid')}</p>
                            <div className={styles.successTxidRow}>
                                <AddressText address={txid} className={styles.txid} size="sm" />
                                <CopyButton
                                    value={txid}
                                    label={t('common.copy')}
                                    ariaLabel={t('common.copyTransactionId')}
                                />
                            </div>
                            {explorerUrl ? (
                                <a
                                    className={styles.successLink}
                                    href={explorerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t('send.success.viewOnExplorer')} <span aria-hidden="true">↗</span>
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                {onViewHistory && txid ? (
                    // M2.4: honest expectation-setting for the merged entry
                    // View in History opens. It exists right away (the wallet's
                    // own pending record), but the decoder polls its node on
                    // a 60s cadence with caches behind that, so the network
                    // side of the row can lag broadcast by up to ~85s with
                    // nothing wrong. A note is a WarningCard, never a loose
                    // paragraph, and sits outside the success card (no card
                    // in a card).
                    <WarningCard data-send-history-note="">
                        <WarningLine>{t('send.success.viewInHistoryHint')}</WarningLine>
                    </WarningCard>
                ) : null}
                {contactSaveStage === 'editing' || contactSaveStage === 'saving' ? (
                    <form className={styles.saveRecipient} onSubmit={saveRecipient}>
                        <Input
                            label={t('common.contactName')}
                            help={t('send.saveRecipient.nameHelp')}
                            value={contactName}
                            onChange={(event) => {
                                setContactName(event.target.value);
                                if (contactSaveError) setContactSaveError(null);
                            }}
                            error={contactSaveError || undefined}
                            autoComplete="off"
                            disabled={contactSaveStage === 'saving'}
                        />
                        <div className={styles.saveRecipientActions}>
                            <Button
                                type="button"
                                variant="secondary"
                                icon={<Icon.XIcon />}
                                disabled={contactSaveStage === 'saving'}
                                onClick={() => {
                                    setContactSaveStage('idle');
                                    setContactName('');
                                    setContactSaveError(null);
                                }}
                            >
                                {t('common.cancel')}
                            </Button>
                            <Button
                                type="submit"
                                variant="success"
                                icon={<Icon.SaveIcon />}
                                disabled={contactSaveStage === 'saving'}
                            >
                                {contactSaveStage === 'saving' ? t('send.saveRecipient.saving') : t('send.saveRecipient.save')}
                            </Button>
                        </div>
                    </form>
                ) : null}
                {contactSaveStage === 'saved' ? (
                    <StatusMessage variant="status">{t('send.saveRecipient.saved')}</StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    {canSaveRecipient && contactSaveStage === 'idle' ? (
                        <Button
                            variant="secondary"
                            icon={<Icon.SaveIcon />}
                            onClick={() => setContactSaveStage('editing')}
                        >
                            {t('send.saveRecipient.open')}
                        </Button>
                    ) : null}
                    {onViewHistory && txid ? (
                        <Button
                            variant="secondary"
                            icon={<Icon.HistoryIcon />}
                            onClick={() => onViewHistory({ chainId, txHash: txid })}
                        >
                            {t('send.success.viewInHistory')}
                        </Button>
                    ) : null}
                    <Button variant="secondary" icon={<Icon.SendIcon />} onClick={sendAnother}>
                        {t('send.success.sendAnother')}
                    </Button>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={leaveResultDone}>
                        {t('common.done')}
                    </Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const nativeTick = nativeTickerFor(descriptor) || '';
        const reviewRecipients = sendLegs.map((leg) => ({
            to: leg.to,
            tick: leg.tick.toUpperCase(),
            amount: leg.amount,
        }));
        const reviewFeeAmount = feeEstimate?.coinAmount
            ? String(feeEstimate.coinAmount)
            : null;
        const reviewFeeFiat = reviewFeeAmount
            ? formatConfirmFeeFiat(reviewFeeAmount)
            : null;
        const reviewFees = [{
            key: 'network',
            label: t('send.networkFee'),
            amount: reviewFeeAmount,
            ticker: nativeTick,
            fiat: reviewFeeFiat,
        }];
        // No Total block (G127 revised 2026-11-16): the sentence says what
        // leaves the wallet and the network fee is its own row.
        const reviewFacts = [
            ...recipientFacts(reviewRecipients, chainId),
            ...(fromAddress?.address ? [{
                key: 'from',
                label: t('send.fields.from'),
                value: fromAddress.address,
                address: true,
                testId: 'confirm-source',
            }] : []),
            ...(trimmedMemo ? [{ key: 'memo', label: t('send.memo'), value: trimmedMemo }] : []),
            ...(rbfForSend ? [{
                key: 'fee-bumping',
                label: t('send.advanced.feeBumping'),
                value: t('send.advanced.allowed'),
            }] : []),
            ...(coinControlEnabled ? [{
                key: 'coin-control',
                label: t('send.advanced.coinControl'),
                value: coinControlLabel,
            }] : []),
            ...(changeAddress?.address ? [{
                key: 'change-address',
                label: t('send.advanced.changeAddress'),
                value: changeAddress.address,
                address: true,
            }] : []),
            ...((dispenserNotice?.summaries || (dispenserNotice?.summary
                ? [dispenserNotice.summary]
                : [])).map((value, index) => ({
                key: `dispenser-${index}`,
                label: t('confirmStandard.facts'),
                value,
                testId: index === 0 ? 'send-dispenser-notice' : undefined,
            }))),
            ...feeFacts(reviewFees),
        ];
        const reviewWarning = confirmWarning({
            decodedWarnings: decoded?.warnings || [],
            extraWarnings: [
                pasteWarning,
                lookalikeWarning,
                ...unusualSendWarnings,
                ...(dispenserNotice?.warnings || []),
            ].filter(Boolean),
            testId: unusualSendWarnings.length > 0 ? 'send-unusual-warnings' : undefined,
        });
        // This review builds or signs without a network pre-flight, so a
        // token send says it was not checked; a plain coin send has nothing
        // for the indexer to check and makes no claim either way.
        const reviewStatus = confirmStatus({ report: null, applies: !isNativeSend });
        const reviewTick = tick.trim().toUpperCase();
        const reviewSentence = isMultiSend
            ? multiSendSentence({
                totals: sendTotals.map((total) => `${formatDisplayAmount(String(total.amount))} ${String(total.tick).toUpperCase()}`),
            }, reviewRecipients)
            : t('confirmStandard.sentence.sendTo', { amount: formatDisplayAmount(String(amount)), tick: reviewTick });
        const rejectReview = () => {
            if (stage === 'submitting') return;
            setSubmitError(null);
            setPassword('');
            setStage('form');
        };
        return wrap(
            <FormPage
                id="send-review-form"
                label={t('send.reviewLabel')}
                onSubmit={handleSubmit}
                status={[submitError ? (
                    <StatusMessage
                        variant="error"
                        recovery={
                            // Max fills Single's one amount; on Multi or Advanced it
                            // would rewrite the first recipient behind its row.
                            sendMode === 'single' && submitErrorCause === 'insufficient_funds'
                                && sourceBalance && parseFloat(sourceBalance.amount || '0') > 0
                                ? { label: t('send.useMax'), onAction: () => { setStage('form'); onMax(); } }
                                : undefined
                        }
                    >
                        {submitError}
                    </StatusMessage>
                ) : networkOffline ? (
                    <>
                        {/* This notice is the page's one offline message, so
                            the shell's reachability notice steps aside. */}
                        <HideReachabilityNotice />
                        <StatusMessage variant="warning">
                            {t(previewBalances.sdkShape ? 'send.offline.body' : 'send.offline.bodyNoCache')}
                        </StatusMessage>
                    </>
                ) : null, testSendGateBanner]}
            >
                <ConfirmStandard
                    label={t('send.reviewLabel')}
                    status={reviewStatus}
                    mark={!isMultiSend && chainId && reviewTick ? (
                        <TickerIcon chainId={chainId} tick={reviewTick} context="hero" />
                    ) : null}
                    icon="send"
                    sentence={reviewSentence}
                    address={isMultiSend ? null : toAddress.trim()}
                    chainName={descriptor?.displayName || ''}
                    facts={reviewFacts}
                    warning={reviewWarning}
                >
                    {isWatcherMode ? (
                        <>
                            <p className={styles.hint}>
                                {t('common.watcherBuildsUnsigned')}
                            </p>
                            {isHwSource ? (
                                <FormNotice variant="status">
                                    {t('send.watcherHardware', {
                                        device: fromAddress.source === 'trezor'
                                            ? t('send.device.trezor')
                                            : t('send.device.ledger'),
                                    })}
                                </FormNotice>
                            ) : null}
                        </>
                    ) : isHwSource ? (
                        <HwSignBlock
                            signerKind={fromAddress.source}
                            signerName={fromAddress.signerLabel || (fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger')}
                            path={fromAddress.derivationPath || ''}
                            address={fromAddress.address}
                            chainId={chainId}
                            getStatus={(opts) => messaging.getSignerStatus({
                                signerId: fromAddress.signerId,
                                chainId: opts?.chainId ?? chainId,
                            })}
                            onStatusChange={onHwStatusChange}
                            signerInfo={hwSignerInfo}
                            requireExplicitConfirm={signRisk.requireExplicitConfirm}
                            requireExplicitConfirmReason={signRisk.reason}
                            onConfirmedChange={setHwExplicitConfirmed}
                        />
                    ) : signerReady ? (
                        // State a self-armed freeze without exposing a duress-armed freeze.
                        <SigningReadyNote />
                    ) : (
                        <PanicPasswordGate>
                            <Input
                                ref={passwordRef}
                                type="password"
                                label={t('common.password')}
                                help={t('send.passwordHint')}
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    if (submitError) { setSubmitError(null); setSubmitErrorCause(null); }
                                }}
                                autoComplete="current-password"
                                disabled={stage === 'submitting'}
                                error={submitErrorCause === 'password_required' && !password
                                    ? t('confirmStandard.blocked.passwordField')
                                    : undefined}
                            />
                        </PanicPasswordGate>
                    )}
                </ConfirmStandard>
            </FormPage>,
            <ConfirmDecisionFooter
                onReject={rejectReview}
                // Always live (G130): handleSubmit says why at the top of the
                // review when it cannot send yet.
                onApprove={() => document.getElementById('send-review-form')?.requestSubmit()}
                rejectDisabled={stage === 'submitting'}
                approveLoading={stage === 'submitting'}
            />,
        );
    }

    // source picker, the same OwnAddressPickerScreen every other action
    // form routes its From field to. Rendered in place of the form; all other
    // form state stays intact behind it.
    if (sourcePickerOpen) {
        // A pick on another chain switches the form network first, so
        // the pick is recorded against the chain it was made on and the
        // source default effect keeps it. The form chain's multisig sources
        // ride above the address list as picker rows, so a wallet with a
        // multisig still gets the one shared picker with its network filter.
        let pickChain = chainId;
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title={t('send.fromAddress')}
                walletId={walletId}
                chainId={chainId}
                // A network switch here moves Token and the rest of
                // the form with it, as the Network field does.
                onChainChange={(cid) => { pickChain = cid; onNetworkChange(cid); }}
                pickerActions={multisigAddresses.map((entry) => ({
                    key: `multisig-${entry.multisigConfigId}`,
                    label: t('send.source.multisigTitle', {
                        threshold: entry.threshold,
                        count: entry.cosignerCount,
                    }),
                    sublabel: entry.address || t('send.source.unavailable'),
                    onSelect: () => {
                        setMultisigSource({ chainId, id: entry.multisigConfigId });
                        setSourcePickerOpen(false);
                    },
                }))}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setMultisigSource(null);
                    setPickedSourceChain(pickChain);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    const selectedMultisig = multisigSource?.chainId === chainId
        ? multisigAddresses.find((entry) => entry.multisigConfigId === multisigSource.id)
        : null;
    if (selectedMultisig) {
        return (
            <MultisigSendForm
                walletId={walletId}
                chainId={chainId}
                multisigConfigId={selectedMultisig.multisigConfigId}
                multisig={selectedMultisig}
                onSessionStarted={onSessionStarted}
                onChangeSource={() => setSourcePickerOpen(true)}
                wrapPage={wrap}
            />
        );
    }

    // Contacts picker: rendered in place of the form when the user taps a To
    // field's contacts icon. The target keeps Single, Add and Edit drafts apart.
    if (contactsPickerTarget) {
        return (
            <ContactsPickerScreen
                contacts={contacts}
                variant={variant}
                onPick={handlePickContact}
                onBack={() => setContactsPickerTarget(null)}
            />
        );
    }

    // The Token field opens the standard TokenPicker on the form's network. Its
    // network filter can widen to another chain (G63); a pick there moves the
    // form first (G62). onTickInputChange clears amounts and says so, as
    // typing a new ticker does.
    if (tokenPickerRecipientId === PRIMARY_TOKEN_PICKER) {
        const closeAssetPicker = () => {
            setAssetPickerNetwork(null);
            setTokenPickerRecipientId(null);
        };
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                accountId={accountId}
                // A picker offering the native coin and tokens is "Asset".
                title={t('send.asset')}
                networkFilter={assetPickerNetwork ?? coinFromChainId(chainId)}
                onNetworkFilterChange={setAssetPickerNetwork}
                chainIdFilter={assetPickerNetwork ? undefined : (chainId || undefined)}
                onSelect={(selection) => {
                    const picked = String(selection.tick || '').toUpperCase();
                    if (selection.chainId && selection.chainId !== chainId) {
                        onNetworkChange(selection.chainId);
                        setTick(picked);
                    } else {
                        onTickInputChange(picked);
                    }
                    closeAssetPicker();
                }}
                onBack={closeAssetPicker}
            />
        );
    }

    // Multi's add-recipient Token field: tokens on this network only, since
    // the coin pays its own output and has no multi-recipient form, so the
    // page is titled Token (G60).
    if (tokenPickerRecipientId === MULTI_TOKEN_PICKER || tokenPickerRecipientId === MULTI_ADD_TOKEN_PICKER) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                accountId={accountId}
                title={t('send.fields.token')}
                networkFilter={coinFromChainId(chainId)}
                chainIdFilter={chainId || undefined}
                kindFilter="tokens"
                kindLocked
                onSelect={(selection) => {
                    const patch = { tick: String(selection.tick || '').toUpperCase() };
                    if (tokenPickerRecipientId === MULTI_ADD_TOKEN_PICKER) changeMultiAddDraft(patch);
                    else changeMultiDraft(patch);
                    setTokenPickerRecipientId(null);
                }}
                onBack={() => setTokenPickerRecipientId(null)}
            />
        );
    }

    // stage === 'form'
    const draftBanner = hasMeaningfulSendDraft(draft.load()) && !draftPending ? (
        <DraftNotice
            onRestore={restoreDraft}
            onDiscard={discardSavedDraft}
            restoreLabel={t('send.draft.restore')}
        >
            {t('send.draft.unfinished')}
        </DraftNotice>
    ) : null;
    // Section helpers. A section holding an error gets a key that
    // changes on every Send attempt, so it reopens even after being closed.
    // The error map's keys are the failing field ids (From, To, Asset, Amount, Memo,
    // each extra recipient's address and amount) plus 'form:' keys with no field.
    const sendFormErrorIds = new Set(Object.keys(form.errors));
    const sectionErrorKey = (hasError) => (hasError ? validationAttempt + 1 : 0);
    // Closed-section summaries of the standard frame; the Fees section writes its own.
    const tickUpper = tick.trim().toUpperCase();
    const nativeTick = nativeTickerFor(descriptor) || '';
    const multiTotals = extraLegs.length > 0 && sendTotals.length > 0 && !nativeMultiSendBlock;
    const amountSummary = multiTotals
        ? sendTotals.map((item) => `${formatWithThousands(item.amount)} ${item.tick}`).join(' + ')
        : (amount ? `${formatWithThousands(amount) || amount} ${tickUpper}`.trim() : tickUpper);
    const toSummary = sendMode !== 'single' && extraLegs.length > 0
        ? `to ${extraLegs.length + 1} recipients`
        : toAddress.trim()
            ? <>{summaryLineWithAddress(t, 'send.summary.toAddress', 'address', toAddress)}{extraLegs.length > 0 ? ` +${extraLegs.length}` : ''}</>
            : '';
    const paymentSummary = joinSummaryParts([amountSummary, toSummary], ' ') || null;
    const paymentHasError = Boolean(toError || amountBalanceError
        || [...sendFormErrorIds].some((id) => id === 'send-destination' || id === 'send-amount'
            || id === 'send-token' || id === 'send-multi-list' || id === 'send-advanced-text'
            || String(id).startsWith('form:advanced-line-')));
    return wrap(
        <FormFrame
            id={SEND_FORM_ID}
            walletId={walletId}
            label={t('send.title')}
            onSubmit={handleReview}
            errors={form}
            // An amount refusal (over the balance, empty, malformed) offers the
            // one-click fix on the error notice, as the old summary did: Use
            // max fills the largest amount that fits, and its amount change
            // clears the entry, so the action leaves with it.
            errorAction={form.errorFor('send-amount')
                && sourceBalance && parseFloat(sourceBalance.amount || '0') > 0
                ? { label: t('send.useMax'), onAction: onMax, icon: <Icon.MaxIcon /> }
                : undefined}
            onChangeCapture={() => {
                if (submitError) setSubmitError(null);
                if (submitFieldError) setSubmitFieldError(null);
            }}
            /*
              * State the signing freeze at the TOP of the form, so a duress observer
              * never watches a transaction get composed first. Duress-armed freezes
              * render nothing here, by design. It stays above the sections, and
              * above a hosting page's own lead (the Fund page's QR).
              */
            lead={(draftBanner || formLead || !isWatcherMode) ? (
                <>
                    {draftBanner}
                    {!isWatcherMode ? <PanicFreezeNotice key={panicNoticeKey} surface="send" /> : null}
                    {formLead}
                </>
            ) : null}
            status={[isDemo ? (demoRefused ? (
                <StatusMessage
                    variant="error"
                    testId="demo-guard-refusal"
                    recovery={{
                        label: t('send.demo.createRealWallet'),
                        onAction: () => { setDemoExitError(null); setDemoExitConfirmOpen(true); },
                    }}
                >
                    {t('demo.guard.blocked')}
                </StatusMessage>
            ) : null) : submitError ? (
                <StatusMessage variant="error">{submitError}</StatusMessage>
            ) : networkOffline ? (
                <>
                    {/* This notice is the page's one offline message, so the
                        shell's reachability notice steps aside. */}
                    <HideReachabilityNotice />
                    <StatusMessage variant="warning">
                        {t(previewBalances.sdkShape ? 'send.offline.body' : 'send.offline.bodyNoCache')}
                    </StatusMessage>
                </>
            ) : null, testSendGateBanner, requestMessage ? (
                <StatusMessage variant="status">
                    {t('send.paymentRequestMessage')} <span data-testid="payment-request-message">
                        {requestMessage}
                    </span>
                </StatusMessage>
            ) : null]}
            action={(
                <FormAction
                    icon={<Icon.SendIcon />}
                    loading={confirmAction.composing}
                    title={networkOffline ? t('send.offline.title') : undefined}
                >
                    {t('send.title')}
                </FormAction>
            )}
            /* The standard order: From (Network and address), Payment (To, Asset,
               Amount, extra recipients), optional Memo and Advanced, then the
               Network fee row. A section holding an error reopens on every Send. */
            /*
              * The funding address, shown and changeable.
              *
              * Send resolves its source to the chain's ACTIVE address and used to
              * neither render it nor offer to change it, while the other 26 action
              * forms all carry this field. That made the two halves of the screen
              * disagree silently: the asset picker is WALLET-scoped and offers every
              * token the wallet holds anywhere, but the funding is ADDRESS-scoped, so
              * a token held on a non-active address could be selected, priced and
              * composed, and the failure came back as the encoder's "no spendable
              * UTXOs found for the funding address" - a sentence about UTXOs, from
              * which the fix (switch address) is not discoverable.
              *
              * Rendering it also puts the balance line underneath in context: the
              * "available" figure has always been this address's balance, not the
              * wallet's.
              */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={addressesByChain && Object.keys(addressesByChain).length
                        ? Object.keys(addressesByChain)
                        : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={onNetworkChange}
                    networkHelp={t('send.networkHelp')}
                    address={fromAddress?.address || null}
                    addressId="send-from"
                    revealKey={sectionErrorKey(sendFormErrorIds.has('send-from'))}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel={t('send.source.choose')}
                    addressHelp={t('send.source.hint')}
                    /* No balance note here; the Amount field already
                       states this address's balance, and one figure in two
                       places reads as two balances. */
                    // Only once the address list has loaded, so a slow
                    // read does not open From for good.
                    missing={addressesByChain ? (
                        <FormNotice variant="error">
                            {otherNetworkKind
                                ? t('send.source.otherNetwork', { network: activeNetworkLabel(otherNetworkKind) })
                                : t('send.source.noAddress')}
                        </FormNotice>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={nativeTick}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeEstimate}
                    error={submitFieldError?.field === 'fee' ? submitFieldError.message : null}
                    revealKey={sectionErrorKey(submitFieldError?.field === 'fee')}
                    formErrorKey="form:fee"
                    // Send always states fee bumping, seeded from Settings,
                    // and shows the change its chosen coins leave.
                    advanced={{ rbfDefault: rbfByDefault, coinsNote: coinControlChange }}
                />
            )}
        >
            <FormSection
                id="payment"
                title={t('send.section.payment')}
                icon={Icon.SendIcon}
                {...formSections.bind('payment')}
                revealKey={sectionErrorKey(paymentHasError)}
                summary={paymentSummary}
            >
            {/* Single, Multi or Advanced, directly above what it switches (G41). */}
            <Tabs
                id="send-mode"
                aria-label={t('send.mode.label')}
                items={[
                    { id: 'single', label: t('send.mode.single'), icon: <Icon.UserIcon />, controls: 'send-mode-panel' },
                    { id: 'multi', label: t('send.mode.multi'), icon: <Icon.UsersIcon />, controls: 'send-mode-panel' },
                    { id: 'advanced', label: t('send.advanced'), icon: <Icon.DocumentIcon />, controls: 'send-mode-panel' },
                ]}
                value={sendMode}
                onChange={switchSendMode}
            />
            <div
                id="send-mode-panel"
                role="tabpanel"
                aria-labelledby={`send-mode-tab-${sendMode}`}
                className={styles.sendModePanel}
            >
            {/* What a network or token change reset, in whichever tab is open. */}
            {assetSwitchNotice ? (
                <FormNotice variant="status">{assetSwitchNotice}</FormNotice>
            ) : null}
            {sendMode === 'multi' ? (
                <MultiRecipientList
                    chainId={chainId}
                    recipients={multiRecipients}
                    editDraft={multiDraft}
                    addDraft={multiAddDraft}
                    onEditDraftChange={changeMultiDraft}
                    onAddDraftChange={changeMultiAddDraft}
                    onStartAdd={startAddRecipient}
                    onToggleEdit={toggleEditRecipient}
                    onCommitEdit={commitMultiDraft}
                    onCommitAdd={commitMultiAddDraft}
                    onCancelAdd={() => setMultiAddDraft(null)}
                    onRemove={removeMultiRow}
                    onOpenTokenPicker={(target) => setTokenPickerRecipientId(
                        target === 'add' ? MULTI_ADD_TOKEN_PICKER : MULTI_TOKEN_PICKER,
                    )}
                    onOpenContactsPicker={openContactsPicker}
                    divisibilityFor={recipientRules.decimalsFor || undefined}
                    maxFor={multiMaxFor}
                    // The limit and the balance speak while the list is
                    // built, as the Single amount field's balance check does.
                    error={form.errorFor('send-multi-list')
                        || (multiDraft || multiAddDraft ? null : (recipientFitError || amountBalanceError))}
                />
            ) : null}
            {sendMode === 'advanced' ? (
                <AdvancedRecipientText
                    text={advancedText}
                    onTextChange={changeAdvancedText}
                    fileName={advancedFileName}
                    onFileText={loadAdvancedFile}
                    onClearFile={clearAdvancedFile}
                    onFileError={(message) => { setAdvancedFileName(''); setAdvancedFileError(message); }}
                    fileError={advancedFileError}
                    error={advancedLineErrors}
                    countLine={advancedNote}
                    overLimit={advancedNoteWarns}
                />
            ) : null}
            {sendMode === 'single' ? (<>
            <AddressCombobox
                size="md"
                id="send-destination"
                icon="contacts"
                label={matchedContact
                    ? <>{t('send.fields.to')} <span className={styles.toContactName}>{matchedContact.contact.name}</span></>
                    : t('send.fields.to')}
                help={t('send.destination.help')}
                value={toAddress}
                onChange={(e) => {
                    setToAddress(e.target.value);
                    setPastedRecipient(null);
                    if (toError) setToError(null);
                    if (pasteHint) setPasteHint(null);
                    if (pasteWarning) setPasteWarning(null);
                }}
                onBlur={() => setToError(destinationAddressError(toAddress, descriptor))}
                onPaste={onAddressPaste}
                suggestions={suggestions}
                onSuggestionSelect={handlePickRecipient}
                hint={pasteHint || undefined}
                onIconClick={() => openContactsPicker('single')}
                placeholder={t('send.destination.placeholder')}
                error={toError || undefined}
            />
            {pastedRecipient ? (
                <div className={styles.pastedRecipient} aria-live="polite">
                    <span className={styles.pastedRecipientLabel}>{t('send.paste.checkLabel')}</span>
                    <AddressText address={pastedRecipient} highlight />
                    <span className={styles.pastedRecipientHint}>{t('send.paste.checkHint')}</span>
                </div>
            ) : null}
            {pasteWarning ? (
                <FieldNote variant="warning" role="alert">{pasteWarning}</FieldNote>
            ) : null}
            {lookalikeWarning ? (
                <FieldNote variant="warning" role="alert">{lookalikeWarning}</FieldNote>
            ) : null}
            {/* The standard Token field (TokenField opening TokenPicker); it
                keeps the send-token id the error summary focuses. */}
            <TokenField
                size="md"
                id="send-token"
                // It offers the native coin and tokens, so it is "Asset".
                label={t('send.asset')}
                placeholder={t('send.selectAsset')}
                help={t('send.token.hint')}
                value={chainId && tick.trim() ? { chainId, tick: tick.trim().toUpperCase() } : null}
                onOpenPicker={() => setTokenPickerRecipientId(PRIMARY_TOKEN_PICKER)}
                disabled={!chainId}
            />
            <AmountField
                size="md"
                id="send-amount"
                amount={amount}
                fiatAmount={fiatAmount}
                tick={tick}
                fiatRate={amountFiatRate}
                fiatCurrency={fiatCurrency}
                amountInputMode={amountInputMode}
                help={t('send.amount.help')}
                error={amountBalanceError
                    || (submitFieldError?.field === 'amount' ? submitFieldError.message : undefined)
                    || undefined}
                divisibility={sourceBalance?.divisibility ?? (isNativeSend ? 8 : undefined)}
                onAmountFieldChange={onAmountFieldChange}
                toggleAmountInputMode={toggleAmountInputMode}
                inputRef={amountInputRef}
                onMax={onMax}
                // Offline the page already says sending needs a connection and Review is
                // off, so Max (which quotes a fee over the network) is off with it.
                maxDisabled={!sourceBalance || networkOffline}
                maxBusy={maxBusy}
                balanceText={
                    previewBalances.loading
                        ? ((balanceGateWaived || balanceGateSettledRef.current) ? t('send.balance.unknown') : t('common.loading'))
                        : previewBalances.error
                            ? t('send.balance.unavailable', { error: previewBalances.error })
                            : networkOffline && !isDemo && !previewBalances.sdkShape
                                ? t('send.balance.unknown')
                                : sourceHalfUnavailable
                                    ? t('send.balance.unknown')
                                    : sourceBalance
                                        ? t('send.balance.available', {
                                            amount: formatWithThousands(sourceBalance.amount),
                                            ticker: sourceBalance.tick,
                                        })
                                        : t('send.balance.available', {
                                            amount: '0',
                                            ticker: tick.trim().toUpperCase(),
                                        }).replace(/\s+/g, ' ').trim()
                }
            />
            {maxNote ? (
                <p className={styles.balanceHint} role="status">{maxNote}</p>
            ) : null}
            {sourcePendingUnknown && !previewBalances.loading && !previewBalances.error ? (
                <p className={styles.balanceHint} role="status" data-testid="send-pending-unknown">
                    {t('send.balance.pendingUnknown')}
                </p>
            ) : null}
            {/* Say it while the amount field still has focus, not only on Send.
                Suppressed once Send has already put the same sentence in the error map,
                so the user is not shown it twice. */}
            {dustBlock && form.errorFor('send-amount') !== dustBlock ? (
                <FieldNote variant="warning" role="alert">{dustBlock}</FieldNote>
            ) : null}
            </>) : null}
            </div>
            {sourceLacksTick ? (
                <FormNotice variant="warning" role="alert">{sourceLacksTick}</FormNotice>
            ) : null}
            {nativeMultiSendBlock ? (
                <FormNotice variant="warning" role="alert">{nativeMultiSendBlock}</FormNotice>
            ) : null}
            {gatedMultiSendBlock ? (
                <FormNotice variant="warning" role="alert">{gatedMultiSendBlock}</FormNotice>
            ) : null}
            {gatedInfo && gatedInfo.state === 'ready' ? (
                <FormNotice variant="status">
                    {t('send.gated.ready')}
                </FormNotice>
            ) : null}
            {gatedInfo && gatedInfo.state === 'partial' ? (
                <FormNotice variant="warning" role="alert">
                    {t('send.gated.partial', {
                        total: gatedInfo.groups.length,
                        available: gatedInfo.groups.filter((g) => g.haveKey).length,
                        missingCount: gatedInfo.groups.filter((g) => !g.haveKey).length,
                        missing: gatedInfo.groups.filter((g) => !g.haveKey)
                            .map((g) => g.keyHash.slice(0, 12)).join(', '),
                    })}
                </FormNotice>
            ) : null}
            {/* The blocked state is one notice above the form; the key recovery
                it offers stays here as an ordinary password field and button. */}
            {gatedInfo && gatedInfo.state === 'blocked' ? (
                <>
                    <FormNotice
                        variant="warning"
                        role="alert"
                        lines={(isWatcherMode || isHwSource)
                            ? [t('send.gated.blocked'), t('send.gated.softwareSigner')]
                            : [t('send.gated.blocked')]}
                    />
                    {(isWatcherMode || isHwSource) ? null : (
                        <>
                            <Input
                                type="password"
                                label={t('send.gated.passwordLabel')}
                                help={t('send.gated.passwordHint')}
                                value={gatedScanPassword}
                                onChange={(e) => {
                                    setGatedScanPassword(e.target.value);
                                    if (gatedScanError) setGatedScanError(null);
                                }}
                                error={gatedScanError || undefined}
                                autoComplete="current-password"
                            />
                            <Button
                                type="button"
                                variant="secondary"
                                icon={<Icon.RefreshIcon />}
                                loading={gatedScanBusy}
                                onClick={handleGatedScan}
                            >
                                {t('send.gated.recover')}
                            </Button>
                        </>
                    )}
                </>
            ) : null}
            </FormSection>
            {/* No memo on a native-coin send: a memo belongs to an XChain SEND action,
                which the chain rejects for a native tick, so the input would do nothing.
                Token sends keep it, as its own optional section. */}
            {isNativeSend ? null : (
                // The section holds only the memo: its title names the field
                // and carries its count.
                <MemoSection
                    {...formSections.bind('memo')}
                    revealKey={sectionErrorKey(sendFormErrorIds.has('send-memo') || Boolean(memoTooLong))}
                    inputId="send-memo"
                    maxLength={MAX_MEMO_LENGTH}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    error={memoTooLong || (/[|;]/.test(memo) ? t('send.memoForbiddenChars') : undefined)}
                />
            )}
            {/* Advanced (fee bumping, coin control, change address) is the
                shared section FeeSection draws directly above Speed and Fees. */}
        </FormFrame>,
    );
}

/**
 * Decimal places of one held asset in a source balance read, or undefined when
 * the read does not state them.
 *
 * @param {any} sdkShape   getAddressBalances answer
 * @param {string} tickUpper
 * @returns {number | undefined}
 */
function heldDivisibility(sdkShape, tickUpper) {
    const native = sdkShape?.native;
    const rawAsset = native && String(native.tick || '').toUpperCase() === tickUpper
        ? native
        : (sdkShape?.tokens || [])
            .find((token) => String(token?.tick || '').toUpperCase() === tickUpper);
    const divisibility = Number(rawAsset?.divisibility);
    return Number.isInteger(divisibility) && divisibility >= 0 ? divisibility : undefined;
}

// `help` adds a visible field-name row with the shared label-row InfoTip above the
// icon button; without it the control stays the bare icon.
export function AssetIconPicker({ chainId, tick, label, onOpen, error, help }) {
    const accessibleName = tick ? `${label}: ${tick}. Change asset` : `${label}: Choose asset`;
    return (
        <div className={styles.assetPickerControl}>
            {help ? (
                <div className={styles.assetPickerLabelRow}>
                    <span className={styles.assetPickerLabel}>{t('send.fields.token')}</span>
                    <InfoTip
                        label={help}
                        aria={t('ui.field.about', { label: t('send.fields.token') })}
                    />
                </div>
            ) : null}
            <Button
                variant="ghost"
                className={styles.assetPickerButton}
                onClick={onOpen}
                aria-label={accessibleName}
                aria-invalid={error ? 'true' : undefined}
                icon={chainId && tick ? <TickerIcon chainId={chainId} tick={tick} size={40} /> : <Icon.TokenIcon />}
            />
            <FieldNote variant="error">{error || null}</FieldNote>
        </div>
    );
}

// Hero badge for the asset being sent. Native = large chain icon.
// Token with imageUrl = square image + chain-icon overlay. Token without
// imageUrl = letter badge tinted by `tickerColor` + chain-icon overlay.
// The prefill's imageUrl only applies when the form's current
// (chainId, tick) still matches what the user picked; if they retype
// the tick to something else, fall back to the letter-badge style.
export function SelectedTokenHero({ chainId, tick, descriptor, prefill, onChangeAsset, allowRemoteImages }) {
    const tickTrim = (tick || '').trim();
    if (!chainId || !tickTrim) return null;
    const nativeTicker = nativeTickerFor(descriptor);
    const isNative = !!nativeTicker && tickTrim.toUpperCase() === nativeTicker;
    const chainIconUrl = branding.chainIconSmallUrl(chainId);
    const chainIconLarge = branding.chainIconLargeUrl(chainId);
    const prefillMatches = prefill
        && prefill.chainId === chainId
        && (prefill.tick || '').trim().toUpperCase() === tickTrim.toUpperCase();
    const candidateImageUrl = prefillMatches && typeof prefill?.imageUrl === 'string' && prefill.imageUrl
        ? prefill.imageUrl
        : null;
    const imageUrl = isAssetImageSourceAllowed(candidateImageUrl, allowRemoteImages)
        ? candidateImageUrl
        : null;
    const heroName = prefillMatches && typeof prefill?.displayName === 'string' && prefill.displayName
        ? prefill.displayName
        : (isNative ? (descriptor?.displayName || tickTrim) : tickTrim);
    const interactive = typeof onChangeAsset === 'function';
    const IconTag = interactive ? 'button' : 'div';
    const iconProps = interactive
        ? {
            type: 'button',
            onClick: onChangeAsset,
            'aria-label': `Change asset (currently ${heroName})`,
            className: `${buttonStyles.btn} ${buttonStyles.ghost} ${buttonStyles.lg} ${styles.heroIconWrap} ${styles.heroAsset} ${styles.heroIconWrapInteractive}`,
        }
        : { className: `${styles.heroIconWrap} ${styles.heroAsset}`, 'aria-hidden': 'true' };
    return (
        <IconTag {...iconProps}>
            <span
                className={styles.heroIconLetter}
                style={{ background: tickerColor(tickTrim), color: '#FFFFFF' }}
                aria-hidden="true"
            >
                {tickTrim.slice(0, 1).toUpperCase()}
            </span>
            {isNative && chainIconLarge ? (
                <img
                    src={chainIconLarge}
                    alt=""
                    aria-hidden="true"
                    className={styles.heroIconImg}
                    style={{ position: 'absolute', inset: 0 }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : imageUrl ? (
                <img
                    src={imageUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.heroIconImg}
                    style={{ position: 'absolute', inset: 0 }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : null}
            {!isNative && chainIconUrl ? (
                <img
                    src={chainIconUrl}
                    alt=""
                    className={styles.heroChainOverlay}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : null}
        </IconTag>
    );
}
