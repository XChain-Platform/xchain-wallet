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
import {
    FieldNote,
    Screen,
    PageHeader,
    FormNotice,
    FormPage,
    ListPage,
    Button,
    Input,
    ChainBadge,
    AddressText,
    Icon,
    StatusMessage,
    AddressField,
    useFormErrors,
} from '@xchain-wallet/core/ui';
import { ExpirationFields, expirationParam, expirationWithinFreePeriod } from '../components/expirationChoice.jsx';
import { ListField } from '../components/ListField.jsx';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
// Dispenser renders through the shared Give/Get standard (Quick and Full views of one state).
import {
    GiveGetQuick,
    RateLine,
    useGiveGetView,
    ViewSwitch,
} from '../components/giveGet/index.js';
// And the Wallet Form Standard frame: From first, the Dispenser
// section open, Dispenser terms closed, one Network fee row, one action.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
} from '../components/formStandard/index.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/dispenserForm.js';
import '../../i18n/locales/en/send.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { AmountField } from '../components/AmountField.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import {
    compareDecimalStrings,
    decimalQuotientFloor,
    divideDecimalStrings,
    formatWithThousands,
    groupDecodedAmounts,
    normalizeLocalizedDecimal,
    tokenAmountPrecisionError,
} from '../utils/amountFormat.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSettings } from '../hooks/useSettings.js';
import { getActiveNetwork } from '../../flows/effectiveNetwork.js';
import styles from './IssueTokenForm.module.css';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { FiatCurrencyField } from '../components/FiatCurrencyField.jsx';
import { FiatCurrencyPicker } from '../components/FiatCurrencyPicker.jsx';
import { PROTOCOL_FIAT_CODES } from '../utils/fiatCurrencies.js';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { isValidFiatAmount } from '../utils/fiatAmountFormat.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { pickedListText } from '../utils/listLabel.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { useFormLeaveGuard } from '../hooks/useFormLeaveGuard.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import {
    listMembers,
    dispenserCreateAllowListVerdict,
    ownerOffAllowListMessage,
} from '../../flows/allowListSelfCheck.js';
import {
    rememberUnusedDispenserAddress,
    recallUnusedDispenserAddress,
    forgetUnusedDispenserAddress,
} from '../utils/unusedDispenserAddress.js';
import { DraftNotice } from '../components/DraftNotice.jsx';
import { useDispenserPriceFloor, PRICE_BELOW_FLOOR_ERROR } from '../hooks/useDispenserPriceFloor.js';
import { detectAddressCoin, isValidAddressForChain } from '../utils/addressValidation.js';
import {
    dispenserAddressVerdict,
    readDispenserAddressStanding,
} from '../../flows/dispenserAddressStanding.js';
import { listInBothSlots, listInBothSlotsMessage } from '../../flows/accessListSlots.js';
import { exceedsBalance } from '../utils/dividendPerUnit.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

function isPositiveDecimal(value) {
    const text = String(value || '').trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') === 1;
}

// §40.7.1's Mode 1 FIAT dispenser uses the validator oracle (no
// ORACLE_ADDRESS); Mode 2 uses a user oracle (ORACLE_ADDRESS). For
// the initial form we expose the optional ORACLE_ADDRESS + FIAT_CODE
// fields under "Advanced options" so the §40.7.1 primary flow stays
// uncluttered. The codes are the protocol's 12 (shared with the oracle form).
const FIAT_CODES = PROTOCOL_FIAT_CODES;


