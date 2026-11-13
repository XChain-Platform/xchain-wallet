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
    Screen,
    PageHeader,
    FormPage,
    ListPage,
    FormNotice,
    Button,
    Input,
    Textarea,
    ChainBadge,
    // Network, the Optional tag and the fee selector come from the Wallet Form
    // Standard's FromSection, FormSection and FeeSection.
    AddressText,
    Icon,
    StatusMessage,
    AddressField,
    FormErrorSummary,
    Switch,
    IconSelect,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MAX_ISSUE_TEXT_LENGTH } from '../utils/issueFieldValidation.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { useSettings } from '../hooks/useSettings.js';
import { getActiveNetwork } from '../../flows/effectiveNetwork.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { ISSUE_LOCKS } from './issueLocks.js';
// Laid out on the Wallet Form Standard: From (its Network picks the token's
// network), Token, the optional sections, Network fee (FeesCard with the
// native-fee switch), the status slot and Issue Token.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    summaryAddress,
    useFormSections,
} from '../components/formStandard/index.js';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { MAX_TICKER_LENGTH, TICKER_HELP, tickerGrammarError } from '../utils/tickerGrammar.js';
import {
    issueDescriptionError,
    issueImageUrlError,
    issueSupplyLimitError,
} from '../utils/issueFieldValidation.js';
import {
    applyAdvancedIssueFields,
    validateAdvancedIssueFields,
} from '../utils/issueAdvancedFields.js';
import { blockDateEstimateText } from '../utils/blockDateEstimate.js';
import { listLabel } from '../utils/listLabel.js';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useHideReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { tickLookupVerdict } from '../utils/listTickItems.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { useFeeSchedule } from '../hooks/useFeeSchedule.js';
import { issueFeeFromSchedule } from '../../flows/issueFeeSchedule.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { useFormLeaveGuard } from '../hooks/useFormLeaveGuard.js';
import {
    hasAnyAddress,
    preferredSourceId,
    signingAddressesByChain,
    WATCH_ONLY_SIGNING_MESSAGE,
} from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { DraftDiscardButton } from '../components/DraftDiscardButton.jsx';
import {
    compareDecimalStrings,
    formatDisplayAmount,
    subtractDecimalStrings,
} from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/issue.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/components.js';

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

// Only the main section (Token) starts open; From, the optional sections and
// Network fee start closed, all as shared formStandard FormSections.
const INITIAL_OPEN_SECTIONS = {
    from: false,
    token: true,
    initialMint: false,
    publicMinting: false,
    description: false,
    locks: false,
    lists: false,
    callback: false,
    ownership: false,
    fee: false,
};

// Which section holds the field a validation message is about, so
// that section opens (and reopens on every attempt) when the error shows.
function issueErrorSection(message) {
    const text = String(message || '');
    if (!text) return null;
    // Callback first: "Callback block" contains "lock", and its copy names
    // a payout token rather than the token being issued.
    if (/callback/i.test(text)) return 'callback';
    if (/ticker|^Max supply |subtoken|does not own/i.test(text)) return 'token';
    if (/image url/i.test(text)) return 'description';
    if (/initial mint/i.test(text)) return 'initialMint';
    if (/supply/i.test(text) && !/mint per|max mint/i.test(text)) return 'token';
    if (/max mint|mint per address|start block|stop block/i.test(text)) return 'publicMinting';
    if (/description/i.test(text)) return 'description';
    // Lists first: "block list" contains "lock".
    if (/allow list|block list/i.test(text)) return 'lists';
    if (/lock/i.test(text)) return 'locks';
    if (/ownership|destination/i.test(text)) return 'ownership';
    return null;
}

// How long the ticker availability lookup may run before the form stops
// waiting on it and lets composition judge the name.
const TICKER_LOOKUP_TIMEOUT_MS = 8000;
// A new token starts with eight decimal places; the draft check compares to it.
const DIVISIBLE_DEFAULT = true;

function isPositiveDecimal(value) {
    const text = String(value || '').trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') === 1;
}

function isNonNegativeDecimal(value) {
    const text = String(value || '').trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') !== -1;
}

function hasAmountPrecision(value, decimals) {
    const [, fraction = ''] = String(value || '').trim().split('.');
    return fraction.length <= decimals;
}

function isValidIssueAddress(value, descriptor) {
    return !!descriptor?.coin && !!descriptor?.networkKind
        && isValidAddressForChain(String(value).trim(), descriptor.coin, descriptor.networkKind);
}

const chainRegistry = registryLib.defaultRegistry();