// datetime-local string -> Unix seconds. DISPENSER EXPIRATION is a
// wall-clock Unix timestamp (indexer bclte(EXPIRATION, BLOCK_TIME)),
// same as the DISPENSER v2 edit (PC-19).
function localInputToUnix(localStr) {
    const ms = Date.parse(String(localStr));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

// The Expiration modes the form and a saved draft accept.
const EXPIRATION_MODES = ['default', '6m', '9m', '1y', 'custom'];

// Every mode but 'default' (3 months, sent as no EXPIRATION) carries the
// Expires time, which must be a valid time in the future.
function expirationValidationError(mode, input, nowSec = Math.floor(Date.now() / 1000)) {
    if (mode === 'default') return null;
    const raw = String(input || '').trim();
    if (!raw) return 'Pick an expiration date and time, or choose a common term.';
    const unix = localInputToUnix(raw);
    if (!unix || unix <= nowSec) return 'Expiration must be in the future.';
    return null;
}

// existingAddressId for a reopened dispenser's address when the wallet holds
// no record of it (see existingAddress below).
const REOPEN_ADDRESS_ID = 'reopen-dispenser-address';

const COIN_NAME = { bitcoin: 'Bitcoin', litecoin: 'Litecoin', dogecoin: 'Dogecoin' };

// Check a typed dispenser address the way Send checks a recipient: it must
// decode for this chain's coin and network, since buyers pay to it and a
// mistyped or wrong-chain address sends every payment nowhere. Empty is not
// an error here; Create reports a missing address on its own.
function outsideAddressError(address, descriptor) {
    if (!address || !descriptor?.coin || !descriptor?.networkKind) return null;
    if (isValidAddressForChain(address, descriptor.coin, descriptor.networkKind)) return null;
    const chainName = COIN_NAME[descriptor.coin] || descriptor.coin;
    // Name the coin it does look like, which beats a bare "invalid". The
    // network kind stays out of the copy; Settings owns that choice.
    const detected = detectAddressCoin(address);
    if (detected && detected !== descriptor.coin) {
        return `This looks like a ${COIN_NAME[detected] || detected} address, not a ${chainName} address.`;
    }
    return `This is not a valid ${chainName} address. Check it for typos.`;
}

// Fields the user fills in. Chain, source, fee and the mode toggles start on
// defaults, so a draft with none of these filled holds nothing to restore. A
// token the caller filled in (initialTick) is not typed either, so a ticker
// equal to it counts as unfilled.
const DISPENSER_DRAFT_TEXT_FIELDS = [
    'giveAmount', 'escrow', 'triggerPrice', 'oracleAddress', 'fiatAmount',
    'getTick', 'getTokenAmount', 'expInput', 'allowListIdx', 'blockListIdx', 'outsideAddress',
];

// Which standard section holds each field the error summary links
// to: the Dispenser section (give and get terms) or Dispenser terms.
const DISPENSER_ERROR_SECTION = {
    'dispenser-token': 'dispenser',
    'dispenser-give': 'dispenser',
    'dispenser-escrow': 'dispenser',
    'dispenser-payment-token': 'dispenser',
    'dispenser-payment-amount': 'dispenser',
    'dispenser-trigger-price': 'dispenser',
    'dispenser-oracle': 'options',
    'dispenser-fiat-amount': 'options',
    'dispenser-fiat-code': 'options',
    'dispenser-expiration': 'options',
    'dispenser-address': 'options',
};

function hasDispenserDraft(values, initialTick) {
    if (!values || typeof values !== 'object') return false;
    const ticker = String(values.ticker ?? '').trim();
    if (ticker && ticker !== String(initialTick ?? '').trim()) return true;
    return DISPENSER_DRAFT_TEXT_FIELDS.some((field) => String(values[field] ?? '').trim().length > 0);
}

/**
 * Dispenser authoring form (§40.7.1).
 *
 * Opens a new DISPENSER (v0 Create) so a token owner can vend
 * `GIVE_AMOUNT` of their token every time a buyer sends
 * `GET_AMOUNT` of the native coin (or, in the FIAT lane, an
 * oracle-priced fiat-equivalent amount) to the dispenser address.
 *
 * Spec defaults:
 *   - GIVE_COIN + GET_COIN = the current chain's protocol ticker
 *     (BTC / LTC / DOGE). Dispensers do not cross chains.
 *   - GET_TICK = '' (coin-paid) when the buyer pays in the native
 *     coin (the primary §40.7.1 lane). The SDK validator from
 *     xchain-sdk@1.8.1 accepts an empty GET_TICK as long as
 *     GET_COIN is set.
 *   - GET_ADDRESS left empty; protocol defaults to SOURCE.
 *
 * Cancel + Edit (v1 / v2) are not exposed here; those land alongside
 * a dispenser-detail surface in a later step.
 *
 * §16: each dispenser is opened on its own dedicated address. SOURCE
 * stays the token-holding main address (it signs and the escrow debits
 * from it); GET_ADDRESS is a fresh role='dispenser' external address
 * under the active account. This is a single DISPENSER action: it debits
 * SOURCE and escrows into the dispenser at GET_ADDRESS in one tx
 * (DISPENSER.md fresh-address exception; SOURCE keeps cancel authority).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]   account the dispenser sub-address is derived under
 * @param {() => void} props.onBack
 * @param {object} [props.reopen]  terms of a finished dispenser to open
 *   again (DispenserDetail's reopenTermsFrom): its creator as SOURCE, its
 *   address as the dispenser address, every term prefilled and still editable
 */
export function DispenserForm({ walletId, activeAccountId, onBack, initialChainId, initialTick, initialFromAddress, reopen }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const { settings } = useSettings();
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || reopen?.chainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    // A reopen pins SOURCE to the creator: only the address that opened the
    // first dispenser on an address may open another there (origin standing,
    // dispenser.md Rules c), so the auto-picked funding address would be
    // refused on chain whenever the dispenser address is not SOURCE itself.
    const pinnedFromAddress = initialFromAddress || reopen?.source;
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    // §16: the fresh role='dispenser' address used as GET_ADDRESS.
    // Derived once per (chain, account) at review time, so an abandoned
    // form consumes no dispenser index.
    const [dispenserGetAddress, setDispenserGetAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [derivingGetAddress, setDerivingGetAddress] = useState(false);

    const [ticker, setTicker] = useState(initialTick || reopen?.tick || '');
    const giveTokenInfo = useTokenInfo({ chainId, tick: ticker, skip: !ticker.trim() });
    // PC-26: dispenses carry no gated-key handoff; warn when the
    // dispensed token has gated content.
    const gatedGiveNotice = useGatedTickNotice({ messaging, chainId, tick: ticker });
    const [giveAmount, setGiveAmount] = useState(reopen?.giveAmount || '');
    const [escrow, setEscrow] = useState(reopen?.escrow || '');
    const [triggerPrice, setTriggerPrice] = useState(reopen?.triggerPrice || '');
    const [oracleAddress, setOracleAddress] = useState(reopen?.oracleAddress || '');
    const [fiatCode, setFiatCode] = useState(reopen?.fiatCode || '');
    const [fiatAmount, setFiatAmount] = useState(reopen?.fiatAmount || '');
    // Fiat and oracle terms live under Dispenser terms (Preview); a reopen that carries them
    // opens it, or the prefilled pricing would be invisible.
    const [showAdvanced, setShowAdvanced] = useState(Boolean(reopen?.fiatCode || reopen?.oracleAddress));
    // PC-20: the rest of the DISPENSER v0 field set. payWith 'token' opens
    // a token-priced lane (GET_TICK/GET_AMOUNT) instead of the native-coin
    // lane; EXPIRATION + allow/block lists complete the field set.
    const [payWith, setPayWith] = useState(/** @type {'coin' | 'token'} */ (reopen?.payWith === 'token' ? 'token' : 'coin'));
    const [getTick, setGetTick] = useState(reopen?.getTick || '');
    const paymentTokenInfo = useTokenInfo({
        chainId,
        tick: getTick,
        skip: payWith !== 'token' || !getTick.trim(),
    });
    const [getTokenAmount, setGetTokenAmount] = useState(reopen?.getTokenAmount || '');
    // Every form starts on 3 months, a reopen included: the indexer fills a concrete
    // EXPIRATION into every dispenser, so a reopened one's expiration is usually the old default
    // window's leftover deadline, not a time its creator chose. The presets fill expInput, which
    // Expires shows; 'default' keeps it empty, since it sends no EXPIRATION.
    const [expMode, setExpMode] = useState(/** @type {'default' | '6m' | '9m' | '1y' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [allowListIdx, setAllowListIdx] = useState(reopen?.allowList || '');
    const [blockListIdx, setBlockListIdx] = useState(reopen?.blockList || '');
    // Member counts of the picked lists, shown in the list fields when the picker knows them.
    const [allowListCount, setAllowListCount] = useState(/** @type {number | null} */ (null));
    const [blockListCount, setBlockListCount] = useState(/** @type {number | null} */ (null));
    // The picked lists' names, so the fields show a name (G114).
    const [allowListPick, setAllowListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [blockListPick, setBlockListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    // SOURCE address's balance of `ticker` (coin-scale string), backing
    // the escrow AmountField's Max button + "available" footer. Null
    // while unresolved or when no ticker is entered.
    const [sourceTickBalance, setSourceTickBalance] = useState(
        /** @type {string | null} */ (null),
    );
    const [password, setPassword] = useState('');
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);

    // §16 extension: where the dispenser itself lives (GET_ADDRESS).
    //   'new'      derive a fresh dispenser address at review (default)
    //   'current'  open on the active/current address (GET_ADDRESS omitted
    //              when it equals SOURCE; protocol defaults to SOURCE)
    //   'existing' reuse an address that already exists: one picked from
    //              the wallet's own list, or a reopened dispenser's address
    //   'other'    any address on the chain, typed or pasted; the chain
    //              accepts it only under the rules checked by outsideVerdict
    const [addressMode, setAddressMode] = useState(
        /** @type {'new' | 'current' | 'existing' | 'other'} */ (reopen?.dispenserAddress ? 'existing' : 'new'),
    );
    const [existingAddressId, setExistingAddressId] = useState(
        /** @type {string | null} */ (reopen?.dispenserAddress ? REOPEN_ADDRESS_ID : null),
    );
    const [outsideAddress, setOutsideAddress] = useState('');
    const outsideTrimmed = outsideAddress.trim();
    const [addressPickerOpen, setAddressPickerOpen] = useState(false);
    // Picker's "New dispenser address" row: generates immediately (same
    // flow as Add addresses with Purpose=Dispenser); guards double-taps.
    const [pickerGenerating, setPickerGenerating] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    // Source (SOURCE) picker: the QR icon on the Source field opens the
    // wallet's own address list. A manual pick pins the source: the active-address /
    // best-token-holder auto-selection effects stand down until the chain
    // changes.
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const manualSourceRef = useRef(false);
    // "Buyers pay with" is the Get side's asset picker page (native coin or
    // any token on this chain).
    const [payPickerOpen, setPayPickerOpen] = useState(false);
    // The Fiat currency field's picker page (G122).
    const [fiatPickerOpen, setFiatPickerOpen] = useState(false);
    // The Quick | Full view and section open state live above every early
    // return, so pickers and the confirm screen never reset them. Only
    // Dispenser starts open (terms too, on a reopen with fiat or oracle terms).
    const giveGetView = useGiveGetView('dispenser', {
        sections: {
            from: false,
            dispenser: true,
            options: Boolean(reopen?.fiatCode || reopen?.oracleAddress),
            lists: false,
            fee: false,
        },
    });

    // Network fee: Low / Normal / Fast / Custom via FeeSelector. Mirrors
    // SwapForm / ComposeMessage; `feePerKb` prices the broadcast.
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

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    // The form error standard: Review validates every field into one map keyed by field
    // id, the notice at the top lists the problems, each failing field is outlined, and a
    // field drops its own entry when it changes. 'form' holds a failure that names no field
    // (the network refusing); 'form:...' keys are problems with no field of their own.
    const formErrors = useFormErrors();
    const [validationAttempt, setValidationAttempt] = useState(0);
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const reviewInFlightRef = useRef(false);
    const submitInFlightRef = useRef(false);
    const routeIdentityRef = useRef('');
    routeIdentityRef.current = `${walletId}\u0000${activeAccountId || ''}\u0000${chainId || ''}`;

    // A value the code sets (Max, a picker, a restored draft, a switch turning a lane on or
    // off) fires no field change handler, so each field's entry leaves here when its value
    // moves. Only the entries of the fields that changed go; the rest stay until fixed.
    const watchedValues = {
        'form:source': `${chainId}|${fromAddressId}`,
        'dispenser-token': ticker,
        'dispenser-give': giveAmount,
        'dispenser-escrow': escrow,
        'dispenser-payment-token': `${payWith}|${getTick}`,
        'dispenser-payment-amount': `${payWith}|${getTokenAmount}`,
        'dispenser-trigger-price': `${payWith}|${triggerPrice}`,
        'dispenser-oracle': oracleAddress,
        'dispenser-fiat-amount': fiatAmount,
        'dispenser-fiat-code': fiatCode,
        'dispenser-expiration': `${expMode}|${expInput}`,
        'dispenser-address': `${addressMode}|${existingAddressId}|${outsideAddress}`,
        'form:lists': `${allowListIdx}|${blockListIdx}`,
    };
    const watchedRef = useRef(watchedValues);
    const feePickRef = useRef(feePick);
    const payFeeRef = useRef(payFeeInNativeCoin);
    const clearFormError = formErrors.clear;
    useEffect(() => {
        let changed = false;
        for (const [id, value] of Object.entries(watchedValues)) {
            if (watchedRef.current[id] !== value) { clearFormError(id); changed = true; }
        }
        if (feePickRef.current !== feePick || payFeeRef.current !== payFeeInNativeCoin) {
            clearFormError('form:fee');
            changed = true;
        }
        feePickRef.current = feePick;
        payFeeRef.current = payFeeInNativeCoin;
        if (changed) clearFormError('form');
        watchedRef.current = watchedValues;
    });

    // A Create refusal links to its field by id. The Quick cards
    // mount none of those ids but the escrow's, so a refusal naming any other
    // field opens Full with that field's section open; in Full a closed
    // section opens. Either way the notice's link lands on a visible field.
    useEffect(() => {
        if (!formErrors.attempt) return;
        const ids = Object.keys(formErrors.errors).filter((id) => DISPENSER_ERROR_SECTION[id]);
        for (const id of ids) {
            const section = DISPENSER_ERROR_SECTION[id];
            if (giveGetView.view === 'quick') {
                // The escrow sits in the Quick card, so its section opens in place.
                if (id === 'dispenser-escrow') giveGetView.setSectionOpen('dispenser', true);
                else giveGetView.openOptions(section);
            } else if (!giveGetView.sections[section]) {
                giveGetView.setSectionOpen(section, true);
            }
        }
    }, [formErrors.attempt]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cluster P FOLLOWUP 5: form-draft persistence. Persists every
    // user-visible composition field (chain / source / give terms /
    // advanced fields). Password stays in component state.
    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draftNetwork = settings ? getActiveNetwork(settings) : null;
    const draft = useFormDraft({ view: 'dispenser', walletId, network: draftNetwork, ttlMs: formDraftTtlMs });
    // A stored draft waits for an explicit Restore. A fresh form starts
    // saving immediately so an auto-lock unmount cannot erase typed values.
    const [draftPending, setDraftPending] = useState(() => !hasDispenserDraft(draft.load(), initialTick));
    // Settings resolve after the first render; once the network is known a draft
    // from another network reads as absent, so the form saves from then on.
    useEffect(() => {
        if (draftNetwork && !hasDispenserDraft(draft.load(), initialTick)) setDraftPending(true);
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
        if (!hasDispenserDraft({
            ticker, giveAmount, escrow, triggerPrice, oracleAddress, fiatAmount,
            getTick, getTokenAmount, expInput, allowListIdx, blockListIdx, outsideAddress,
        }, initialTick)) {
            draft.clear();
            return;
        }
        draft.save({
            chainId, fromAddressId, ticker, giveAmount, escrow,
            triggerPrice, oracleAddress, fiatCode, fiatAmount,
            showAdvanced, payWith, getTick, getTokenAmount,
            expMode, expInput, allowListIdx, blockListIdx,
            feePick, payFeeInNativeCoin, addressMode, existingAddressId, outsideAddress,
        });
    }, [
        stage, draftPending, draft,
        chainId, fromAddressId, ticker, giveAmount, escrow,
        triggerPrice, oracleAddress, fiatCode, fiatAmount,
        showAdvanced, payWith, getTick, getTokenAmount,
        expMode, expInput, allowListIdx, blockListIdx,
        feePick, payFeeInNativeCoin, addressMode, existingAddressId, outsideAddress,
    ]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(true); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.fromAddressId === 'string') setFromAddressId(v.fromAddressId);
        if (typeof v.ticker === 'string') setTicker(v.ticker);
        if (typeof v.giveAmount === 'string') setGiveAmount(v.giveAmount);
        if (typeof v.escrow === 'string') setEscrow(v.escrow);
        if (typeof v.triggerPrice === 'string') setTriggerPrice(v.triggerPrice);
        if (typeof v.oracleAddress === 'string') setOracleAddress(v.oracleAddress);
        if (typeof v.fiatCode === 'string') setFiatCode(v.fiatCode);
        if (typeof v.fiatAmount === 'string') setFiatAmount(v.fiatAmount);
        if (typeof v.showAdvanced === 'boolean') setShowAdvanced(v.showAdvanced);
        // A draft that had fiat or oracle terms open reopens the
        // Dispenser terms section, where those fields live.
        if (v.showAdvanced === true) giveGetView.setSectionOpen('options', true);
        if (v.payWith === 'coin' || v.payWith === 'token') setPayWith(v.payWith);
        if (typeof v.getTick === 'string') setGetTick(v.getTick);
        if (typeof v.getTokenAmount === 'string') setGetTokenAmount(v.getTokenAmount);
        if (EXPIRATION_MODES.includes(v.expMode)) setExpMode(v.expMode);
        if (typeof v.expInput === 'string') setExpInput(v.expInput);
        if (typeof v.allowListIdx === 'string') setAllowListIdx(v.allowListIdx);
        if (typeof v.blockListIdx === 'string') setBlockListIdx(v.blockListIdx);
        if (v.feePick && ['low', 'normal', 'fast', 'custom'].includes(v.feePick.mode)) setFeePick(v.feePick);
        if (typeof v.payFeeInNativeCoin === 'boolean') setPayFeeInNativeCoin(v.payFeeInNativeCoin);
        if (v.addressMode === 'new' || v.addressMode === 'current' || v.addressMode === 'existing'
            || v.addressMode === 'other') {
            setAddressMode(v.addressMode);
        }
        if (typeof v.existingAddressId === 'string') setExistingAddressId(v.existingAddressId);
        if (typeof v.outsideAddress === 'string') setOutsideAddress(v.outsideAddress);
        setDraftPending(true);
    }, [draft]);
    const discardSavedDraft = useCallback(() => {
        draft.clear();
        setDraftPending(true);
    }, [draft]);
    const hasRealInput = useMemo(() => (
        [
            ticker, giveAmount, escrow, getTick, getTokenAmount, triggerPrice,
            oracleAddress, fiatCode, fiatAmount, expInput, allowListIdx,
            blockListIdx, outsideAddress, password,
        ].some((value) => String(value || '').trim().length > 0)
        || payWith !== 'coin'
        || expMode !== 'default'
        || addressMode !== 'new'
    ), [
        ticker, giveAmount, escrow, getTick, getTokenAmount, triggerPrice,
        oracleAddress, fiatCode, fiatAmount, expInput, allowListIdx,
        blockListIdx, outsideAddress, password, payWith, expMode, addressMode,
    ]);
    const leaveGuard = useFormLeaveGuard({
        dirty: stage !== 'done' && hasRealInput,
        submitting: stage === 'submitting',
        signedUnbroadcast: stage === 'done' && result?.queued === true && result?.unsaved === true,
        onLeave: onBack,
        onDiscard: discardDraft,
    });

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default).
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId, activeAccountId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId, activeAccountId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any network yet. Use Receive to generate one before opening a dispenser.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key opened every dispenser on the wallet's OLDEST
                // chain forever. Open on the last-used chain instead, behind
                // a caller-seeded one (a token context) and ahead of the
                // first-key fallback, exactly as Send and Swap do.
                if (!lockedToken) {
                    setChainId((prev) => pickDefaultChainId(byChain, {
                        explicitChainId: prev,
                        settings,
                    }));
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId]);

    // §16: drop a previously derived dispenser sub-address when the chain
    // or account changes so review derives a fresh one for the selection.
    useEffect(() => {
        setDispenserGetAddress(null);
    }, [chainId, activeAccountId]);

    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const all = addressesByChain[chainId] || [];
        if (pinnedFromAddress) {
            const match = all.find((a) => a.address === pinnedFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        if (manualSourceRef.current) {
            if (all.some((a) => a.id === fromAddressId)) return;
            manualSourceRef.current = false;
        }
        // Same default as Send and every other spend-from-balance form: the
        // chain's active address, else the newest HD external. role='dispenser'
        // excluded: a freshly generated dispenser address is the newest external
        // index, and SOURCE must stay a personal funding address.
        const funding = all.filter((a) => a.role !== 'dispenser');
        setFromAddressId(preferredSourceId(funding, activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain, pinnedFromAddress]);

    // Balance-resolve SOURCE: the active-address default above is a guess
    // at where the token inventory lives. Once a ticker is entered, prefer
    // the account address (on the selected chain) that actually holds the
    // most of that tick, since SOURCE is what the escrow debits. Debounced
    // so typing the ticker doesn't fan out a balance query per keystroke;
    // any failure leaves the default untouched. Skipped when
    // the source is pinned by an incoming `initialFromAddress` or a reopen.
    useEffect(() => {
        const tick = ticker.trim();
        if (pinnedFromAddress || manualSourceRef.current) return undefined;
        if (!chainId || !addressesByChain || !tick) return undefined;
        if (typeof messaging.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.getWalletBalances(walletId, activeAccountId)
                .then((byChain) => {
                    if (cancelled || !byChain) return;
                    const entries = byChain[chainId] || [];
                    let bestAddress = null;
                    let bestAmount = '0';
                    for (const entry of entries) {
                        if (!entry || !entry.balances) continue;
                        const rows = decoderLib.balancesFromSdk(entry.balances) || [];
                        const match = rows.find((b) => String(b.tick) === tick);
                        const amount = match ? String(match.amount) : '0';
                        if (compareDecimalStrings(amount, bestAmount) === 1) {
                            bestAmount = amount;
                            bestAddress = entry.address;
                        }
                    }
                    if (bestAddress) {
                        const holder = (addressesByChain[chainId] || [])
                            .find((a) => a.address === bestAddress);
                        if (holder) setFromAddressId(holder.id);
                    }
                })
                .catch(() => { /* keep the active-address default on failure */ });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [ticker, chainId, addressesByChain, activeAccountId, walletId, messaging, pinnedFromAddress]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const feeFiatFormat = useFeeFiat({
        chainId: descriptor?.id,
        chainCoin: descriptor?.coin,
        nativeTicker: coinTicker,
        settings,
    });
    const { formatNativeFee, formatProtocolFee } = feeFiatFormat;
    const feeFiat = feeEstimate ? formatNativeFee(feeEstimate.coinAmount) : null;
    const priceNotes = useDispenserPriceFloor({
        coin: descriptor?.coin, coinTicker, payWith, triggerPrice, giveAmount, fiatCode, fiatAmount, oracleAddress,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
    });
    // Retract the Review refusal once the price clears the floor; any other
    // error in the slot is left alone.
    const triggerRefusal = formErrors.errors['dispenser-trigger-price'];
    useEffect(() => {
        if (!priceNotes.block && triggerRefusal === PRICE_BELOW_FLOOR_ERROR) clearFormError('dispenser-trigger-price');
    }, [priceNotes.block, triggerRefusal, clearFormError]);
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    // The dispenser address for mode 'existing'. Any wallet address qualifies,
    // not only ones set aside with role='dispenser': the protocol does not
    // care how the wallet labelled it. A reopened dispenser's address may not
    // be in the wallet at all (a delegated GET_ADDRESS), and the creator may
    // still open there by origin standing, so it resolves to a bare record
    // rather than falling back to a new address.
    const reopenAddress = reopen?.chainId === chainId ? reopen?.dispenserAddress || '' : '';
    const existingAddress = useMemo(() => {
        if (!chainId || !addressesByChain) return null;
        const all = addressesByChain[chainId] || [];
        const byId = all.find((a) => a.id === existingAddressId);
        if (byId) return byId;
        if (existingAddressId !== REOPEN_ADDRESS_ID || !reopenAddress) return null;
        return all.find((a) => a.address === reopenAddress) || { id: REOPEN_ADDRESS_ID, address: reopenAddress };
    }, [chainId, addressesByChain, existingAddressId, reopenAddress]);
    // Chain switch invalidates an 'existing' pick; fall back to 'new'. Not
    // before the address list loads: a reopen starts in 'existing', and
    // every pick is unresolvable until then.
    useEffect(() => {
        if (addressMode === 'existing' && addressesByChain && !existingAddress) {
            setAddressMode('new');
            setExistingAddressId(null);
        }
    }, [addressMode, addressesByChain, existingAddress]);

    // Effective SOURCE for signing / balance checks / review display. The
    // Source field (own-address picker) writes fromAddressId directly, so the
    // source can be any wallet address, including a dispenser address.
    const sourceAddress = fromAddress;

    // D-161: the address the CHAIN will check against the allow-list, which is
    // not always the one in the Source field. Mirrors the GET_ADDRESS rule in
    // `actionParams` below, including its default: mode 'current' omits the
    // param and the protocol falls back to SOURCE. Mode 'new' has no address
    // until the preview derives one, and SOURCE is no stand-in for it: the
    // dispenser opens there only on a host build that cannot derive.
    const canDeriveGetAddress = typeof messaging.generateDispenserAddress === 'function';
    const gateAddress = addressMode === 'new'
        ? (dispenserGetAddress?.address || (canDeriveGetAddress ? '' : sourceAddress?.address || ''))
        : addressMode === 'existing'
            ? (existingAddress?.address || sourceAddress?.address || '')
            : addressMode === 'other'
                ? (outsideTrimmed || sourceAddress?.address || '')
                : (sourceAddress?.address || '');

    // Mode 'other': the address is typed, so check its format for this chain,
    // then ask whether the chain will let SOURCE open a dispenser there. The
    // reads are debounced like the balance lookups, and a verdict is used only
    // for the exact (chain, address, source) it was read for.
    const outsideFormatError = addressMode === 'other' ? outsideAddressError(outsideTrimmed, descriptor) : null;
    const outsideKey = addressMode === 'other' && outsideTrimmed && !outsideFormatError
        && chainId && sourceAddress?.address
        ? `${chainId}|${outsideTrimmed}|${sourceAddress.address}`
        : '';
    const [outsideStanding, setOutsideStanding] = useState(
        /** @type {{ key: string, verdict: any }} */ ({ key: '', verdict: null }),
    );
    useEffect(() => {
        if (!outsideKey) return undefined;
        const source = sourceAddress.address;
        // Opening on SOURCE itself needs no reads.
        if (outsideTrimmed === source) {
            setOutsideStanding({ key: outsideKey, verdict: dispenserAddressVerdict({ address: outsideTrimmed, source }) });
            return undefined;
        }
        let live = true;
        const timer = setTimeout(() => {
            readDispenserAddressStanding({ messaging, chainId, address: outsideTrimmed, source })
                .catch(() => ({ preference: null, seen: null, origin: null }))
                .then((standing) => {
                    if (!live) return;
                    setOutsideStanding({
                        key: outsideKey,
                        verdict: dispenserAddressVerdict({ address: outsideTrimmed, source, ...standing }),
                    });
                });
        }, 400);
        return () => { live = false; clearTimeout(timer); };
    }, [outsideKey, messaging]);
    const outsideVerdict = outsideKey && outsideStanding.key === outsideKey ? outsideStanding.verdict : null;
    const outsideVerdictLoading = Boolean(outsideKey) && !outsideVerdict;
    // Create waits for the verdict and stays off on a refusal: a refused
    // create still pays the network fee and opens nothing.
    const outsideBlocked = addressMode === 'other' && (outsideVerdictLoading || outsideVerdict?.allowed === false);

    // D-161: an allow-list gates the dispenser's OWN pay-to address as well as
    // the buyer, so a list of customers alone refuses every sale - silently,
    // and at the buyer's expense. The members are already one read away (the
    // list picker fetches them to show a count); this asks them a different
    // question. Best-effort by design: an unreadable list produces no warning
    // rather than one the user cannot act on.
    const [allowListMembers, setAllowListMembers] = useState(
        /** @type {string[] | null} */ (null),
    );
    useEffect(() => {
        setAllowListMembers(null);
        if (!allowListIdx || !chainId) return undefined;
        if (typeof messaging.getListByActionIndex !== 'function') return undefined; // older host build
        let live = true;
        messaging.getListByActionIndex({ chainId, actionIndex: allowListIdx })
            .then((detail) => { if (live) setAllowListMembers(listMembers(detail)); })
            .catch(() => { /* best-effort: no warning beats a wrong one */ });
        return () => { live = false; };
    }, [allowListIdx, chainId, messaging]);
    const allowListVerdict = dispenserCreateAllowListVerdict({
        members: allowListMembers,
        getAddress: gateAddress,
        sourceAddress: sourceAddress?.address,
        newAddressPending: addressMode === 'new' && !dispenserGetAddress && canDeriveGetAddress,
    });
    const allowListSelfWarning = allowListVerdict.barred
        ? ownerOffAllowListMessage(gateAddress || null, { createFirst: allowListVerdict.createFirst })
        : null;
    // Scope of the unused-address memory: one per wallet, account and chain.
    const dispenserAddressScope = { walletId, accountId: activeAccountId, chainId: chainId || '' };
    const allowListWarningNode = allowListSelfWarning ? (
        <FieldNote variant="warning" role="alert">{allowListSelfWarning}</FieldNote>
    ) : null;
    // Confirm-time reminder for an outside dispenser address: buyers pay that
    // address, not SOURCE, and the escrow goes back to whichever of the two
    // closes the dispenser (dispenser.md Rules), which may not be this wallet.
    const outsideAddressNote = addressMode === 'other' && outsideTrimmed
        && outsideVerdict?.allowed && outsideVerdict.kind !== 'self' ? (
            <FieldNote variant="warning" role={null} testId="outside-address-note">
                <p>
                    Dispenser address: <AddressText address={outsideTrimmed} truncate={false} />
                </p>
                <p>
                    Buyers&apos; payments go to this address, not to your source. Either this
                    address or your source can close the dispenser, and the unsold escrow
                    returns to whichever one closes it.
                </p>
            </FieldNote>
        ) : null;

    // Resolve the SOURCE address's balance of the entered ticker for the
    // escrow AmountField (Max + "available"). Debounced on the ticker for
    // the same reason as the source-resolve effect above.
    useEffect(() => {
        const tick = ticker.trim();
        setSourceTickBalance(null);
        if (!chainId || !sourceAddress || !tick) return undefined;
        if (typeof messaging.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.getWalletBalances(walletId, activeAccountId)
                .then((byChain) => {
                    if (cancelled || !byChain) return;
                    const entries = byChain[chainId] || [];
                    const entry = entries.find((e) => e && e.address === sourceAddress.address);
                    const rows = entry ? decoderLib.balancesFromSdk(entry.balances) || [] : [];
                    const match = rows.find((b) => String(b.tick) === tick);
                    setSourceTickBalance(match ? String(match.amount) : '0');
                })
                .catch(() => { /* footer just stays empty on failure */ });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [ticker, chainId, sourceAddress, activeAccountId, walletId, messaging]);

    const fillsEstimate = useMemo(() => {
        return decimalQuotientFloor(escrow, giveAmount);
    }, [giveAmount, escrow]);

    const summaryLine = useMemo(() => {
        const tick = ticker.trim() || 'TOKEN';
        // The line is read, not typed: its figures group ("250,000").
        const shown = (value) => {
            const text = String(value ?? '').trim();
            return text ? (formatWithThousands(text) || text) : '?';
        };
        const per = shown(giveAmount);
        const esc = shown(escrow);
        if (payWith === 'token') {
            const paymentTick = getTick.trim() || 'TOKEN';
            const paymentAmount = shown(getTokenAmount);
            const fillsNote = fillsEstimate !== null ? ` The dispenser holds about ${shown(fillsEstimate)} fills.` : '';
            return `You will lock ${esc} ${tick}. Each time someone sends ${paymentAmount} ${paymentTick}, they will receive ${per} ${tick}.${fillsNote}`;
        }
        if (oracleAddress.trim() && fiatCode) {
            // The oracle's usage fee, if it charges one, is a real payment leaving this
            // transaction, so say so here rather than letting it appear only as
            // an unexplained output on the confirm screen.
            return `You will lock ${esc} ${tick}. Each fill sends ${per} ${tick} at the oracle-priced ${fiatCode} rate. If this oracle charges a usage fee, you pay it once, now, from this transaction.`;
        }
        if (fiatAmount.trim() && fiatCode) {
            return `You will lock ${esc} ${tick}. Each fill sends ${per} ${tick} when someone pays ${shown(fiatAmount)} ${fiatCode}.`;
        }
        const trig = shown(triggerPrice);
        const coin = coinTicker || 'coin';
        const fillsNote = fillsEstimate !== null ? ` The dispenser holds about ${shown(fillsEstimate)} fills.` : '';
        return `You will lock ${esc} ${tick}. Each time someone sends ${trig} ${coin}, they will receive ${per} ${tick}.${fillsNote}`;
    }, [ticker, giveAmount, escrow, payWith, getTick, getTokenAmount, triggerPrice, oracleAddress, fiatCode, fiatAmount, coinTicker, fillsEstimate]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0' };
        const tick = ticker.trim();
        const ga = giveAmount.trim();
        const esc = escrow.trim();
        const trig = triggerPrice.trim();
        const oracle = oracleAddress.trim();
        const fa = fiatAmount.trim();

        if (tick) p.GIVE_TICK = tick;
        if (coinTicker) p.GIVE_COIN = coinTicker;
        if (ga) p.GIVE_AMOUNT = ga;
        if (esc) p.GIVE_ESCROW = esc;

        // Coin-paid lane: GET_COIN = chain coin, GET_TICK empty.
        if (coinTicker) p.GET_COIN = coinTicker;

        // §16: GET_ADDRESS by address mode. 'new' = the fresh dedicated
        // dispenser address derived at review; 'existing' = a reused
        // role='dispenser' address; 'current' omits GET_ADDRESS so the
        // protocol defaults to SOURCE. SOURCE stays the token-holding
        // signer and the escrow debits from it in all three modes.
        if (addressMode === 'new' && dispenserGetAddress?.address) {
            p.GET_ADDRESS = dispenserGetAddress.address;
        } else if (addressMode === 'existing' && existingAddress?.address
            && existingAddress.address !== sourceAddress?.address) {
            p.GET_ADDRESS = existingAddress.address;
        } else if (addressMode === 'other' && outsideTrimmed && outsideTrimmed !== sourceAddress?.address) {
            // An outside address: SOURCE still signs and escrows, buyers pay here.
            p.GET_ADDRESS = outsideTrimmed;
        }

        if (payWith === 'token') {
            // PC-20 token-priced lane: buyers pay a fixed amount of a TOKEN
            // (GET_TICK) rather than the native coin. Oracle/fiat pricing is
            // coin-only and does not apply here.
            if (getTick.trim()) p.GET_TICK = getTick.trim();
            if (getTokenAmount.trim()) p.GET_AMOUNT = getTokenAmount.trim();
        } else if (oracle) {
            // Oracle pricing: validator path (fiatAmount + code) or user-
            // oracle path (oracle + code, fiatAmount empty). GET_AMOUNT
            // is 0 per DISPENSER.md example 4/5 because the
            // effective coin price is derived dynamically.
            p.GET_AMOUNT = '0';
            p.ORACLE_ADDRESS = oracle;
            if (fiatCode) p.FIAT_CODE = fiatCode;
            if (fa) p.FIAT_AMOUNT = fa;
        } else if (fiatCode && fa) {
            // Validator FIAT path: no oracle, but fiat code + amount set.
            p.GET_AMOUNT = trig || '0';
            p.FIAT_CODE = fiatCode;
            p.FIAT_AMOUNT = fa;
        } else {
            // Plain coin-paid dispenser.
            if (trig) p.GET_AMOUNT = trig;
        }

        // PC-20: EXPIRATION (Unix wall-clock, 'default' omits it) + the
        // allow/block access lists.
        const expiration = expirationParam(expMode, expInput);
        if (expiration) p.EXPIRATION = expiration;
        if (allowListIdx) p.ALLOW_LIST = allowListIdx;
        if (blockListIdx) p.BLOCK_LIST = blockListIdx;

        return p;
    }, [ticker, giveAmount, escrow, triggerPrice, oracleAddress, fiatCode, fiatAmount, coinTicker, dispenserGetAddress, addressMode, existingAddress, outsideTrimmed, sourceAddress, payWith, getTick, getTokenAmount, expMode, expInput, allowListIdx, blockListIdx]);
    const quoteActionData = useMemo(() => {
        const give = giveAmount.trim();
        const escrowAmount = escrow.trim();
        const oracle = oracleAddress.trim();
        const fiat = fiatAmount.trim();
        const trigger = triggerPrice.trim();
        const addressReady = addressMode === 'current'
            || (addressMode === 'new' && (Boolean(dispenserGetAddress?.address) || !canDeriveGetAddress))
            || (addressMode === 'existing' && Boolean(existingAddress))
            || (addressMode === 'other' && Boolean(outsideTrimmed)
                && !outsideFormatError && outsideVerdict?.allowed === true);
        const paymentReady = payWith === 'token'
            ? Boolean(getTick.trim())
                && !tickerReferenceError(getTick, { noun: 'Payment token' })
                && isPositiveDecimal(getTokenAmount)
                && !tokenAmountPrecisionError(getTokenAmount, {
                    divisibility: paymentTokenInfo?.divisibility,
                    tick: getTick,
                    noun: 'Payment amount',
                })
            : Boolean(oracle || fiat || trigger)
                && (!oracle || (!outsideAddressError(oracle, descriptor) && Boolean(fiatCode)))
                && (!fiat || (Boolean(fiatCode) && isValidFiatAmount(fiat)))
                && !(fiatCode && !oracle && !fiat)
                && (Boolean(oracle) || !trigger || (isPositiveDecimal(trigger)
                    && !tokenAmountPrecisionError(trigger, {
                        divisibility: descriptor?.nativeDecimals ?? 8,
                        tick: coinTicker,
                        noun: 'Trigger price',
                    })))
                && !priceNotes.block;
        const ready = Boolean(chainId && sourceAddress?.address && ticker.trim())
            && !tickerReferenceError(ticker)
            && isPositiveDecimal(give)
            && !tokenAmountPrecisionError(give, {
                divisibility: giveTokenInfo?.divisibility,
                tick: ticker,
                noun: 'Per-fill give amount',
            })
            && isPositiveDecimal(escrowAmount)
            && !tokenAmountPrecisionError(escrowAmount, {
                divisibility: giveTokenInfo?.divisibility,
                tick: ticker,
                noun: 'Escrow amount',
            })
            && compareDecimalStrings(escrowAmount, give) !== -1
            && !exceedsBalance(escrowAmount, sourceTickBalance)
            && paymentReady
            && !expirationValidationError(expMode, expInput)
            && !listInBothSlots({ allowList: allowListIdx, blockList: blockListIdx })
            && addressReady;
        return ready ? { action: 'DISPENSER', params: actionParams } : null;
    }, [giveAmount, escrow, oracleAddress, fiatAmount, triggerPrice, expMode, expInput,
        addressMode, dispenserGetAddress, canDeriveGetAddress, existingAddress, outsideTrimmed,
        outsideFormatError, outsideVerdict, payWith, getTick, getTokenAmount, paymentTokenInfo,
        descriptor, fiatCode, coinTicker, priceNotes.block, chainId, sourceAddress, ticker,
        giveTokenInfo, sourceTickBalance, allowListIdx, blockListIdx, actionParams]);
    const { quote: protocolFeeQuote, pending: protocolFeePending, waiting: protocolFeeWaiting } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: sourceAddress?.address,
        actionData: quoteActionData,
    });

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return groupDecodedAmounts(decoderLib.decodeAction({
            action: 'DISPENSER',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        }));
    }, [stage, actionParams, chainId]);

    async function handleReview(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        setValidationAttempt((attempt) => attempt + 1);
        if (reviewInFlightRef.current || derivingGetAddress || actionConfirm.composing) return;
        // Every check runs, one message per field (its first failing rule), so the notice
        // at the top lists everything to fix at once. Keys are field ids; 'form:' keys
        // have no field of their own.
        const problems = {};
        const note = (key, message) => { if (message && !problems[key]) problems[key] = message; };
        if (!chainId || !fromAddress) note('form:source', 'Pick a source address first.');
        // A refused custom fee opens the Network fee section that holds it. A stop with no
        // message is one the Fees field already shows itself; it still holds Create.
        if (feeStop) {
            giveGetView.setSectionOpen('fee', true);
            note('form:fee', feeStop.formError);
        }
        note('dispenser-token', !ticker.trim() ? 'Token ticker is required.' : tickerReferenceError(ticker));
        const ga = giveAmount.trim();
        note('dispenser-give', !isPositiveDecimal(ga)
            ? 'Per-fill give amount must be a positive number.'
            : tokenAmountPrecisionError(ga, {
                divisibility: giveTokenInfo?.divisibility,
                tick: ticker,
                noun: 'Per-fill give amount',
            }));
        const esc = escrow.trim();
        if (!isPositiveDecimal(esc)) {
            note('dispenser-escrow', 'Escrow amount must be a positive number.');
        } else {
            note('dispenser-escrow', tokenAmountPrecisionError(esc, {
                divisibility: giveTokenInfo?.divisibility,
                tick: ticker,
                noun: 'Escrow amount',
            }));
            if (isPositiveDecimal(ga) && compareDecimalStrings(esc, ga) === -1) {
                note('dispenser-escrow', 'Escrow is smaller than a single fill; the dispenser would never dispense.');
            }
            if (exceedsBalance(esc, sourceTickBalance)) {
                note(
                    'dispenser-escrow',
                    `This address holds only ${formatWithThousands(sourceTickBalance)} ${ticker.trim()}. `
                    + 'Enter an escrow amount at or below that balance.',
                );
            }
        }
        const oracle = oracleAddress.trim();
        const fa = fiatAmount.trim();
        const trig = triggerPrice.trim();
        if (payWith === 'token') {
            note('dispenser-payment-token', !getTick.trim()
                ? 'Enter the token buyers pay with.'
                : tickerReferenceError(getTick, { noun: 'Payment token' }));
            note('dispenser-payment-amount', !isPositiveDecimal(getTokenAmount)
                ? 'Enter a positive token amount buyers pay per fill.'
                : tokenAmountPrecisionError(getTokenAmount, {
                    divisibility: paymentTokenInfo?.divisibility,
                    tick: getTick,
                    noun: 'Payment amount',
                }));
        } else {
            if (!oracle && !fa && !trig) {
                note('dispenser-trigger-price', 'Set a trigger price, or enable fiat / oracle pricing under Dispenser terms.');
            }
            if (oracle) {
                const oracleFormatError = outsideAddressError(oracle, descriptor);
                if (oracleFormatError) note('dispenser-oracle', `Oracle address: ${oracleFormatError}`);
                if (!fiatCode) note('dispenser-fiat-code', 'Oracle pricing needs a fiat currency. Pick one under Dispenser terms.');
            }
            if (fa && !fiatCode) note('dispenser-fiat-code', 'Fiat pricing needs a fiat currency. Pick one under Dispenser terms.');
            if (fiatCode && !oracle && !fa) {
                note('dispenser-fiat-amount', 'Enter a fiat amount, add an oracle address, or set Fiat currency to none.');
            }
            if (fa && !isValidFiatAmount(fa)) {
                note('dispenser-fiat-amount', 'Fiat amount can have at most 2 decimal places, like 12.34 or 3.');
            }
            if (!oracle && trig && !isPositiveDecimal(trig)) {
                note('dispenser-trigger-price', 'Trigger price must be a positive number.');
            }
            if (!oracle && trig) {
                note('dispenser-trigger-price', tokenAmountPrecisionError(trig, {
                    divisibility: descriptor?.nativeDecimals ?? 8,
                    tick: coinTicker,
                    noun: 'Trigger price',
                }));
            }
            if (priceNotes.block) note('dispenser-trigger-price', PRICE_BELOW_FLOOR_ERROR);
        }
        note('dispenser-expiration', expirationValidationError(expMode, expInput));
        if (listInBothSlots({ allowList: allowListIdx, blockList: blockListIdx })) {
            note('form:lists', listInBothSlotsMessage(allowListIdx));
        }
        if (addressMode === 'existing' && !existingAddress) {
            note('dispenser-address', 'Pick an existing dispenser address, or choose a new one.');
        }
        if (addressMode === 'other') {
            // An outside address must be present, well formed, and accepted.
            if (!outsideTrimmed) {
                note('dispenser-address', 'Enter the dispenser address, or pick one of your own.');
            } else if (outsideFormatError) {
                note('dispenser-address', outsideFormatError);
            } else if (!outsideVerdict) {
                note('dispenser-address', 'Still checking whether this address accepts your dispenser.');
            } else if (!outsideVerdict.allowed) {
                note('dispenser-address', outsideVerdict.message);
            }
        }
        if (!formErrors.validate(problems) || feeStop) return;
        reviewInFlightRef.current = true;
        const routeIdentity = routeIdentityRef.current;
        // §16: the dedicated dispenser sub-address (GET_ADDRESS) for mode
        // 'new': the one derived for an earlier unsigned preview while the
        // wallet still holds it, else a fresh derivation, after validation so
        // an invalid form consumes no index. SOURCE (fromAddress) is unchanged.
        // If the wallet build has no derivation handler, fall back to opening
        // on SOURCE.
        //
        // The derived address is threaded into `params` by hand: `actionParams`
        // is memoized for the render this closure came from, and the confirm
        // path below composes in the same tick, before any re-render could
        // fold `dispenserGetAddress` in. Reading the memo here would submit
        // the dispenser self-open and orphan the address just derived.
        let params = actionParams;
        try {
            if (addressMode === 'new' && !dispenserGetAddress && canDeriveGetAddress) {
                setDerivingGetAddress(true);
                const addr = recallUnusedDispenserAddress(dispenserAddressScope, addressesByChain?.[chainId])
                    || await messaging.generateDispenserAddress({
                        walletId,
                        accountId: activeAccountId,
                        chainId,
                    });
                rememberUnusedDispenserAddress(dispenserAddressScope, addr);
                if (routeIdentity !== routeIdentityRef.current || actionParams !== actionParamsRef.current) return;
                setDispenserGetAddress(addr);
                if (addr?.address) params = { ...actionParams, GET_ADDRESS: addr.address };
                setDerivingGetAddress(false);
            }
            if (singleEncode) { await openConfirmScreen(params, routeIdentity); return; }
            if (routeIdentity === routeIdentityRef.current && actionParams === actionParamsRef.current) {
                setStage('review');
            }
        } catch (err) {
            if (routeIdentity === routeIdentityRef.current && actionParams === actionParamsRef.current) {
                formErrors.fail(err?.message || 'Could not derive a dispenser address.');
            }
        } finally {
            setDerivingGetAddress(false);
            reviewInFlightRef.current = false;
        }
    }

    const hw = isHwSource(sourceAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page; hardware +
    // watcher keep the legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: sourceAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'dispenserAction',
        hardware: 'dispenserActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    // `params` is the wire param set to compose AND to sign on Approve; the
    // caller passes it explicitly when it holds a GET_ADDRESS newer than the
    // memoized `actionParams` (see handleReview).
    const actionParamsRef = useRef(actionParams);
    actionParamsRef.current = actionParams;

    async function openConfirmScreen(params = actionParams, routeIdentity = routeIdentityRef.current) {
        const from = {
            address: sourceAddress.address,
            publicKey: sourceAddress.publicKey,
            derivationPath: sourceAddress.derivationPath,
            addressId: sourceAddress.id,
            source: sourceAddress.source,
            signerId: sourceAddress.signerId,
        };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'DISPENSER', params },
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            if (routeIdentity !== routeIdentityRef.current) return;
            setResult(res);
            setPassword('');
            setStage('done');
            forgetUnusedDispenserAddress(dispenserAddressScope, params.GET_ADDRESS);
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            if (routeIdentity !== routeIdentityRef.current) return;
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            formErrors.fail(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: err?.message || 'Dispenser failed.',
            }));
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (submitInFlightRef.current || stage === 'submitting') return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) {
            formErrors.validate({ 'dispenser-password': 'Enter your wallet password.' });
            return;
        }
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        formErrors.reset();
        submitInFlightRef.current = true;
        const routeIdentity = routeIdentityRef.current;
        setStage('submitting');
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: sourceAddress.address,
                    publicKey: sourceAddress.publicKey,
                    derivationPath: sourceAddress.derivationPath,
                    addressId: sourceAddress.id,
                    source: sourceAddress.source,
                    signerId: sourceAddress.signerId,
                },
                params: actionParams,
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'DISPENSER', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (hw) {
                res = await messaging.dispenserActionHw({ ...base, signerId: sourceAddress.signerId });
            } else {
                res = await messaging.dispenserAction({ ...base, password });
            }
            if (routeIdentity !== routeIdentityRef.current) return;
            setResult(res);
            setPassword('');
            setStage('done');
            forgetUnusedDispenserAddress(dispenserAddressScope, actionParams.GET_ADDRESS);
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            if (routeIdentity !== routeIdentityRef.current) return;
            const isBadPassword = err?.name === 'InvalidPasswordError';
            let submitMsg;
            if (isBadPassword) {
                submitMsg = 'Incorrect password.';
            } else {
                submitMsg = submitFailureMessage(err, {
                    chainId,
                    coinTicker,
                    mandatory: nativeFeeMandatory,
                    fallback: err?.message || 'Dispenser creation failed.',
                });
            }
            setSubmitError(submitMsg);
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

        const header = (
        <PageHeader
            nested={stage === 'review'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : leaveGuard.guardedOnBack}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review Dispenser'
                    : 'Create Dispenser'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
            {leaveGuard.confirmation}
        </Screen>
    );

    // The load error, the loading line and the dispenser-opened panel lay out
    // through ListPage inside the Screen, so they keep the template edge and
    // rhythm the form and review stages get from FormPage.
    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={leaveGuard.guardedOnBack}
                />,
            );
        }
        // Signed but not broadcast, so no dispenser is open yet.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={leaveGuard.guardedOnBack} what="dispenser" unsaved={result.unsaved} />);
        }
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>Dispenser opened</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={leaveGuard.guardedOnBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        // Cluster P FOLLOWUP 4: hardware and watcher failures offer Edit
        // because changing form inputs is the recovery path.
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review dispenser"
                onSubmit={handleSubmit}
                errors={formErrors}
                status={(isWatcherMode || hw) && submitError ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: 'Edit', onAction: () => { setSubmitError(null); setStage('form'); } }}
                    >
                        {submitError}
                    </StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        icon={<Icon.SignIcon />}
                        loading={stage === 'submitting'}
                        aria-disabled={!isWatcherMode && hw && hwStatus !== 'available' ? 'true' : undefined}
                    >
                        {isWatcherMode ? 'Create Unsigned Transaction' : 'Sign'}
                    </Button>
                )}
            >
                <p className={styles.summary}>{decoded?.summary}</p>
                <p className={styles.hint}>{summaryLine}</p>
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <>
                            <dt className={styles.detailsLabel}>Network</dt>
                            <dd className={styles.detailsValue}><ChainBadge descriptor={descriptor} size="sm" /></dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Source</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={sourceAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Dispenser address</dt>
                    <dd className={styles.detailsValue}>
                        {addressMode === 'new' && dispenserGetAddress ? (
                            <AddressText address={dispenserGetAddress.address} />
                        ) : addressMode === 'existing' && existingAddress ? (
                            <AddressText address={existingAddress.address} />
                        ) : addressMode === 'other' && outsideTrimmed ? (
                            <AddressText address={outsideTrimmed} />
                        ) : (
                            <AddressText address={fromAddress.address} />
                        )}
                    </dd>
                    {(decoded?.details || []).filter((d) => d.label !== 'Dispenser address').map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                                + (feeFiat ? ` (${feeFiat})` : '')
                            : 'Fee estimate unavailable for this network.'}
                    />
                </dl>
                {payFeeInNativeCoin ? (
                    <FormNotice variant="warning" role="alert">{NATIVE_FEE_WARNING}</FormNotice>
                ) : null}
                {decoded && decoded.warnings.length > 0 ? (
                    <FormNotice variant="warning" role="alert" lines={decoded.warnings} />
                ) : null}
                {outsideAddressNote}
                {allowListSelfWarning ? (
                    <FormNotice variant="warning" role="alert">{allowListSelfWarning}</FormNotice>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        {t('common.watcherBuildsUnsigned')}
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={sourceAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        passwordFieldId="dispenser-password"
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
            </FormPage>,
        );
    }

    // Full-screen dispenser-address picker: the standard own-address
    // selector (same screen as My Addresses / every From field), plus a
    // "New dispenser address" action row that generates a role-tagged
    // dispenser address on the spot (same flow as Add addresses with
    // Purpose=Dispenser) and selects it. Picking the SOURCE address
    // itself maps to mode 'current' (GET_ADDRESS omitted; protocol
    // defaults to SOURCE); any other record maps to mode 'existing'.
    // All other form state stays intact behind it.
    if (addressPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Dispenser Address"
                walletId={walletId}
                accountId={activeAccountId}
                chainId={chainId}
                // The dispenser address lives on the token's network.
                lockNetwork
                pickerActions={[{
                    key: 'new-dispenser-address',
                    label: pickerGenerating ? 'Generating…' : 'New dispenser address',
                    onSelect: async () => {
                        if (pickerGenerating) return;
                        setPickerGenerating(true);
                        try {
                            const rec = await messaging.generateDispenserAddress({
                                walletId, chainId, accountId: activeAccountId,
                            });
                            const byChain = await messaging.getAddressesByChain(walletId, activeAccountId);
                            setAddressesByChain(byChain);
                            setAddressMode('existing');
                            setExistingAddressId(rec.id);
                            setAddressPickerOpen(false);
                        } catch (err) {
                            formErrors.fail(err?.message || 'Could not generate a dispenser address.');
                            setAddressPickerOpen(false);
                        } finally {
                            setPickerGenerating(false);
                        }
                    },
                }, {
                    // An address this wallet may not hold; the form checks
                    // whether the chain will accept it before Create enables.
                    key: 'another-address',
                    label: 'Another address',
                    sublabel: 'Enter any address on this network',
                    onSelect: () => {
                        setAddressMode('other');
                        setExistingAddressId(null);
                        setAddressPickerOpen(false);
                    },
                }]}
                onPick={(a) => {
                    if (fromAddress && a.id === fromAddress.id) {
                        setAddressMode('current');
                        setExistingAddressId(null);
                    } else {
                        setAddressMode('existing');
                        setExistingAddressId(a.id);
                    }
                    setAddressPickerOpen(false);
                }}
                onBack={() => setAddressPickerOpen(false)}
            />
        );
    }

    // Token picker: spendable balances, rendered in place of the form.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                accountId={activeAccountId}
                title="Select Token"
                onSelect={(sel) => {
                    setTicker(String(sel.tick || ''));
                    // The Token field is live with a preset token too, so a
                    // pick on another chain re-targets the form.
                    if (sel.chainId) setChainId(sel.chainId);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // The "Buyers pay with" asset picker page, scoped to this dispenser's
    // chain (dispensers do not cross chains); it lists the native coin and
    // discoverable tokens. The coin is the coin lane; a token is the token lane.
    if (payPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                accountId={activeAccountId}
                title="Buyers Pay With"
                networkFilter={coinFromChainId(chainId)}
                chainIdFilter={chainId}
                onSelect={(sel) => {
                    if (sel.kind === 'native') {
                        setPayWith('coin');
                    } else {
                        setPayWith('token');
                        setGetTick(String(sel.tick || ''));
                    }
                    setPayPickerOpen(false);
                }}
                onBack={() => setPayPickerOpen(false)}
            />
        );
    }

    // The Fiat currency picker page: the protocol's fiats, plus a first row
    // that clears the choice, since a coin-paid dispenser names no currency.
    if (fiatPickerOpen) {
        return (
            <FiatCurrencyPicker
                variant={variant}
                codes={FIAT_CODES}
                value={fiatCode}
                noneOption={{ label: 'None, coin-paid', description: 'Each fill is priced in the coin amount above' }}
                onSelect={(code) => {
                    setFiatCode(code);
                    setFiatPickerOpen(false);
                }}
                onBack={() => setFiatPickerOpen(false)}
            />
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        // Opening a dispenser moves its escrow out of the signing address.
        const openSummary = {
            verb: t('components.confirmSummary.verbOpenDispenser'),
            ...(actionParams.GIVE_ESCROW && actionParams.GIVE_TICK
                ? { amount: actionParams.GIVE_ESCROW, ticker: actionParams.GIVE_TICK.toUpperCase(), direction: 'out' }
                : { direction: 'none' }),
            chainId,
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={openSummary}
                screenVariant={variant}
                chainLabel={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                        + (feeFiat ? ` (${feeFiat})` : '')
                    : 'Network fee estimate unavailable.'}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                formatNativeFee={formatNativeFee}
                formatProtocolFee={formatProtocolFee}
                formatFeeTotal={feeFiatFormat.formatFeeTotal}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? sourceAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
                // Re-checked against the GET_ADDRESS this preview derived
                extraCredentials={outsideAddressNote || allowListWarningNode ? (
                    <>
                        {outsideAddressNote}
                        {allowListWarningNode}
                    </>
                ) : null}
            />
        );
    }

    // Source (SOURCE) picker: the wallet's own addresses on the active chain.
    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose Allow-List' : 'Choose Block-List'}
                onSelect={(row) => {
                    const pick = { index: String(row.actionIndex), name: row.name };
                    if (listPickerFor === 'allow') { setAllowListIdx(row.actionIndex); setAllowListCount(row.memberCount ?? null); setAllowListPick(pick); }
                    else { setBlockListIdx(row.actionIndex); setBlockListCount(row.memberCount ?? null); setBlockListPick(pick); }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Source Address"
                walletId={walletId}
                accountId={activeAccountId}
                chainId={chainId}
                // From follows the token's network; pick another address on it.
                lockNetwork
                onPick={(a) => {
                    manualSourceRef.current = true;
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    const draftBanner = draft.hasDraft() && !draftPending ? (
        <DraftNotice
            onRestore={restoreDraft}
            onDiscard={discardSavedDraft}
        >
            Your unfinished dispenser draft was saved. Restore it to continue. Nothing was submitted.
        </DraftNotice>
    ) : null;

    // Every field below is built once and placed in whichever view
    // (Quick or Full) is open; the values live in this form's state, so they
    // survive a view switch.
    const { view, setView, sections } = giveGetView;
    const tickTrim = ticker.trim();
    const nativeTick = tickerForDescriptor(descriptor) || coinTicker;
    const oracleLane = payWith === 'coin' && Boolean(oracleAddress.trim());
    const sourceBalanceText = sourceTickBalance != null && tickTrim
        ? `${formatWithThousands(sourceTickBalance)} ${tickTrim} available`
        : null;
    const onGiveMax = sourceTickBalance && Number(sourceTickBalance) > 0
        ? () => setGiveAmount(sourceTickBalance)
        : undefined;
    const onEscrowMax = sourceTickBalance && Number(sourceTickBalance) > 0
        ? () => setEscrow(sourceTickBalance)
        : undefined;
    // The per-field input rules, shared by both views.
    const tokenAmountInput = (setter) => (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        setter(stripped);
    };
    const priceInput = (setter) => (rawValue) => setter(normalizeLocalizedDecimal(rawValue) ?? rawValue);
    const fillsHint = fillsEstimate !== null && fillsEstimate !== undefined && giveAmount.trim() && escrow.trim()
        ? `Enough for ${formatWithThousands(String(fillsEstimate))} fills. The dispenser closes when it runs out.`
        : undefined;
    const fromHelp = 'The address that funds the escrow, pays the network fee and signs the dispenser.';
    const payWithHelp = "Buyers pay in the network's native coin, or in another token you name.";
    const payAsset = payWith === 'coin'
        ? (chainId && nativeTick ? { chainId, tick: nativeTick } : null)
        : (getTick.trim() && chainId ? { chainId, tick: getTick.trim() } : null);
    const payTickUpper = payWith === 'coin' ? (coinTicker || 'coin') : (getTick.trim().toUpperCase() || 'TOKEN');
    const priceAmount = payWith === 'coin' ? triggerPrice : getTokenAmount;

    // "1 GIVE = n PAY" from the per-fill amounts, or the pricing mode
    // when an oracle or a fiat amount sets the price.
    let rateText;
    if (oracleLane) {
        rateText = `Oracle priced${fiatCode ? ` in ${fiatCode}` : ''} at each fill`;
    } else if (payWith === 'coin' && fiatCode && fiatAmount.trim()) {
        rateText = `${fiatAmount.trim()} ${fiatCode} per fill`;
    } else {
        const rate = divideDecimalStrings(priceAmount, giveAmount, 8);
        const displayedRate = rate === '0' && isPositiveDecimal(priceAmount) && isPositiveDecimal(giveAmount)
            ? '< 0.00000001'
            : rate;
        rateText = displayedRate && tickTrim
            ? `1 ${tickTrim.toUpperCase()} = ${displayedRate} ${payTickUpper}`
            : 'Enter both amounts to see the rate';
    }
    const rateLine = <RateLine text={rateText} />;

    // Dispenser Terms reads the address, any fiat or oracle pricing, then the
    // expiry ("3 months" or "Expires <time>"); Lists names the lists set, else "None".
    const termsParts = [];
    termsParts.push({
        new: 'New dispenser address',
        current: 'Opens on From',
        existing: 'Existing address',
        other: 'Another address',
    }[addressMode] || 'New dispenser address');
    if (payWith === 'coin' && oracleAddress.trim()) termsParts.push(`Oracle${fiatCode ? ` ${fiatCode}` : ''}`);
    else if (payWith === 'coin' && fiatCode) termsParts.push(`Priced in ${fiatCode}`);
    if (expMode === 'default') termsParts.push('3 months');
    else termsParts.push(expirationParam(expMode, expInput) ? `Expires ${expInput.trim().replace('T', ' ')}` : 'Custom expiry');
    const termsSummary = termsParts.join(' · ');
    const listsParts = [];
    if (allowListIdx) listsParts.push(`Allow list #${allowListIdx}`);
    if (blockListIdx) listsParts.push(`Block list #${blockListIdx}`);
    const listsSummary = listsParts.length ? listsParts.join(' · ') : 'None';
    // The fee summary comes from the standard Network fee section.

    const noSourceNotice = fromAddress ? null : (
        <FormNotice variant="error">
            {t('send.source.noAddress')}
        </FormNotice>
    );
    const gatedNotice = gatedGiveNotice.gated ? (
        <FormNotice variant="warning" role="alert">
            {gatedTickWarningCopy(ticker, 'buyers dispensed this token')}
        </FormNotice>
    ) : null;
    // The price problem sits under the price fields, with its one-click fix as a link action in the note.
    const priceNote = (
        <FieldNote
            variant="error"
            action={priceNotes.bundle ? (
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    icon={<Icon.CheckIcon />}
                    onClick={() => {
                        setGiveAmount(priceNotes.bundle.giveAmount);
                        setTriggerPrice(priceNotes.bundle.getAmount);
                    }}
                >
                    {`Sell ${formatWithThousands(priceNotes.bundle.giveAmount)} Per Fill at ${formatWithThousands(priceNotes.bundle.getAmount)} ${coinTicker}`}
                </Button>
            ) : null}
        >
            {priceNotes.block}
        </FieldNote>
    );
    const oracleNote = (
        <FieldNote variant="info" role="status">
            The oracle sets the native coin price when each fill occurs.
        </FieldNote>
    );
    // The pre-flight verdict for an outside address, beside the field it
    // judges, so a refusal is seen before Create.
    const outsideVerdictNotes = (
        <>
            {outsideVerdictLoading ? (
                <FieldNote variant="info" role="status">
                    Checking whether this address accepts your dispenser…
                </FieldNote>
            ) : null}
            {addressMode === 'other' && outsideVerdict ? (
                <FieldNote variant={outsideVerdict.allowed ? 'info' : 'error'} role={outsideVerdict.allowed ? 'status' : 'alert'}>
                    <span data-testid="outside-address-verdict" data-verdict={outsideVerdict.kind}>
                        {outsideVerdict.message}
                    </span>
                </FieldNote>
            ) : null}
        </>
    );
    // In the Quick card the give line above already shows the
    // balance, so the escrow field leaves its own copy out there.
    const escrowField = (withBalance) => (
        <AmountField
            id="dispenser-escrow"
            label="Escrow amount"
            help="How much of the token is locked in the dispenser for buyers to draw from. The dispenser closes when it runs out."
            amount={escrow}
            tick={ticker}
            divisibility={giveTokenInfo?.divisibility}
            onAmountFieldChange={tokenAmountInput(setEscrow)}
            onMax={onEscrowMax}
            maxDisabled={!sourceTickBalance}
            balanceText={withBalance ? sourceBalanceText : null}
            hint={fillsHint}
        />
    );

    // The Quick cards, built on demand inside the Dispenser section.
    const quickView = () => (
        <GiveGetQuick
            give={{
                label: 'You give per fill',
                help: t('dispenserForm.tokenHelp'),
                // No network control; the token picker lists every network
                // and the card shows the token's network read-only.
                asset: tickTrim && chainId ? { chainId, tick: ticker } : null,
                assetLabel: 'Token',
                onOpenAsset: () => setTokenPickerOpen(true),
                amount: giveAmount,
                onAmountChange: tokenAmountInput(setGiveAmount),
                amountLabel: t('dispenserForm.giveAmountPerFill'),
                balanceText: sourceBalanceText,
                onMax: onGiveMax || null,
                maxDisabled: !sourceTickBalance,
                // The escrow is part of what you give, so it sits in
                // the give card; Quick can create a dispenser on its own.
                extra: escrowField(false),
                // From is the standard From section above, not a row here.
            }}
            get={{
                label: 'You get per fill',
                // Where buyers send payment is static help, so it sits in the
                // '?' tip rather than a line under the card (U57).
                help: `${payWithHelp} Buyers send it to the dispenser address.`,
                asset: payAsset,
                assetLabel: 'Buyers pay with',
                assetPlaceholder: t('send.selectAsset'),
                onOpenAsset: () => setPayPickerOpen(true),
                // With an oracle the price is set at each fill, so the price
                // input stays empty and the whole card is held (GiveGetQuick has
                // no read-only amount); clear the oracle under Dispenser terms.
                amount: oracleLane ? '' : priceAmount,
                onAmountChange: priceInput(payWith === 'coin' ? setTriggerPrice : setGetTokenAmount),
                amountLabel: payWith === 'coin' ? 'Trigger price' : t('dispenserForm.paymentAmountPerFill'),
                disabled: oracleLane,
                // State text only: it says why the held card has no price.
                footNote: oracleLane ? 'The oracle sets the native coin price when each fill occurs.' : null,
            }}
            notice={(
                // The no-source notice sits in the From section; the
                // address verdict and the allow-list warning sit in Dispenser
                // terms while it is open and in the status slot while closed.
                <>
                    {gatedNotice}
                    {priceNote}
                </>
            )}
            rate={rateLine}
            // Dispenser terms and the fee are standard sections below.
            terms={null}
        />
    );

    // Full's Dispenser section: the give fields, then the get fields
    // (no Network field and no From here; the From section holds both).
    const fullDispenserFields = (
                    <>
                        <TokenField
                            id="dispenser-token"
                            label="Token"
                            help={t('dispenserForm.tokenHelp')}
                            value={ticker && chainId ? { chainId, tick: ticker } : null}
                            onOpenPicker={() => setTokenPickerOpen(true)}
                        />
                        {gatedNotice}
                        <AmountField
                            id="dispenser-give"
                            label={t('dispenserForm.giveAmountPerFill')}
                            help="Tokens sent to the buyer every time the dispenser is triggered."
                            amount={giveAmount}
                            tick={ticker}
                            divisibility={giveTokenInfo?.divisibility}
                            onAmountFieldChange={tokenAmountInput(setGiveAmount)}
                            onMax={onGiveMax}
                            maxDisabled={!sourceTickBalance}
                            balanceText={sourceBalanceText}
                        />
                        {escrowField(true)}
                        <TokenField
                            id="dispenser-payment-token"
                            label="Buyers pay with"
                            // The coin or a token: an asset picker.
                            placeholder={t('send.selectAsset')}
                            help={payWithHelp}
                            value={payAsset}
                            onOpenPicker={() => setPayPickerOpen(true)}
                        />
                        {payWith === 'token' ? (
                            <Input
                                id="dispenser-payment-amount"
                                label={t('dispenserForm.paymentAmountPerFill')}
                                help="Amount of the payment token buyers send per fill."
                                inputMode="decimal"
                                value={getTokenAmount}
                                onChange={(e) => priceInput(setGetTokenAmount)(e.target.value)}
                                autoComplete="off"
                            />
                        ) : oracleLane ? oracleNote : (
                            <Input
                                id="dispenser-trigger-price"
                                label={`Trigger price${coinTicker ? ` (${coinTicker})` : ''}`}
                                help={`Native ${coinTicker || 'coin'} amount buyers send per fill.`}
                                inputMode="decimal"
                                value={triggerPrice}
                                onChange={(e) => priceInput(setTriggerPrice)(e.target.value)}
                                autoComplete="off"
                            />
                        )}
                        {priceNote}
                    </>
    );

    // The address verdict and the D-161 allow-list warning can hold
    // Create, so each stays in sight while the section that holds its field
    // (Dispenser Terms, Lists) is closed: the status slot just above the action.
    const closedAddressNotes = !sections.options && addressMode === 'other' && (outsideVerdictLoading || outsideVerdict);
    const closedListNotes = !sections.lists && Boolean(allowListWarningNode);
    const closedTermsNotes = closedAddressNotes || closedListNotes ? (
        <>
            {closedAddressNotes ? outsideVerdictNotes : null}
            {closedListNotes ? allowListWarningNode : null}
        </>
    ) : null;

    // Dispenser terms, one body for both views (Quick expands it in place).
    const termsBody = (
                    <>
                        {fromAddress ? (
                            <>
                                {/* Dispenser address: where the dispenser opens (GET_ADDRESS). */}
                                {addressMode === 'other' ? (
                                    <AddressField
                                        id="dispenser-address"
                                        label="Dispenser address"
                                        help="The address the dispenser opens on: buyers send payment here. A new address keeps this dispenser apart from your other funds."
                                        icon="addresses"
                                        value={outsideAddress}
                                        placeholder="Any address on the active network"
                                        onChange={(e) => setOutsideAddress(e.target.value)}
                                        error={outsideFormatError || undefined}
                                        onIconClick={() => setAddressPickerOpen(true)}
                                        iconLabel="Change dispenser address"
                                    />
                                ) : (
                                    // A new address does not exist until preview, so the
                                    // field says so as a placeholder; as a value the
                                    // sentence went through the address shortener and
                                    // read "New di…eview)".
                                    <AddressField
                                        label="Dispenser address"
                                        help="The address the dispenser opens on: buyers send payment here. A new address keeps this dispenser apart from your other funds."
                                        icon="addresses"
                                        value={addressMode === 'new'
                                            ? ''
                                            : (addressMode === 'existing' && existingAddress
                                                ? existingAddress.address
                                                : fromAddress.address)}
                                        placeholder={addressMode === 'new' ? 'New address, made at preview' : undefined}
                                        readOnly
                                        onChange={() => {}}
                                        onIconClick={() => setAddressPickerOpen(true)}
                                        iconLabel="Change dispenser address"
                                    />
                                )}
                                {/* Shown above this section (between) while it is closed. */}
                                {sections.options ? outsideVerdictNotes : null}
                            </>
                        ) : null}

                        {/* Fiat and oracle pricing price the coin lane only, so
                            they show while buyers pay with the coin. */}
                        {payWith === 'coin' ? (
                            <>
                                {/* G122: the Fiat currency field and its picker
                                    page; empty means coin-paid. */}
                                <FiatCurrencyField
                                    id="dispenser-fiat-code"
                                    optional
                                    help="Price each fill in a fiat currency instead of a fixed coin amount; validators convert it at the current rate."
                                    value={fiatCode}
                                    placeholder="None, coin-paid"
                                    onOpenPicker={() => setFiatPickerOpen(true)}
                                />
                                <Input
                                    id="dispenser-fiat-amount"
                                    label="Fiat amount"
                                    placeholder="12.34"
                                    help="Validator-priced fiat dispenser. Leave blank if using a user oracle."
                                    inputMode="decimal"
                                    value={fiatAmount}
                                    onChange={(e) => priceInput(setFiatAmount)(e.target.value)}
                                    autoComplete="off"
                                />
                                <FieldNote variant="info" role="status">{priceNotes.fiatWarning}</FieldNote>
                                <AddressField
                                    id="dispenser-oracle"
                                    label="Oracle address"
                                    optional
                                    help="Oracle address used for fiat pricing. If it charges a usage fee, you pay it now based on the escrow amount. Enter the full address."
                                    value={oracleAddress}
                                    onChange={(e) => setOracleAddress(e.target.value)}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                />
                            </>
                        ) : null}

                        {/* A choice among a few named options is the icon dropdown (G44);
                            Expires always shows and follows it (operator 2026-11-13). */}
                        <ExpirationFields
                            id="dispenser-expiration"
                            name="disp-exp"
                            mode={expMode}
                            input={expInput}
                            // '3 months' sends no EXPIRATION, so it keeps no time: a
                            // preset picked and put back leaves no draft behind.
                            onChange={(mode, input) => { setExpMode(mode); setExpInput(mode === 'default' ? '' : input); }}
                            help="By default the dispenser stays open for 3 months. Pick a longer term, or a time to close it sooner or later."
                            expiresHelp="The date and time the dispenser closes. Set by the Expiration choice, or pick a time to expire at a specific time."
                        />
                    </>
    );

    // The Lists section: who may buy from the dispenser.
    const listsBody = (
                    <>
                        {/* Allow and block lists are picker fields like Token, never grey buttons
                            (the order and swap forms' pattern); the clear action sits inside the field. */}
                        <ListField
                            label="Allow list"
                            help="Only addresses on this list can buy from the dispenser. Pick an address list you published in My Lists."
                            placeholder="None set"
                            valueText={allowListIdx ? `${pickedListText(allowListIdx, allowListPick)}${allowListCount != null ? ` · ${allowListCount} member${allowListCount === 1 ? '' : 's'}` : ''}` : null}
                            onOpenPicker={() => setListPickerFor('allow')}
                            onClear={() => { setAllowListIdx(''); setAllowListCount(null); }}
                            clearLabel="Clear allow list"
                        />
                        <ListField
                            label="Block list"
                            help="Addresses on this list cannot buy from the dispenser. Pick an address list you published in My Lists."
                            placeholder="None set"
                            valueText={blockListIdx ? `${pickedListText(blockListIdx, blockListPick)}${blockListCount != null ? ` · ${blockListCount} member${blockListCount === 1 ? '' : 's'}` : ''}` : null}
                            onOpenPicker={() => setListPickerFor('block')}
                            onClear={() => { setBlockListIdx(''); setBlockListCount(null); }}
                            clearLabel="Clear block list"
                        />

                        {/* D-161: "Restrict who can buy" is the reading that causes the
                            mistake - the chain checks this dispenser's own address against
                            the same list. Rendered beside the control that caused it rather
                            than at review, so the fix (pick another list, or clear it) is
                            one click away from the warning. While this
                            section is closed it shows above it instead. */}
                        {sections.lists ? allowListWarningNode : null}
                    </>
    );

    // Form Standard open state comes from the same Give/Get view state;
    // `main` flags Dispenser as the main section (data-form-main).
    const bind = (id) => ({ open: Boolean(sections[id]), onOpenChange: (open) => giveGetView.setSectionOpen(id, open), main: id === 'dispenser' });
    // Which section holds an error, so each review attempt reopens it (the
    // standard's revealKey); a Create refusal naming a terms field counts too.
    const termsHasError = Boolean(expirationValidationError(expMode, expInput)
        || (addressMode === 'other' && outsideFormatError)
        || Object.keys(formErrors.errors).some((id) => DISPENSER_ERROR_SECTION[id] === 'options'));
    const listsHasError = listInBothSlots({ allowList: allowListIdx, blockList: blockListIdx });
    const revealOn = (hasError) => (hasError ? validationAttempt : 0);
    const dispenserSummary = joinSummary(
        tickTrim
            ? `${giveAmount.trim() ? `${formatWithThousands(giveAmount.trim())} ` : ''}${tickTrim.toUpperCase()} per fill`
            : 'No token yet',
        oracleLane
            ? `oracle priced${fiatCode ? ` in ${fiatCode}` : ''}`
            : (priceAmount.trim() ? `for ${priceAmount.trim()} ${payTickUpper}` : null),
    ).replace(', for ', ' for ');

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Create dispenser"
            onSubmit={handleReview}
            errors={formErrors}
            lead={draftBanner}
            status={closedTermsNotes}
            action={(
                <FormAction
                    icon={<Icon.PlusIcon />}
                    loading={derivingGetAddress || actionConfirm.composing}
                    aria-disabled={outsideBlocked ? 'true' : undefined}
                >
                    Create Dispenser
                </FormAction>
            )}
            from={(
                // The standard From section, first in both views. The
                // token decides the network, so the Network field is locked.
                <FromSection
                    {...bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp="The token decides the network. Pick a token on another network to move the dispenser there."
                    address={fromAddress?.address}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp={fromHelp}
                    // Only when this network truly has no address; a
                    // render before the source is picked must not open From for good.
                    missing={(addressesByChain?.[chainId] || []).length === 0 ? noSourceNotice : null}
                    formErrorKey="form:source"
                />
            )}
            fee={(
                // The one Fees section: the speed slider, the network and
                // protocol fee lines and the pay-in-coin switch.
                <FeeSection
                    {...bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    formErrorKey="form:fee"
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        waiting: protocolFeeWaiting,
                        // A dispenser inside the free period costs no protocol fee.
                        free: expirationWithinFreePeriod(expMode, expInput),
                        fiat: feeFiatFormat,
                        nativeFeeProps: {
                            checked: payFeeInNativeCoin,
                            onChange: setPayFeeInNativeCoin,
                            mandatory: nativeFeeMandatory,
                        },
                    }}
                />
            )}
        >
            {/* The main section, open: what the dispenser sells and for what. */}
            <FormSection id="dispenser" title="Dispenser" icon={Icon.PlusIcon} {...bind('dispenser')} summary={dispenserSummary}>
                {/* One form either way (operator 2026-11-13): Quick | Full only
                    restyles this section's inputs. */}
                <ViewSwitch value={view} onChange={setView} label="Dispenser input style" inSection />
                {view === 'quick' ? quickView() : (
                    <>
                        {fullDispenserFields}
                        {rateLine}
                    </>
                )}
            </FormSection>
            {/* Dispenser terms, closed; in Quick it expands in place. */}
            <FormSection
                id="options"
                title="Dispenser Terms"
                icon={Icon.GearIcon}
                {...bind('options')}
                revealKey={revealOn(termsHasError)}
                summary={termsSummary}
            >
                {termsBody}
            </FormSection>
            <FormSection
                id="lists"
                title="Lists"
                icon={Icon.ListIcon}
                optional
                {...bind('lists')}
                revealKey={revealOn(listsHasError)}
                summary={listsSummary}
            >
                {listsBody}
            </FormSection>
        </FormFrame>,
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