/**
 * The one Issue Token form (§40.1, §40.2), which the Create a token route
 * mounts. Every ISSUE v0 field sits on one screen, and the template picker
 * (Meme, Utility, Collectible, Limited edition, Subtoken) pre-fills the
 * settings a common kind of token uses. A subtoken adds a Parent ticker
 * (TICK = PARENT.CHILD) that is looked up before every compose; Collectible
 * and Limited edition carry their artwork as an Image URL in DESCRIPTION.
 *
 * Backed by `messaging.issueToken`; watcher mode runs the draft through
 * `decoder.decodeAction` on a review step and builds an unsigned PSBT.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function IssueTokenForm({ walletId, onBack }) {
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

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [ticker, setTicker] = useState('');
    const [tickerCheck, setTickerCheck] = useState(
        /** @type {{ ticker: string, status: 'idle' | 'checking' | 'available' | 'taken' | 'unknown' }} */
        ({ ticker: '', status: 'idle' }),
    );
    const [supply, setSupply] = useState('');
    // Blank means "mint the whole supply now". Kept as its own
    // string so an explicit 0 stays distinguishable from an untouched field.
    const [initialMint, setInitialMint] = useState('');
    // Optional per-transaction MINT cap (ISSUE v0 MAX_MINT). Blank omits the
    // field entirely, which xchain-indexer stores as 0 and treats as "no
    // per-tx cap" (xchain-indexer src/actions/mint.js) - matching the Mint
    // settings panel (TokenAdminForm.jsx mode='mint-settings') left blank.
    const [maxMint, setMaxMint] = useState('');
    const [mintAddressMax, setMintAddressMax] = useState('');
    const [mintStartBlock, setMintStartBlock] = useState('');
    const [mintStopBlock, setMintStopBlock] = useState('');
    const [divisible, setDivisible] = useState(DIVISIBLE_DEFAULT);
    // The field error each amount field reports while it is edited (a refused
    // keystroke, or a stored value finer than Divisible allows), keyed by field.
    // Submit refuses while any is set, so a shown error never composes.
    const [amountInputErrors, setAmountInputErrors] = useState(
        /** @type {{ supply?: string | null, initialMint?: string | null, maxMint?: string | null, mintAddressMax?: string | null }} */ ({}),
    );
    // Decimal places every amount field and the ISSUE DECIMALS follow.
    const amountDecimals = divisible ? 8 : 0;
    const [description, setDescription] = useState('');
    const [locks, setLocks] = useState(/** @type {Record<string, boolean>} */ ({}));
    const [allowList, setAllowList] = useState('');
    // The "Start from" preset that last filled the form ('' = none).
    const [preset, setPreset] = useState('');
    const [blockList, setBlockList] = useState('');
    // A list picked from the address-list picker keeps its published name
    // beside its index; the name shows only while the field still holds it.
    const [allowListPick, setAllowListPick] = useState(/** @type {{ index: string, name: string | null } | null} */ (null));
    const [blockListPick, setBlockListPick] = useState(/** @type {{ index: string, name: string | null } | null} */ (null));
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    // Subtoken template: the existing parent the child is issued under, so the
    // ISSUE carries TICK = PARENT.CHILD. Only the Subtoken template reads it.
    const [parentToken, setParentToken] = useState('');
    const isSubtoken = preset === 'subtoken';
    // Collectible and Limited edition carry their artwork as an image URL in
    // DESCRIPTION; only those two templates read it.
    const [imageUrl, setImageUrl] = useState('');
    const usesImageUrl = preset === 'collectible' || preset === 'edition';
    // The callback trio (CALLBACK_TICK, CALLBACK_AMOUNT, CALLBACK_BLOCK): only
    // settable while no supply is distributed, so issuance is where it belongs.
    const [callbackTick, setCallbackTick] = useState('');
    const [callbackAmount, setCallbackAmount] = useState('');
    const [callbackBlock, setCallbackBlock] = useState('');
    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    // Divisibility of the CALLBACK token; null means not proven, which the
    // validator treats as indivisible (the direction that always composes).
    const [callbackTickDecimals, setCallbackTickDecimals] = useState(/** @type {number | null} */ (null));
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    // The form states the offline reason itself, so the shell banner hides.
    useHideReachabilityNotice(networkOffline);
    // Held above every early return (pickers, review) so the open sections
    // survive a picker page.
    const formSections = useFormSections(INITIAL_OPEN_SECTIONS);
    // ISSUE v0 carries two separate destinations, and a form that offers only
    // the first reads as if it moved both: TRANSFER hands away the token's
    // issuer rights, TRANSFER_SUPPLY says where the initial mint lands. The
    // indexer credits MINT_SUPPLY to the issuing address and moves it only when
    // TRANSFER_SUPPLY is set (xchain-indexer src/actions/issue/settle.js), so
    // filling "Transfer ownership to" hands token control to that address while
    // the issuer keeps every minted unit. Both fields live here so the form
    // says what the chain will do.
    const [transferTo, setTransferTo] = useState('');
    const [transferSupplyTo, setTransferSupplyTo] = useState('');
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    // Which address field the one contacts picker is filling.
    const [contactsTarget, setContactsTarget] = useState(/** @type {'owner' | 'supply'} */ ('owner'));
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [validationAttempt, setValidationAttempt] = useState(0);
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Reveal the field that needs attention when validation stops submission.
    useEffect(() => {
        if (!formError) return;
        // The standard sections; see issueErrorSection.
        const section = issueErrorSection(formError);
        if (section) formSections.setOpen(section, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formError]);

    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draftNetwork = settings ? getActiveNetwork(settings) : null;
    const draft = useFormDraft({ view: 'issue-token', walletId, network: draftNetwork, ttlMs: formDraftTtlMs });
    // A stored draft waits for an explicit Restore. A fresh form starts
    // saving immediately so an auto-lock unmount cannot erase typed values.
    const [draftPending, setDraftPending] = useState(() => !draft.hasDraft());
    // Settings resolve after the first render; once the network is known a draft
    // from another network reads as absent, so the form saves from then on.
    useEffect(() => {
        if (draftNetwork && !draft.hasDraft()) setDraftPending(true);
    }, [draftNetwork]); // eslint-disable-line react-hooks/exhaustive-deps
    // A confirmed "Discard and leave" drops the saved draft and stops the
    // autosave, so no render between the confirm and the unmount can write
    // the discarded values back.
    const draftDiscardedRef = useRef(false);
    const discardDraft = useCallback(() => {
        draftDiscardedRef.current = true;
        draft.clear();
    }, [draft]);
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(true); return; }
        if (typeof v.chainId === 'string') setChainId(v.chainId);
        if (typeof v.fromAddressId === 'string') setFromAddressId(v.fromAddressId);
        if (typeof v.ticker === 'string') setTicker(v.ticker);
        if (typeof v.supply === 'string') setSupply(v.supply);
        if (typeof v.initialMint === 'string') setInitialMint(v.initialMint);
        if (typeof v.maxMint === 'string') setMaxMint(v.maxMint);
        if (typeof v.mintAddressMax === 'string') setMintAddressMax(v.mintAddressMax);
        if (typeof v.mintStartBlock === 'string') setMintStartBlock(v.mintStartBlock);
        if (typeof v.mintStopBlock === 'string') setMintStopBlock(v.mintStopBlock);
        if (typeof v.divisible === 'boolean') setDivisible(v.divisible);
        if (typeof v.description === 'string') setDescription(v.description);
        if (v.locks && typeof v.locks === 'object') setLocks(v.locks);
        else if (v.lockSupply === true) {
            // Preserve the three flags represented by the former combined
            // lock when an unfinished draft predates the split controls.
            setLocks({ maxSupply: true, minting: true, mintSupply: true });
        }
        if (typeof v.allowList === 'string') setAllowList(v.allowList);
        if (typeof v.blockList === 'string') setBlockList(v.blockList);
        if (typeof v.preset === 'string') setPreset(v.preset);
        if (typeof v.parentToken === 'string') setParentToken(v.parentToken);
        if (typeof v.imageUrl === 'string') setImageUrl(v.imageUrl);
        if (typeof v.callbackTick === 'string') setCallbackTick(v.callbackTick);
        if (typeof v.callbackAmount === 'string') setCallbackAmount(v.callbackAmount);
        if (typeof v.callbackBlock === 'string') setCallbackBlock(v.callbackBlock);
        if (typeof v.transferTo === 'string') setTransferTo(v.transferTo);
        if (typeof v.transferSupplyTo === 'string') setTransferSupplyTo(v.transferSupplyTo);
        if (typeof v.payFeeInNativeCoin === 'boolean') setPayFeeInNativeCoin(v.payFeeInNativeCoin);
        setDraftPending(true);
    }, [draft]);
    const dismissDraft = useCallback(() => {
        draft.clear();
        setDraftPending(true);
    }, [draft]);
    const hasRealInput = useMemo(() => (
        [
            ticker, supply, initialMint, maxMint, mintAddressMax, mintStartBlock,
            mintStopBlock, description, allowList, blockList, transferTo,
            transferSupplyTo, password, parentToken, imageUrl, callbackTick,
            callbackAmount, callbackBlock,
        ]
            .some((value) => String(value || '').trim().length > 0)
        || divisible !== DIVISIBLE_DEFAULT
        || Object.values(locks).some(Boolean)
    ), [
        ticker, supply, initialMint, maxMint, mintAddressMax, mintStartBlock,
        mintStopBlock, description, allowList, blockList, transferTo,
        transferSupplyTo, password, divisible, locks, parentToken, imageUrl,
        callbackTick, callbackAmount, callbackBlock,
    ]);
    // The network, source and fee switch fill themselves in, so only what the
    // user typed or turned on makes a draft. A draft of defaults would come
    // back as a Restore banner, and the form holds its autosave while that
    // banner waits, so the next values typed would never be saved.
    useEffect(() => {
        if (stage !== 'form' || !draftPending || draftDiscardedRef.current) return;
        if (!hasRealInput) {
            draft.clear();
            return;
        }
        draft.save({
            chainId, fromAddressId, ticker, supply, initialMint, maxMint, mintAddressMax,
            mintStartBlock, mintStopBlock, divisible, description, locks, allowList,
            blockList, transferTo, transferSupplyTo, payFeeInNativeCoin,
            preset, parentToken, imageUrl, callbackTick, callbackAmount, callbackBlock,
        });
    }, [
        stage, draftPending, draft, hasRealInput,
        chainId, fromAddressId, ticker, supply, initialMint, maxMint, mintAddressMax,
        mintStartBlock, mintStopBlock, divisible, description, locks, allowList,
        blockList, transferTo, transferSupplyTo, payFeeInNativeCoin,
        preset, parentToken, imageUrl, callbackTick, callbackAmount, callbackBlock,
    ]);
    const leaveGuard = useFormLeaveGuard({
        dirty: stage !== 'done' && hasRealInput,
        submitting: stage === 'submitting',
        signedUnbroadcast: stage === 'done' && result?.queued === true && result?.unsaved === true,
        onLeave: onBack,
        onDiscard: discardDraft,
    });

    // The active wallet's mode decides which addresses can issue.
    const { walletMode, isWatcherMode } = useWalletMode();

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default).
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                // Only addresses this account can sign for (or build unsigned
                // output for, in watcher mode) can issue; a watch-only account
                // is refused here, before any action is offered or built.
                const signingByChain = signingAddressesByChain(byChain, walletMode);
                setAddressesByChain(signingByChain);
                setActiveByChain(active || {});
                if (Object.keys(signingByChain).length === 0) {
                    setLoadError(hasAnyAddress(byChain)
                        ? WATCH_ONLY_SIGNING_MESSAGE
                        : 'No addresses on any network yet. Use Receive to generate one before issuing a token.');
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key issued on the wallet's OLDEST chain forever. Open
                // on the last-used chain instead, ahead of that fallback,
                // exactly as Send and Swap do.
                setChainId((prev) => pickDefaultChainId(signingByChain, {
                    explicitChainId: prev,
                    settings,
                }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, walletMode]);

    // Same default as Send and every other spend-from-balance form: the
    // chain's active address, else the newest HD external. A dispenser-
    // delegated address is never the default; it vends rather than funds.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const addresses = addressesByChain[chainId] || [];
        const funding = addresses.filter((a) => a.role !== 'dispenser');
        setFromAddressId((current) => (
            addresses.some((address) => address.id === current)
                ? current
                : preferredSourceId(funding, activeByChain[chainId])
        ));
    }, [chainId, addressesByChain, activeByChain]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const feeFiatFormatters = useFeeFiat({
        chainId: descriptor?.id,
        chainCoin: descriptor?.coin,
        nativeTicker: coinTicker,
        settings,
    });
    const { formatNativeFee, formatProtocolFee } = feeFiatFormatters;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const tickerLookupSupported = Object.prototype.hasOwnProperty.call(messaging, 'getTokenInfo')
        && typeof messaging.getTokenInfo === 'function';

    // The tick the ISSUE carries: PARENT.CHILD for a subtoken, else the ticker.
    const issueTick = isSubtoken && parentToken.trim()
        ? `${parentToken.trim()}.${ticker.trim()}`
        : ticker.trim();
    // The availability lookup checks that tick, and only once the name (and a
    // subtoken's parent) passes the grammar.
    const lookupTick = tickerGrammarError(ticker)
        || (isSubtoken && tickerGrammarError(parentToken, { noun: 'Parent ticker', allowDot: true }))
        ? ''
        : issueTick;

    // A late response for an earlier ticker must not mark the current name as
    // taken. Cleanup ties each debounced lookup to the exact field value and
    // network that started it, while lookup failures leave protocol validation
    // to composition instead of trapping the form during an explorer outage.
    useEffect(() => {
        const checkedTicker = lookupTick;
        setTickerCheck({ ticker: checkedTicker, status: checkedTicker ? 'checking' : 'idle' });
        if (!chainId || !checkedTicker || !tickerLookupSupported) {
            setTickerCheck({ ticker: checkedTicker, status: 'idle' });
            return undefined;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            // A lookup that never settles is an outage too: past the bound it
            // reads as 'unknown', which submit accepts, instead of holding the
            // form on 'checking' forever.
            const lookup = Promise.resolve()
                .then(() => messaging.getTokenInfo({ chainId, tick: checkedTicker }));
            const bound = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('ticker lookup timed out')), TICKER_LOOKUP_TIMEOUT_MS);
            });
            Promise.race([lookup, bound])
                .then((info) => {
                    if (cancelled) return;
                    // The host answers an unknown tick with an all-empty
                    // record, not null, so only a found record marks it taken.
                    const verdict = tickLookupVerdict(info);
                    setTickerCheck({
                        ticker: checkedTicker,
                        status: verdict === 'found' ? 'taken'
                            : verdict === 'missing' ? 'available' : 'unknown',
                    });
                })
                .catch(() => {
                    if (!cancelled) setTickerCheck({ ticker: checkedTicker, status: 'unknown' });
                });
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [chainId, lookupTick, messaging, tickerLookupSupported]);
    const tickerTaken = !!lookupTick && tickerCheck.ticker === lookupTick && tickerCheck.status === 'taken';

    // Editing the ticker or network drops a held submit: the user is no
    // longer asking to review the name they submitted.
    // The ref decides the replay, so a held submit replays exactly once even
    // when the replay's own work (the subtoken parent lookup) is async.
    const [reviewQueued, setReviewQueued] = useState(false);
    const reviewQueuedRef = useRef(false);
    const queueReview = useCallback((queued) => {
        reviewQueuedRef.current = queued;
        setReviewQueued(queued);
    }, []);
    useEffect(() => { queueReview(false); }, [chainId, lookupTick, queueReview]);
    useEffect(() => {
        if (!reviewQueued || !reviewQueuedRef.current) return;
        if (tickerCheck.status === 'checking' || tickerCheck.ticker !== lookupTick) return;
        queueReview(false);
        handleReview({ preventDefault() {} });
    });

    // Chain tip, for the callback block's future-block rail and its date
    // estimate. Read once a callback field is in play.
    const callbackInPlay = formSections.isOpen('callback')
        || Boolean(callbackTick.trim() || callbackAmount.trim() || callbackBlock.trim());
    useEffect(() => {
        if (!callbackInPlay || !chainId) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        Promise.resolve(messaging.getIndexerWatermark({ chainId }))
            .then((r) => { if (!cancelled) setCurrentHeight(r && r.watermark != null ? Number(r.watermark) : null); })
            .catch(() => { if (!cancelled) setCurrentHeight(null); });
        return () => { cancelled = true; };
    }, [callbackInPlay, chainId, messaging, walletId]);

    // Prove the callback token's divisibility so a fractional payout can be
    // allowed. Anything short of a confirmed divisibility stays null, and the
    // validator then holds the payout to whole numbers.
    useEffect(() => {
        const tick = callbackTick.trim().toUpperCase();
        setCallbackTickDecimals(null);
        if (!chainId || !tick || typeof messaging?.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            Promise.resolve()
                .then(() => messaging.getTokenInfo({ chainId, tick }))
                .then((info) => {
                    if (cancelled) return;
                    const d = info?.divisibility;
                    setCallbackTickDecimals(Number.isInteger(d) ? d : null);
                })
                .catch(() => { if (!cancelled) setCallbackTickDecimals(null); });
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [chainId, callbackTick, messaging]);
    const callbackFields = useMemo(
        () => ({ callbackTick, callbackAmount, callbackBlock }),
        [callbackTick, callbackAmount, callbackBlock],
    );

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    // Custom rates use the selected chain's native unit. A network change
    // returns to that network's normal tier instead of reinterpreting the old
    // numeric rate under a different unit and showing it as a fresh preview.
    useEffect(() => {
        setFeePick({ mode: 'normal' });
    }, [chainId]);
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
    const feeFiat = feeEstimate ? formatNativeFee(feeEstimate.coinAmount) : null;
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listContacts !== 'function') return undefined;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(rows || []); })
            .catch(() => { if (!cancelled) setContacts([]); });
        return () => { cancelled = true; };
    }, [messaging]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            // As typed: the chain records the tick verbatim, so the
            // wallet must not decide the case of a name a user coined.
            // A subtoken joins its parent: PARENT.CHILD, neither half recased.
            TICK: issueTick,
        };
        p.DECIMALS = divisible ? '8' : '0';
        const s = String(supply).trim();
        const wantsMint = String(initialMint).trim();
        if (isPositiveDecimal(s)) {
            p.MAX_SUPPLY = s;
            // MAX_SUPPLY is the cap, MINT_SUPPLY is how much of it
            // exists the moment the token is created. Deriving both from the
            // one "Supply" box made every wallet-issued token born at its own
            // cap with zero mint headroom, which made the whole Mint surface
            // unreachable for anything issued here. "Initial mint" left blank
            // keeps that simple path (mint it all now); a smaller value leaves
            // the difference mintable later. A 0 omits MINT_SUPPLY entirely,
            // the fair-mint shape (see the Limited edition preset): the
            // cap is declared at issuance with nothing minted yet.
            const mint = wantsMint === '' ? s : wantsMint;
            if (isPositiveDecimal(mint)) p.MINT_SUPPLY = mint;
        } else if (isPositiveDecimal(wantsMint)) {
            // An ISSUE may mint without declaring a cap. The indexer stores
            // omitted MAX_SUPPLY as the uncapped sentinel, so an initial-only
            // supply is valid and remains uncapped.
            p.MINT_SUPPLY = wantsMint;
        }
        if (maxMint.trim()) p.MAX_MINT = maxMint.trim();
        if (mintAddressMax.trim()) p.MINT_ADDRESS_MAX = mintAddressMax.trim();
        if (mintStartBlock.trim()) p.MINT_START_BLOCK = mintStartBlock.trim();
        if (mintStopBlock.trim()) p.MINT_STOP_BLOCK = mintStopBlock.trim();
        // Collectible and Limited edition write their image URL into
        // DESCRIPTION (the TIS IMAGE format); the others write the description.
        if (usesImageUrl && imageUrl.trim()) p.DESCRIPTION = imageUrl.trim();
        else if (description) p.DESCRIPTION = description.trim();
        for (const lock of ISSUE_LOCKS) {
            if (locks[lock.key]) p[lock.field] = '1';
        }
        // The callback trio rides the same ISSUE (no locks or lists here:
        // those have their own controls above).
        applyAdvancedIssueFields(p, callbackFields);
        if (allowList.trim()) p.ALLOW_LIST = allowList.trim();
        if (blockList.trim()) p.BLOCK_LIST = blockList.trim();
        if (transferTo.trim()) p.TRANSFER = transferTo.trim();
        // Only meaningful beside a MINT_SUPPLY: with nothing minted at issuance
        // there is nothing to deliver, and the indexer would ignore the field.
        // The submit check refuses that pairing before it gets here.
        if (transferSupplyTo.trim() && p.MINT_SUPPLY) p.TRANSFER_SUPPLY = transferSupplyTo.trim();
        return p;
    }, [
        issueTick, supply, initialMint, maxMint, mintAddressMax, mintStartBlock,
        mintStopBlock, divisible, description, locks, allowList, blockList,
        transferTo, transferSupplyTo, usesImageUrl, imageUrl, callbackFields,
    ]);

    // Every input check review runs, as one answer: { error } to show, { queue }
    // while the ticker lookup is still settling (review waits for it), or null
    // when review may open. The live Fees card quote reads the same answer, so
    // it prices exactly the ISSUE review would accept.
    function issueInputsCheck() {
        if (!chainId || !fromAddress) {
            return { error: 'Pick a source address first.' };
        }
        // Same grammar module as the wizard, so the two authoring
        // surfaces cannot drift apart on what a ticker may be called. It covers
        // the empty case too, which is why the separate blank check went with it.
        const tickerError = tickerGrammarError(ticker);
        if (tickerError) {
            return { error: tickerError };
        }
        const descriptionError = actionTextSafetyError(description, 'Description')
            || issueDescriptionError(description);
        if (descriptionError) {
            return { error: descriptionError };
        }
        if (isSubtoken) {
            if (!parentToken.trim()) {
                return { error: 'Parent ticker is required for subtokens.' };
            }
            // The parent is a REFERENCE to a token that already exists, so it
            // may itself be a subtoken: the indexer resolves a child's parent
            // as `parts.slice(0,-1).join('.')` (issue.js), so `A.B.C` is a
            // child of `A.B`. The dot-structure rules the chain enforces still
            // apply (no leading, trailing or doubled dot).
            const parentError = tickerGrammarError(parentToken, {
                noun: 'Parent ticker',
                allowDot: true,
            });
            if (parentError) {
                return { error: parentError };
            }
        }
        if (usesImageUrl) {
            if (!imageUrl.trim()) {
                return { error: 'Image URL is required for this template.' };
            }
            const imageError = issueImageUrlError(imageUrl);
            if (imageError) {
                return { error: imageError };
            }
        }
        // The callback shares the create transaction, so a value the indexer
        // refuses costs the whole token; it is checked here instead.
        const callbackError = validateAdvancedIssueFields(callbackFields, {
            supply,
            currentHeight,
            callbackTickDecimals,
        });
        if (callbackError) {
            return { error: callbackError };
        }
        const checkedTicker = lookupTick;
        if (tickerLookupSupported && checkedTicker
            && (tickerCheck.ticker !== checkedTicker || tickerCheck.status === 'checking')) {
            return { queue: true };
        }
        if (tickerTaken) {
            return { error: t('issue.tickerTaken', { ticker: checkedTicker }) };
        }
        const supplyText = supply.trim();
        if (supplyText && !isNonNegativeDecimal(supplyText)) {
            return { error: 'Max supply must be zero or a positive number.' };
        }
        if (isPositiveDecimal(supplyText) && !hasAmountPrecision(supplyText, amountDecimals)) {
            return { error: divisible
                ? 'Max supply can have at most 8 decimal places.'
                : 'Max supply must be a whole number for an indivisible token.' };
        }
        const supplyLimitError = isPositiveDecimal(supplyText)
            ? issueSupplyLimitError(supplyText, 'Max supply')
            : null;
        if (supplyLimitError) {
            return { error: supplyLimitError };
        }
        // An initial mint above the cap is rejected outright by the
        // indexer (issue.js), which costs the user the fee and the token, so
        // it is caught here rather than at broadcast.
        const mintText = initialMint.trim();
        if (mintText) {
            if (!isNonNegativeDecimal(mintText)) {
                return { error: 'Initial mint must be zero or a positive number.' };
            }
            if (isPositiveDecimal(mintText) && !hasAmountPrecision(mintText, amountDecimals)) {
                return { error: divisible
                    ? 'Initial mint can have at most 8 decimal places.'
                    : 'Initial mint must be a whole number for an indivisible token.' };
            }
            if (isPositiveDecimal(supplyText)
                && compareDecimalStrings(mintText, supplyText) === 1) {
                return { error: 'Initial mint cannot be more than the max supply.' };
            }
        }
        const maxMintText = maxMint.trim();
        if (maxMintText) {
            if (!isPositiveDecimal(maxMintText)) {
                return { error: 'Max mint per transaction must be a positive number, or left blank for no limit.' };
            }
            if (!hasAmountPrecision(maxMintText, amountDecimals)) {
                return { error: divisible
                    ? 'Max mint per transaction can have at most 8 decimal places.'
                    : 'Max mint per transaction must be a whole number for an indivisible token.' };
            }
            const maxMintLimitError = issueSupplyLimitError(
                maxMintText,
                'Max mint per transaction',
            );
            if (maxMintLimitError) {
                return { error: maxMintLimitError };
            }
        }
        const mintAddressMaxText = mintAddressMax.trim();
        if (mintAddressMaxText) {
            if (!isPositiveDecimal(mintAddressMaxText)) {
                return { error: 'Max mint per address must be a positive number, or left blank for no limit.' };
            }
            if (!hasAmountPrecision(mintAddressMaxText, amountDecimals)) {
                return { error: divisible
                    ? 'Max mint per address can have at most 8 decimal places.'
                    : 'Max mint per address must be a whole number for an indivisible token.' };
            }
            const addressLimitError = issueSupplyLimitError(
                mintAddressMaxText,
                'Max mint per address',
            );
            if (addressLimitError) {
                return { error: addressLimitError };
            }
            if (maxMintText && compareDecimalStrings(mintAddressMaxText, maxMintText) === -1) {
                return { error: 'Max mint per address cannot be less than max mint per transaction.' };
            }
        }
        for (const [value, label] of [
            [mintStartBlock.trim(), 'Start block'],
            [mintStopBlock.trim(), 'Stop block'],
        ]) {
            if (value && !/^\d+$/.test(value)) {
                return { error: `${label} must be a whole block height.` };
            }
        }
        if (mintStartBlock.trim() && mintStopBlock.trim()
            && compareDecimalStrings(mintStopBlock.trim(), mintStartBlock.trim()) === -1) {
            return { error: 'Stop block cannot be before start block.' };
        }
        for (const [value, label] of [
            [allowList.trim(), 'Allow list'],
            [blockList.trim(), 'Block list'],
        ]) {
            if (value && (!/^\d+$/.test(value) || compareDecimalStrings(value, '0') !== 1)) {
                return { error: `${label} must be a positive list action index.` };
            }
        }
        if (locks.maxSupply && !isPositiveDecimal(supplyText)) {
            return { error: 'Max supply needs a positive cap before it can be locked.' };
        }
        // A field still showing its own error holds the last valid value, not
        // the text the user sees refused; composing that value would issue
        // something other than what the field says.
        const fieldRefusal = [
            ['supply', 'Max supply', 'must be zero or a positive number.'],
            ['initialMint', 'Initial mint', 'must be zero or a positive number.'],
            ['maxMint', 'Max mint per transaction', 'must be a positive number, or left blank for no limit.'],
            ['mintAddressMax', 'Max mint per address', 'must be a positive number, or left blank for no limit.'],
        ].find(([key]) => amountInputErrors[key]);
        if (fieldRefusal) {
            const [key, label, invalidText] = fieldRefusal;
            if (!/decimal places/.test(String(amountInputErrors[key]))) return { error: `${label} ${invalidText}` };
            return {
                error: divisible
                    ? `${label} can have at most 8 decimal places.`
                    : `${label} must be a whole number for an indivisible token.`,
            };
        }
        if (transferTo.trim() && !isValidIssueAddress(transferTo, descriptor)) {
            return { error: 'Transfer ownership address is not valid for the active network.' };
        }
        if (transferSupplyTo.trim() && !isValidIssueAddress(transferSupplyTo, descriptor)) {
            return { error: 'Initial mint destination is not valid for the active network.' };
        }
        // A supply destination with no initial mint would be silently dropped
        // by the chain; say so instead of composing a transaction that does
        // less than the form showed.
        if (transferSupplyTo.trim() && !actionParams.MINT_SUPPLY) {
            return { error: 'Sending the initial mint somewhere needs an initial mint above 0.' };
        }
        return null;
    }

    const issueInputsReady = issueInputsCheck() === null;
    const quoteActionData = useMemo(
        () => (issueInputsReady ? { action: 'ISSUE', params: actionParams } : null),
        [issueInputsReady, actionParams],
    );
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });
    // ISSUE costs a fixed fee (one for a new token, another for a subtoken),
    // so the card shows it from the chain's fee schedule as soon as the form
    // opens. The live quote takes over once it has a usable answer: it also
    // knows when the ticker already exists, where an update costs nothing.
    const feeSchedule = useFeeSchedule({ messaging, chainId });
    const scheduleFeeQuote = useMemo(
        () => issueFeeFromSchedule(feeSchedule, issueTick),
        [feeSchedule, issueTick],
    );
    const liveFeeKnown = normalizeProtocolFee(protocolFeeQuote).known;
    const feesCardQuote = liveFeeKnown ? protocolFeeQuote : (scheduleFeeQuote || protocolFeeQuote);
    const feesCardPending = liveFeeKnown || scheduleFeeQuote ? false : protocolFeePending;

    // What is left mintable after the initial mint, as a display string, or
    // null when the pair is blank/invalid/fully minted (nothing to say).
    const mintHeadroom = useMemo(() => {
        const cap = String(supply).trim();
        const mintText = String(initialMint).trim();
        if (!mintText || compareDecimalStrings(cap, '0') !== 1) return null;
        if (compareDecimalStrings(mintText, '0') === -1
            || compareDecimalStrings(mintText, cap) === 1) return null;
        const left = subtractDecimalStrings(cap, mintText);
        return compareDecimalStrings(left, '0') === 1 ? left : null;
    }, [supply, initialMint]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'ISSUE',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    // What a submit validated, read again after the subtoken parent lookup
    // resolves: an answer about values no longer on screen is dropped.
    const parentCheckRef = useRef(false);
    const submitInputsRef = useRef('');
    submitInputsRef.current = JSON.stringify([stage, chainId, fromAddress?.address || null, actionParams]);

    // The chain refuses a subtoken whose parent is missing or owned by another
    // address, after the fee is spent. The parent has to exist, be owned by
    // this wallet, and be owned by the address that signs. An explorer that
    // cannot answer is a refusal, never a pass.
    async function parentOwnershipError() {
        if (flowsLib.isDemoWallet(walletId)) return null;
        const parent = parentToken.trim();
        const unconfirmed = `${parent} could not be confirmed as a token this wallet owns. `
            + 'Check the ticker and your connection, then try again.';
        if (typeof messaging?.getTokenInfo !== 'function') return unconfirmed;
        let info = null;
        try {
            info = await messaging.getTokenInfo({ chainId, tick: parent });
        } catch {
            return unconfirmed;
        }
        const creator = info?.creator;
        if (!creator) return unconfirmed;
        const owned = (addressesByChain?.[chainId] || []).map((a) => a?.address);
        if (!owned.includes(creator)) {
            return `This wallet does not own ${parent}. A subtoken can only be created by the owner of its parent.`;
        }
        if (creator !== fromAddress?.address) {
            return `${parent} is owned by another address in this wallet. Choose it in From as the address that pays the fee.`;
        }
        return null;
    }

    // Looks the parent up on every submit (it can change hands at any time),
    // then runs `next` only if nothing on screen changed meanwhile.
    async function afterParentCheck(next) {
        if (parentCheckRef.current) return;
        const checked = submitInputsRef.current;
        parentCheckRef.current = true;
        let parentError = null;
        try {
            parentError = await parentOwnershipError();
        } finally {
            parentCheckRef.current = false;
        }
        if (submitInputsRef.current !== checked) return;
        if (parentError) {
            setValidationAttempt((attempt) => attempt + 1);
            setFormError(parentError);
            return;
        }
        next();
    }

    function handleReview(event) {
        event.preventDefault();
        // Offline, the status slot already says why and the action is off.
        if (networkOffline || parentCheckRef.current) return;
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        setValidationAttempt((attempt) => attempt + 1);
        const inputsCheck = issueInputsCheck();
        if (inputsCheck?.queue) {
            // A submit that lands inside the debounce or the lookup is held
            // and replayed when the check settles, rather than refused.
            setFormError(null);
            queueReview(true);
            return;
        }
        if (inputsCheck) {
            setFormError(inputsCheck.error);
            return;
        }
        setFormError(null);
        const next = singleEncode ? () => { openConfirmScreen(); } : () => setStage('review');
        if (isSubtoken) { afterParentCheck(next); return; }
        next();
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode wallets have pubkeys but
    // no keys to sign with. Submit path routes through buildActionPsbt
    // (encode-only, no vault unlock, no signer, no broadcast); the user
    // takes the resulting unsigned PSBT to a Signer-mode wallet.
    // (`isWatcherMode` is read with the address load above.)

    // (§5.6 slice 2): the path composes ONE PSBT host-side
    // and confirms it on the shared confirm page.: hardware comes
    // through here too - it was excluded, which sent the users most likely
    // to care about verification down the legacy rebuild-on-Approve path
    // with no output-set tamper check, while the confirm page's own
    // hardware note tells them this screen is where action intent gets
    // verified. Watcher mode still branches (it encodes, it never signs).
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The form stays on screen while the host composes it; its fields hold
    // still so the confirm page opens for exactly the values on screen.
    const composing = actionConfirm.composing;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'issueToken',
        hardware: 'issueTokenHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        if (networkOffline) return;
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
                actionData: { action: 'ISSUE', params: actionParams },
                // The native-fee opt-in has to reach the COMPOSE step: the
                // FEE_DESTINATION output must be inside the PSBT the user
                // approves, not folded in on a later rebuild.
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
            // The draft is the token this approval just created. Kept, it
            // comes back as "unfinished" and invites a second ISSUE of the
            // same ticker, which the chain refuses after the fee or, with a
            // partial initial mint, honours by minting that amount again.
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: err?.message || 'Issue failed.',
            }));
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        if (networkOffline) return;
        setStage('submitting');
        setSubmitError(null);
        // The parent can change hands while Review sits open, and the chain
        // refuses the child after the fee, so the lookup runs again here.
        if (isSubtoken) {
            const parentError = await parentOwnershipError();
            if (parentError) {
                setSubmitError(parentError);
                setStage('review');
                return;
            }
        }
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
                params: actionParams,
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ISSUE', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.issueTokenHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.issueToken({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFeeMandatory,
                        fallback: err?.message || 'Issue failed.',
                    }),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }
        const header = (
        <PageHeader
            onBack={leaveGuard.guardedOnBack}
            // The host is composing the values on screen; leaving now would
            // open the confirm page over a form the user walked away from.
            backDisabled={composing}
            title={stage === 'review' || stage === 'submitting'
                    ? t('issue.reviewTitle')
                    : t('issue.title')}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
            {leaveGuard.confirmation}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(<ListPage><p className={styles.hint}>{t('common.loading')}</p></ListPage>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ListPage>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={handleBuildAnother}
                        onDone={leaveGuard.guardedOnBack}
                    />
                </ListPage>,
            );
        }
        // Signed but not broadcast, so the token does not exist yet.
        if (result?.queued) {
            return wrap(
                <ListPage>
                    <ResultScreen state="signed-not-broadcast" onDone={leaveGuard.guardedOnBack} what={t('issue.issuance')} unsaved={result.unsaved} />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>{t('issue.success')}</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>{t('send.txid')}</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>{t('issue.broadcastComplete')}</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={leaveGuard.guardedOnBack}>{t('common.done')}</Button>
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
                label={t('issue.reviewTokenIssue')}
                onSubmit={handleSubmit}
                status={(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: t('common.edit'), onAction: () => { setSubmitError(null); setStage('form'); } }}
                    >
                        {submitError}
                    </StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : isHwSource
                                    ? hwStatus !== 'available'
                                    : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? t('send.review.createUnsigned')
                            : t('send.review.sign')}
                    </Button>
                )}
            >
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('send.fields.chain')}</dt>
                            <dd className={styles.detailsValue}><ChainBadge descriptor={descriptor} size="sm" /></dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>{t('send.fields.from')}</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(decoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label={t('send.networkFee')}
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
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        {t('common.watcherBuildsUnsigned')}
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
                    />
                )}
            </FormPage>,
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        // Hero and before and after, from what this form already holds:
        // the supply this ISSUE creates, whether the ticker is new (the
        // availability check), where the supply lands, and the protocol fee
        // the Fees card quoted. A ticker the check could not answer has no
        // known "before", so its supply rows are left out.
        const issuedSupply = actionParams.MINT_SUPPLY || '';
        const confirmTick = issueTick.toUpperCase();
        const tickerIsNew = !!lookupTick && tickerCheck.ticker === lookupTick && tickerCheck.status === 'available';
        const issueChanges = [];
        if (tickerIsNew && issuedSupply) {
            issueChanges.push({
                label: t('components.confirmSummary.supply', { tick: confirmTick }),
                before: t('components.confirmSummary.none'),
                after: formatDisplayAmount(issuedSupply),
            });
            if (!actionParams.TRANSFER_SUPPLY) {
                issueChanges.push({
                    label: t('components.confirmSummary.your', { tick: confirmTick }),
                    before: '0',
                    after: formatDisplayAmount(issuedSupply),
                    tick: confirmTick,
                });
            }
        }
        const quotedFee = normalizeProtocolFee(feesCardQuote);
        const issueSummary = {
            verb: t('components.confirmSummary.verbIssue'),
            amount: issuedSupply,
            ticker: confirmTick,
            chainId,
            direction: 'in',
            address: fromAddress?.address,
            recipient: actionParams.TRANSFER_SUPPLY || undefined,
            changes: issueChanges,
            networkFee: feeEstimate?.coinAmount ? { amount: String(feeEstimate.coinAmount), ticker: coinTicker } : undefined,
            // The XCHAIN lane only: a native-coin fee is a composed output the
            // screen reads from the transaction itself.
            protocolFee: !payFeeInNativeCoin && quotedFee.known
                ? { amount: quotedFee.free ? '0' : String(quotedFee.amount ?? ''), ticker: 'XCHAIN' }
                : undefined,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={issueSummary}
                screenVariant={variant}
                chainLabel={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                feeText={feeEstimate?.coinAmount
                    ? t('send.networkFeeValue', {
                        amount: feeEstimate.coinAmount,
                        ticker: coinTicker,
                    }).trim()
                        + (feeFiat ? ` (${feeFiat})` : '')
                    : t('common.networkFeeUnavailable')}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                formatNativeFee={formatNativeFee}
                formatProtocolFee={formatProtocolFee}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title={t('send.fromAddress')}
                walletId={walletId}
                chainId={chainId}
                onChainChange={setChainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                variant={variant}
                contacts={contacts}
                onPick={(entry) => {
                    if (contactsTarget === 'supply') setTransferSupplyTo(entry.address);
                    else setTransferTo(entry.address);
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    // The same TYPE=2 address-list picker the admin access-lists mode uses,
    // so create and edit bind lists identically.
    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
                filterType="2"
                title={listPickerFor === 'allow' ? t('issue.chooseAllowListTitle') : t('issue.chooseBlockListTitle')}
                onSelect={(row) => {
                    const pick = {
                        index: String(row.actionIndex),
                        name: typeof row.name === 'string' && row.name.length > 0 ? row.name : null,
                    };
                    if (listPickerFor === 'allow') {
                        setAllowList(pick.index);
                        setAllowListPick(pick);
                    } else {
                        setBlockList(pick.index);
                        setBlockListPick(pick);
                    }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    // A subtoken's own name is the child half of PARENT.CHILD.
    const tickerLabel = isSubtoken ? t('issue.subtokenName') : t('issue.ticker');
    const offlineNotice = networkOffline ? (
        <StatusMessage key="offline" variant="warning">{t('issue.offline')}</StatusMessage>
    ) : null;
    const listRowLabel = (pick, value) => (
        pick && value.trim() === pick.index ? listLabel(pick.index, pick.name) : undefined
    );

    const draftBanner = draft.hasDraft() && !draftPending ? (
        <StatusMessage
            variant="status"
            recovery={{ label: t('send.draft.restore'), onAction: restoreDraft }}
        >
            {t('issue.draft.unfinished')}
            <DraftDiscardButton onClick={dismissDraft} label={t('send.draft.discardLabel')}>
                {t('send.draft.discard')}
            </DraftDiscardButton>
        </StatusMessage>
    ) : null;

    let issueErrorTarget;
    if (/^Callback token/i.test(formError || '')) issueErrorTarget = { id: 'issue-callback-tick', label: 'Callback token' };
    else if (/Callback payout/i.test(formError || '')) issueErrorTarget = { id: 'issue-callback-amount', label: 'Payout per unit' };
    else if (/callback/i.test(formError || '')) issueErrorTarget = { id: 'issue-callback-block', label: 'Callback allowed from block' };
    else if (/^Parent ticker|does not own|confirmed as a token|owned by another address/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-parent-ticker', label: 'Parent ticker' };
    } else if (/^Image URL/i.test(formError || '')) issueErrorTarget = { id: 'issue-image-url', label: 'Image URL' };
    else if (/ticker/i.test(formError || '')) issueErrorTarget = { id: 'issue-ticker', label: tickerLabel };
    else if (/^Max supply /i.test(formError || '')) issueErrorTarget = { id: 'issue-supply', label: 'Max supply' };
    else if (/initial mint/i.test(formError || '') && !/destination|Sending the initial mint/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-initial-mint', label: 'Initial mint' };
    } else if (/Max mint per address/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-mint-address-max', label: 'Max per address' };
    } else if (/Max mint/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-max-mint', label: 'Max mint per transaction' };
    } else if (/Start block/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-mint-start-block', label: 'Start block' };
    } else if (/Stop block/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-mint-stop-block', label: 'Stop block' };
    } else if (/Allow list/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-allow-list', label: 'Allow list' };
    } else if (/Block list/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-block-list', label: 'Block list' };
    } else if (/Description/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-description', label: 'Description' };
    } else if (/Transfer ownership/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-transfer-owner', label: 'Transfer ownership to' };
    } else if (/Initial mint destination|Sending the initial mint/i.test(formError || '')) {
        issueErrorTarget = { id: 'issue-transfer-supply', label: 'Send the initial mint to' };
    }
    const issueErrors = formError
        ? [{ ...issueErrorTarget, message: formError }]
        : [];
    // One-line summaries of the closed standard sections.
    const tokenSummary = joinSummary(
        issueTick.toUpperCase(),
        isPositiveDecimal(supply) ? `${formatDisplayAmount(supply.trim())} max` : null,
        divisible ? 'divisible' : 'not divisible',
    );
    const initialMintSummary = isPositiveDecimal(initialMint)
        ? [
            `${formatDisplayAmount(initialMint.trim())} minted`,
            transferSupplyTo.trim() ? `to ${summaryAddress(transferSupplyTo)}` : null,
        ].filter(Boolean).join(' ')
        : t('issue.summary.notSet');
    const mintingSetCount = [maxMint, mintAddressMax, mintStartBlock, mintStopBlock]
        .filter((value) => String(value).trim()).length;
    const lockCount = ISSUE_LOCKS.filter((lock) => locks[lock.key]).length;
    // A section holding the current error reopens on every attempt,
    // even after the user closed it, so the error summary can focus its field.
    // A custom fee refusal (the review's fee stop) belongs to Network fee.
    const feeStopNow = formError
        ? customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate })
        : null;
    const errorSection = feeStopNow && feeStopNow.formError === formError
        ? 'fee'
        : issueErrorSection(formError);
    const sectionErrorKey = (id) => (errorSection === id ? validationAttempt + 1 : 0);
    const sectionProps = (id) => ({ ...formSections.bind(id), revealKey: sectionErrorKey(id) });
    // No source to default to: no funding address on the network (the default
    // skips dispenser-delegated ones) and none picked by hand.
    const sourceMissing = Boolean(addressesByChain) && !fromAddress && (chainId
        ? (addressesByChain[chainId] || []).filter((a) => a.role !== 'dispenser').length === 0
        : chainsWithAddresses.length === 0);
    const shownProtocolFee = normalizeProtocolFee(feesCardQuote);
    // The XCHAIN protocol fee joins the Network fee row's summary.
    const protocolSummary = !payFeeInNativeCoin && shownProtocolFee.known
        && !shownProtocolFee.free && shownProtocolFee.amount != null
        ? `${shownProtocolFee.amount} XCHAIN protocol fee`
        : undefined;
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={t('issue.title')}
            // The one-page Issue token form is framed on wide screens like every other form.
            onSubmit={handleReview}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            status={[offlineNotice, <FormErrorSummary key="errors" errors={issueErrors} focusKey={validationAttempt} />, draftBanner]}
            action={(
                // Always Issue Token, with the Issue action's icon
                // (ActionsMenu's issue: PlusIcon), with or without a supply.
                <FormAction
                    icon={<Icon.PlusIcon />}
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !ticker.trim() || actionConfirm.composing || networkOffline}
                >
                    {t('issue.title')}
                </FormAction>
            )}
            from={(
                // Issue has no asset, so the From section's Network
                // chooses the network the token is issued on.
                <FromSection
                    {...sectionProps('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={setChainId}
                    // While composing both fields wait (FromSection disabled).
                    disabled={composing}
                    networkHelp={isSubtoken
                        ? t('issue.subtokenNetworkHelp')
                        : t('issue.networkHelp')}
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel={t('send.source.choose')}
                    // The chain refuses a subtoken signed by anyone but the
                    // parent's owner, and its refusal names TICK, not the signer.
                    addressHelp={isSubtoken
                        ? t('issue.subtokenFromHelp')
                        : t('issue.fromHelp')}
                    // Only once the addresses have loaded and the
                    // network truly has none, so neither a slow read nor the
                    // render before the default address is picked opens From.
                    missing={sourceMissing ? (
                        <FormNotice variant="error">
                            {t('send.source.noAddress')}
                        </FormNotice>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...sectionProps('fee')}
                    // A new network remounts the selector.
                    key={chainId || 'none'}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    disabled={composing}
                    protocolSummary={protocolSummary}
                    fees={{
                        quote: feesCardQuote,
                        pending: feesCardPending,
                        fiat: feeFiatFormatters,
                        nativeFeeProps: {
                            disabled: composing,
                            checked: payFeeInNativeCoin,
                            onChange: setPayFeeInNativeCoin,
                            coinTicker,
                            mandatory: nativeFeeMandatory,
                        },
                    }}
                />
            )}
        >
            <FormSection
                id="token"
                title={t('send.fields.token')}
                icon={Icon.TokenIcon}
                {...sectionProps('token')}
                summary={tokenSummary}
            >
            {/* The template picker pre-fills the settings a common kind of token
                uses; every field stays editable. It leads the Token section. */}
            <IconSelect
                size="md"
                // No label; the picker itself reads Select template.
                aria-label={t('issue.selectTemplate')}
                value={preset}
                onChange={(value) => {
                    setPreset(value);
                    const fill = ISSUE_PRESETS[value];
                    if (!fill) return;
                    if (fill.supply !== undefined) setSupply(fill.supply);
                    if (fill.initialMint !== undefined) setInitialMint(fill.initialMint);
                    if (fill.mintAddressMax !== undefined) setMintAddressMax(fill.mintAddressMax);
                    if (fill.divisible !== undefined) setDivisible(fill.divisible);
                    if (fill.locks) setLocks(fill.locks);
                }}
                options={[
                    { value: '', label: 'Select template', sub: 'Optional: fills in the usual settings.', icon: <Icon.PencilIcon /> },
                    { value: 'meme', label: 'Meme token', sub: 'Fixed supply, locked, not divisible.', icon: <Icon.CoinsIcon /> },
                    // Every token can pay dividends; no template has to be picked for it.
                    { value: 'utility', label: 'Utility token', sub: 'Mintable, adjustable supply, divisible. Every token can pay dividends.', icon: <Icon.GearIcon /> },
                    { value: 'collectible', label: 'Collectible', sub: 'One of a kind: supply 1, locked.', icon: <Icon.ImageIcon /> },
                    { value: 'edition', label: 'Limited edition', sub: 'A fixed set; one per address to mint.', icon: <Icon.CopyIcon /> },
                    { value: 'subtoken', label: 'Subtoken', sub: 'Named subtoken under a ticker you own.', icon: <Icon.LinkIcon /> },
                ]}
            />
            {/* Network and From live in the From section above. */}
            {isSubtoken ? (
                <Input
                    disabled={composing}
                    id="issue-parent-ticker"
                    label={t('issue.parentTicker')}
                    required
                    help={t('issue.parentTickerHelp')}
                    maxLength={MAX_TICKER_LENGTH}
                    value={parentToken}
                    onChange={(e) => setParentToken(e.target.value)}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
            <Input
                disabled={composing}
                id="issue-ticker"
                // The Token section is required, so its required
                // field carries no tag; its optional fields carry Optional.
                label={tickerLabel}
                aria-label={tickerLabel}
                required
                help={TICKER_HELP}
                maxLength={MAX_TICKER_LENGTH}
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                error={tickerTaken
                    ? t('issue.tickerTaken', { ticker: lookupTick })
                    : undefined}
            />
                    {/* Amount fields at the precision Divisible sets: 8 places on, whole
                        numbers off. Switching it re-formats the stored value at once and
                        a value finer than the new precision shows its field error. */}
                    <AmountField
                        disabled={composing}
                        id="issue-supply"
                        aria-required="false"
                        // An optional field in the required Token section.
                        optional
                        label={t('issue.maxSupply')}
                        help={t('issue.supplyHint')}
                        amount={supply}
                        divisibility={amountDecimals}
                        onAmountFieldChange={(rawValue) => setSupply(String(rawValue).replace(/,/g, ''))}
                        onValidationError={(message) => setAmountInputErrors((prev) => ({ ...prev, supply: message }))}
                    />
                    <Switch
                        disabled={composing}
                        label={t('issue.divisible')}
                        help={t('issue.divisibleHelp')}
                        checked={divisible}
                        onChange={(event) => setDivisible(event.target.checked)}
                    />
            </FormSection>

                {/* The initial mint and where it goes are their own optional
                    section, apart from Token. */}
                <FormSection
                    id="initialMint"
                    title={t('issue.initialMint')}
                    icon={Icon.CoinsIcon}
                    optional
                    {...sectionProps('initialMint')}
                    summary={initialMintSummary}
                >
                    <AmountField
                        disabled={composing}
                        id="issue-initial-mint"
                        aria-required="false"
                        label={t('issue.initialMint')}
                        help={t('issue.initialMintHint')}
                        hint={mintHeadroom
                            ? t('issue.initialMintHeadroom', { amount: mintHeadroom })
                            : undefined}
                        amount={initialMint}
                        divisibility={amountDecimals}
                        onAmountFieldChange={(rawValue) => setInitialMint(String(rawValue).replace(/,/g, ''))}
                        onValidationError={(message) => setAmountInputErrors((prev) => ({ ...prev, initialMint: message }))}
                        onMax={() => setInitialMint(supply.trim())}
                        maxDisabled={composing || !isPositiveDecimal(supply)}
                    />
                    {/* Divisible sits in the Token section. */}
                    <AddressField
                        disabled={composing}
                        id="issue-transfer-supply"
                        label={t('issue.sendInitialMint')}
                        icon="contacts"
                        help={t('issue.sendInitialMintHint')}
                        value={transferSupplyTo}
                        onChange={(e) => setTransferSupplyTo(e.target.value)}
                        onIconClick={() => { setContactsTarget('supply'); setContactsPickerOpen(true); }}
                        aria-required="false"
                    />
                </FormSection>

                <FormSection
                    id="publicMinting"
                    title={t('issue.section.publicMinting')}
                    summary={mintingSetCount
                        ? t('issue.summary.setCount', { count: mintingSetCount })
                        : t('issue.summary.notSet')}
                    icon={Icon.MintIcon}
                    optional
                    {...sectionProps('publicMinting')}
                >
                    <AmountField
                        disabled={composing}
                        id="issue-max-mint"
                        aria-required="false"
                        label={t('issue.maxMint')}
                        help={t('issue.maxMintHelp')}
                        amount={maxMint}
                        divisibility={amountDecimals}
                        onAmountFieldChange={(rawValue) => setMaxMint(String(rawValue).replace(/,/g, ''))}
                        onValidationError={(message) => setAmountInputErrors((prev) => ({ ...prev, maxMint: message }))}
                        onMax={() => setMaxMint(supply.trim())}
                        maxDisabled={composing || !isPositiveDecimal(supply)}
                    />
                    <AmountField
                        disabled={composing}
                        id="issue-mint-address-max"
                        aria-required="false"
                        label={t('issue.mintAddressMax')}
                        help={t('issue.mintAddressMaxHelp')}
                        amount={mintAddressMax}
                        divisibility={amountDecimals}
                        onAmountFieldChange={(rawValue) => setMintAddressMax(String(rawValue).replace(/,/g, ''))}
                        onValidationError={(message) => setAmountInputErrors((prev) => ({ ...prev, mintAddressMax: message }))}
                        onMax={() => setMintAddressMax(supply.trim())}
                        maxDisabled={composing || !isPositiveDecimal(supply)}
                    />
                    <Input
                        disabled={composing}
                        id="issue-mint-start-block"
                        label={t('issue.mintStartBlock')}
                        help={t('issue.mintStartBlockHelp')}
                        inputMode="numeric"
                        value={mintStartBlock}
                        onChange={(e) => setMintStartBlock(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                    <Input
                        disabled={composing}
                        id="issue-mint-stop-block"
                        label={t('issue.mintStopBlock')}
                        help={t('issue.mintStopBlockHelp')}
                        inputMode="numeric"
                        value={mintStopBlock}
                        onChange={(e) => setMintStopBlock(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                </FormSection>

                <FormSection
                    id="description"
                    title={t('issue.section.description')}
                    summary={description.trim()
                        ? t('issue.summary.descriptionAdded')
                        : t('issue.summary.notSet')}
                    icon={Icon.PencilIcon}
                    optional
                    {...sectionProps('description')}
                >
                    <Textarea
                        disabled={composing}
                        id="issue-description"
                        // The standard section header has no count slot,
                        // so the field's own label row shows the on-chain cap count.
                        label={t('issue.section.description')}
                        help={t('issue.descriptionHelp')}
                        aria-label={t('issue.descriptionAria')}
                        maxLength={MAX_ISSUE_TEXT_LENGTH}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        autoComplete="off"
                        rows={4}
                        aria-required="false"
                    />
                    {/* Collectible and Limited edition carry their artwork as an
                        image URL in DESCRIPTION, in place of the text above. */}
                    {usesImageUrl ? (
                        <Input
                            disabled={composing}
                            id="issue-image-url"
                            label={t('issue.imageUrl')}
                            required
                            help={t('issue.imageUrlHelp')}
                            inputMode="url"
                            maxLength={MAX_ISSUE_TEXT_LENGTH}
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    ) : null}
                </FormSection>

                <FormSection
                    id="locks"
                    title={t('issue.section.locks')}
                    // The Irreversible tag sits in FormSection's tag slot, after Optional.
                    tag={<span className={styles.irreversibleTag}>{t('issue.irreversible')}</span>}
                    summary={lockCount
                        ? t(lockCount === 1 ? 'issue.summary.oneLockOn' : 'issue.summary.locksOn', {
                            count: lockCount,
                        })
                        : t('issue.summary.notSet')}
                    icon={Icon.LockIcon}
                    optional
                    {...sectionProps('locks')}
                >
                    <div className={styles.lockRows}>
                        {ISSUE_LOCKS.map((lock) => {
                            const checked = !!locks[lock.key];
                            const StateIcon = checked ? Icon.LockIcon : Icon.UnlockIcon;
                            return (
                                <div className={styles.lockRow} key={lock.key}>
                                    <span className={checked ? styles.lockIconOn : styles.lockIcon} aria-hidden="true">
                                        <StateIcon />
                                    </span>
                                    <Switch
                                        disabled={composing}
                                        id={`issue-lock-${lock.key}`}
                                        label={lock.label}
                                        description={lock.description}
                                        checked={checked}
                                        onChange={(e) => setLocks((current) => ({
                                            ...current,
                                            [lock.key]: e.target.checked,
                                        }))}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </FormSection>

                <FormSection
                    id="lists"
                    title={t('issue.section.lists')}
                    summary={allowList.trim() || blockList.trim()
                        ? t('issue.summary.set')
                        : t('issue.summary.notSet')}
                    icon={Icon.TokenListIcon}
                    optional
                    {...sectionProps('lists')}
                >
                    <Input
                        disabled={composing}
                        id="issue-allow-list"
                        label={t('issue.allowList')}
                        help={t('issue.allowListHelp')}
                        inputMode="numeric"
                        hint={listRowLabel(allowListPick, allowList)}
                        value={allowList}
                        onChange={(e) => setAllowList(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                    {/* The published address lists this wallet owns, by name,
                        so a list need not be found by its number. */}
                    <div className={styles.actions}>
                        <Button type="button" variant="ghost" disabled={composing} onClick={() => setListPickerFor('allow')}>
                            {allowList.trim() ? t('issue.changeAllowList') : t('issue.chooseAllowList')}
                        </Button>
                        {allowList.trim() ? (
                            <Button type="button" variant="ghost" disabled={composing} aria-label={t('issue.removeAllowList')} onClick={() => { setAllowList(''); setAllowListPick(null); }}>
                                {t('issue.removeList')}
                            </Button>
                        ) : null}
                    </div>
                    <Input
                        disabled={composing}
                        id="issue-block-list"
                        label={t('issue.blockList')}
                        help={t('issue.blockListHelp')}
                        inputMode="numeric"
                        hint={listRowLabel(blockListPick, blockList)}
                        value={blockList}
                        onChange={(e) => setBlockList(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                    <div className={styles.actions}>
                        <Button type="button" variant="ghost" disabled={composing} onClick={() => setListPickerFor('block')}>
                            {blockList.trim() ? t('issue.changeBlockList') : t('issue.chooseBlockList')}
                        </Button>
                        {blockList.trim() ? (
                            <Button type="button" variant="ghost" disabled={composing} aria-label={t('issue.removeBlockList')} onClick={() => { setBlockList(''); setBlockListPick(null); }}>
                                {t('issue.removeList')}
                            </Button>
                        ) : null}
                    </div>
                </FormSection>

                <FormSection
                    id="callback"
                    title={t('issue.section.callback')}
                    summary={callbackTick.trim() && callbackAmount.trim() && callbackBlock.trim()
                        ? t('issue.summary.callback', {
                            amount: callbackAmount.trim(),
                            ticker: callbackTick.trim().toUpperCase(),
                        })
                        : t('issue.summary.notSet')}
                    icon={Icon.CoinsIcon}
                    optional
                    {...sectionProps('callback')}
                >
                    {/* A callback recalls all of this token later, paying every
                        holder a set amount of another token per unit held. It can
                        only be set before supply is distributed, so issuance is
                        where it is guaranteed to be available. */}
                    <Input
                        disabled={composing}
                        id="issue-callback-tick"
                        label={t('issue.callbackTick')}
                        help={t('issue.callbackTickHelp')}
                        value={callbackTick}
                        onChange={(e) => setCallbackTick(e.target.value.toUpperCase())}
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-required="false"
                    />
                    <Input
                        disabled={composing}
                        id="issue-callback-amount"
                        label={t('issue.callbackAmount')}
                        help={t('issue.callbackAmountHelp')}
                        hint={callbackTickDecimals == null
                            ? t('issue.callbackAmountWhole')
                            : callbackTickDecimals === 1
                                ? t('issue.callbackAmountDecimal')
                                : t('issue.callbackAmountDecimals', { count: callbackTickDecimals })}
                        inputMode="decimal"
                        value={callbackAmount}
                        onChange={(e) => setCallbackAmount(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                    <Input
                        disabled={composing}
                        id="issue-callback-block"
                        label={t('issue.callbackBlock')}
                        help={t('issue.callbackBlockHelp')}
                        hint={(() => {
                            const estimate = blockDateEstimateText({
                                coin: descriptor?.coin, currentHeight, targetBlock: callbackBlock,
                            });
                            const tip = currentHeight != null
                                ? t('issue.callbackCurrentBlock', { height: currentHeight.toLocaleString('en-US') })
                                : null;
                            return [estimate ? t('issue.callbackBlockEstimate', { estimate }) : null, tip]
                                .filter(Boolean).join(' ') || undefined;
                        })()}
                        inputMode="numeric"
                        value={callbackBlock}
                        onChange={(e) => setCallbackBlock(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                </FormSection>

                <FormSection
                    id="ownership"
                    title={t('issue.section.ownership')}
                    summary={transferTo.trim()
                        ? t('issue.summary.newOwner')
                        : t('issue.summary.notSet')}
                    icon={Icon.UserIcon}
                    optional
                    {...sectionProps('ownership')}
                >
                    <AddressField
                        disabled={composing}
                        id="issue-transfer-owner"
                        label={t('issue.transferOwnership')}
                        icon="contacts"
                        help={t('issue.transferOwnershipHint')}
                        value={transferTo}
                        onChange={(e) => setTransferTo(e.target.value)}
                        onIconClick={() => { setContactsTarget('owner'); setContactsPickerOpen(true); }}
                        aria-required="false"
                    />
                </FormSection>
            {/* The FeesCard (network fee selector, protocol fee and the
                pay-in-native switch) opens from the one Network fee section. */}
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

// What each "Start from" preset fills in. Fields a preset leaves
// out keep whatever the form holds.
// Every preset names its initial mint and per-address limit, so switching
// from one preset to another never carries a fair mint (initial mint 0) onto
// a template that locks minting, which would issue a token with no supply.
const ISSUE_PRESETS = {
    meme: { divisible: false, initialMint: '', mintAddressMax: '', locks: { maxSupply: true, maxMint: true, minting: true, mintSupply: true } },
    utility: { divisible: true, initialMint: '', mintAddressMax: '', locks: {} },
    collectible: { supply: '1', initialMint: '1', mintAddressMax: '', divisible: false, locks: { maxSupply: true, minting: true, mintSupply: true } },
    // A fair mint: the cap locks at issuance with nothing minted (initial mint
    // 0 omits MINT_SUPPLY), so every print stays publicly mintable.
    edition: { divisible: false, initialMint: '0', mintAddressMax: '1', locks: { maxSupply: true } },
    // A subtoken changes no field; it adds the Parent ticker.
    subtoken: {},
};
