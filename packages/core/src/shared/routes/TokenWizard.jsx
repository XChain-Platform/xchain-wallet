// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, AddressText, Button, ChainBadge, ChainPicker, Checkbox, CopyButton, FormNotice, FormPage, FormSection, Input, ListPage, ListRow, PageHeader, Screen, SectionHeader, StatusMessage, Switch } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/issue.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { blockDateEstimateText } from '../utils/blockDateEstimate.js';
import {
    LOCK_FLAGS,
    applyAdvancedIssueFields,
    validateAdvancedIssueFields,
    advancedIssueWarnings,
} from '../utils/issueAdvancedFields.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { TICKER_HINT, tickerGrammarError } from '../utils/tickerGrammar.js';
import {
    MAX_ISSUE_TEXT_LENGTH,
    issueDescriptionError,
    issueImageUrlError,
    issueSupplyLimitError,
} from '../utils/issueFieldValidation.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { tickLookupVerdict } from '../utils/listTickItems.js';
import styles from './TokenWizard.module.css';
import { useNativeFee } from '../hooks/useNativeFee.js';
import {
    hasAnyAddress,
    preferredSourceId,
    signingAddressesByChain,
    WATCH_ONLY_SIGNING_MESSAGE,
} from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { listLabel } from '../utils/listLabel.js';
import { compareDecimalStrings } from '../utils/amountFormat.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { useSettings } from '../hooks/useSettings.js';
import { useFormDraft } from '../hooks/useFormDraft.js';
import { getActiveNetwork } from '../../flows/effectiveNetwork.js';
import { DraftDiscardButton } from '../components/DraftDiscardButton.jsx';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useHideReachabilityNotice } from '../components/hideReachabilityNotice.js';

const chainRegistry = registryLib.defaultRegistry();

// Native coin ticker per protocol coin (label for the native-fee toggle).
const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

// How long the ticker availability lookup may run before the wizard stops
// waiting on it and lets composition judge the name, as on Issue token.
const TICKER_LOOKUP_TIMEOUT_MS = 8000;

function isPositiveDecimal(value) {
    const text = String(value || '').trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') === 1;
}

function hasAmountPrecision(value, decimals) {
    const [, fraction = ''] = String(value || '').trim().split('.');
    return fraction.length <= decimals;
}

function isValidIssueAddress(value, descriptor) {
    return !!descriptor?.coin && !!descriptor?.networkKind
        && isValidAddressForChain(String(value).trim(), descriptor.coin, descriptor.networkKind);
}

/**
 * Token Creation Wizard (§40.1).
 *
 * Four guided stages: template, network, details, and review. The shared
 * confirmation page follows review and signs the host-composed transaction.
 *
 *   template:  pick one of six templates (§40.1), each with its own
 *              detail form. Utility also covers dividend use because
 *              every token supports dividends.
 *   chain:     pick the chain to create the token on. Filtered to
 *              chains the wallet already has an address on (needs a
 *              fee-paying address). Defaults to the chain's active
 *              address, else the newest external HD address.
 *   details:   template-specific fields. Custom exposes all ISSUE v0
 *              fields (ticker, supply, max-mint, decimals, description,
 *              lock flags, transfer-ownership).
 *   review:    plain-English summary from `decoder.decodeAction`, including
 *              the template, source, fee choice, and every ISSUE parameter.
 *   confirm:   host composition, pre-flight, and signing through the shared
 *              confirmation page.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function TokenWizard({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    const networkAvailable = !networkOffline;
    useHideReachabilityNotice(networkOffline);
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();
    const { settings } = useSettings();

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the fee payer resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [stage, setStage] = useState(
        /** @type {'template' | 'chain' | 'details' | 'preview' | 'done'} */ ('template'),
    );
    const [template, setTemplate] = useState(
        /** @type {null | 'meme' | 'utility' | 'collectible' | 'edition' | 'subtoken' | 'custom'} */ (null),
    );
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    // Whether the user has chosen the signer by hand. The auto-pick effect
    // below re-runs whenever the chain changes and would otherwise walk a
    // deliberate choice straight back to the default address.
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [sourceChosenFor, setSourceChosenFor] = useState(/** @type {string | null} */ (null));
    // The address book behind the two recipient fields, as on Issue token:
    // one picker, and which field it is filling.
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contactsTarget, setContactsTarget] = useState(/** @type {'owner' | 'supply'} */ ('owner'));
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listContacts !== 'function') return undefined;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(rows || []); })
            .catch(() => { if (!cancelled) setContacts([]); });
        return () => { cancelled = true; };
    }, [messaging]);

    // Details form state (some fields are only visible for certain
    // templates (see renderDetailsStage). Keeping all state here so
    // the user can flip between templates without re-typing.
    const [name, setName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [supply, setSupply] = useState('');
    const [divisible, setDivisible] = useState(false);
    const [description, setDescription] = useState('');
    const [maxMint, setMaxMint] = useState('');
    const [lockOnCreate, setLockOnCreate] = useState(false);
    const [transferTo, setTransferTo] = useState('');
    // Where the initial mint lands (ISSUE TRANSFER_SUPPLY). Separate from
    // ownership: the chain keeps the minted units with the issuer unless this
    // is set, which the standalone form learned from a testnet report.
    const [transferSupplyTo, setTransferSupplyTo] = useState('');
    const [imageUrl, setImageUrl] = useState('');         // collectible + edition
    const [parentToken, setParentToken] = useState('');   // subtoken only
    // Edition-only public-mint window fields.
    const [perAddressMax, setPerAddressMax] = useState('');
    const [mintStartBlock, setMintStartBlock] = useState('');
    const [mintStopBlock, setMintStopBlock] = useState('');
    // PC-06: the Custom template's advanced disclosure. These are the
    // ISSUE v0 fields that used to be reachable only as post-create
    // admin edits (PC-02 locks / PC-03 callback / PC-04 access lists),
    // so a fair-mint token can be fully configured in one transaction.
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [lockChecks, setLockChecks] = useState(
        /** @type {Record<string, boolean>} */ ({}),
    );
    const [callbackTick, setCallbackTick] = useState('');
    const [callbackAmount, setCallbackAmount] = useState('');
    const [callbackBlock, setCallbackBlock] = useState('');
    const [allowListIdx, setAllowListIdx] = useState(/** @type {string | null} */ (null));
    const [blockListIdx, setBlockListIdx] = useState(/** @type {string | null} */ (null));
    const [allowListCount, setAllowListCount] = useState(/** @type {number | null} */ (null));
    const [blockListCount, setBlockListCount] = useState(/** @type {number | null} */ (null));
    const [allowListName, setAllowListName] = useState(/** @type {string | null} */ (null));
    const [blockListName, setBlockListName] = useState(/** @type {string | null} */ (null));
    const [listPickerFor, setListPickerFor] = useState(
        /** @type {'allow' | 'block' | null} */ (null),
    );
    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    // Divisibility of the CALLBACK token. `null` means "not proven",
    // which the validator treats as indivisible - see
    // issueAdvancedFields.js for why that is the safe direction.
    const [callbackTickDecimals, setCallbackTickDecimals] = useState(
        /** @type {number | null} */ (null),
    );
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);

    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const submitPendingRef = useRef(false);
    const parentCheckRef = useRef(false);

    // The same resumable draft Issue token keeps: form values only, keyed to
    // the wallet and the active network, never the password or the stage.
    const formDraftTtlMs = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : undefined;
    const draftNetwork = settings ? getActiveNetwork(settings) : null;
    const draft = useFormDraft({ view: 'token-wizard', walletId, network: draftNetwork, ttlMs: formDraftTtlMs });
    // A stored draft waits for an explicit Restore. A fresh wizard starts
    // saving immediately so an auto-lock unmount cannot erase typed values.
    const [draftPending, setDraftPending] = useState(() => !draft.hasDraft());
    // Settings resolve after the first render; once the network is known a draft
    // from another network reads as absent, so the wizard saves from then on.
    useEffect(() => {
        if (draftNetwork && !draft.hasDraft()) setDraftPending(true);
    }, [draftNetwork]); // eslint-disable-line react-hooks/exhaustive-deps
    const restoreDraft = useCallback(() => {
        const v = draft.load();
        if (!v) { setDraftPending(true); return; }
        const text = (value, set) => { if (typeof value === 'string') set(value); };
        const restoredTemplate = typeof v.template === 'string'
            && TEMPLATE_FIELDS[resolveTemplate(v.template)]
            ? resolveTemplate(v.template)
            : null;
        // Only a network this wallet can still sign on comes back, and only a
        // signer the user chose by hand; otherwise the default pick stands.
        const restoredChain = typeof v.chainId === 'string' && addressesByChain?.[v.chainId]
            ? v.chainId
            : null;
        if (restoredTemplate) setTemplate(restoredTemplate);
        if (restoredChain) {
            setChainId(restoredChain);
            if (v.sourceChosen === true && typeof v.fromAddressId === 'string'
                && addressesByChain[restoredChain].some((a) => a.id === v.fromAddressId)) {
                setFromAddressId(v.fromAddressId);
                setSourceChosenFor(restoredChain);
            }
        }
        text(v.name, setName);
        text(v.displayName, setDisplayName);
        text(v.supply, setSupply);
        text(v.description, setDescription);
        text(v.maxMint, setMaxMint);
        text(v.transferTo, setTransferTo);
        text(v.transferSupplyTo, setTransferSupplyTo);
        text(v.imageUrl, setImageUrl);
        text(v.parentToken, setParentToken);
        text(v.perAddressMax, setPerAddressMax);
        text(v.mintStartBlock, setMintStartBlock);
        text(v.mintStopBlock, setMintStopBlock);
        text(v.callbackTick, setCallbackTick);
        text(v.callbackAmount, setCallbackAmount);
        text(v.callbackBlock, setCallbackBlock);
        if (typeof v.divisible === 'boolean') setDivisible(v.divisible);
        if (typeof v.lockOnCreate === 'boolean') setLockOnCreate(v.lockOnCreate);
        if (typeof v.showAdvanced === 'boolean') setShowAdvanced(v.showAdvanced);
        if (typeof v.payFeeInNativeCoin === 'boolean') setPayFeeInNativeCoin(v.payFeeInNativeCoin);
        if (v.lockChecks && typeof v.lockChecks === 'object') {
            /** @type {Record<string, boolean>} */
            const checks = {};
            for (const flag of LOCK_FLAGS) {
                if (v.lockChecks[flag.key] === true) checks[flag.key] = true;
            }
            setLockChecks(checks);
        }
        const list = (idx, count, listName) => [
            typeof idx === 'string' && idx ? idx : null,
            Number.isFinite(count) ? count : null,
            typeof listName === 'string' && listName ? listName : null,
        ];
        const [allowIdx, allowCount, allowName] = list(v.allowListIdx, v.allowListCount, v.allowListName);
        setAllowListIdx(allowIdx);
        setAllowListCount(allowIdx ? allowCount : null);
        setAllowListName(allowIdx ? allowName : null);
        const [blockIdx, blockCount, blockName] = list(v.blockListIdx, v.blockListCount, v.blockListName);
        setBlockListIdx(blockIdx);
        setBlockListCount(blockIdx ? blockCount : null);
        setBlockListName(blockIdx ? blockName : null);
        setFormError(null);
        if (restoredTemplate) setStage(restoredChain ? 'details' : 'chain');
        setDraftPending(true);
    }, [draft, addressesByChain, setPayFeeInNativeCoin]);
    const dismissDraft = useCallback(() => {
        draft.clear();
        setDraftPending(true);
    }, [draft]);
    const hasRealInput = useMemo(() => (
        [name, displayName, supply, description, maxMint, transferTo, transferSupplyTo,
            imageUrl, parentToken, perAddressMax, mintStartBlock, mintStopBlock,
            callbackTick, callbackAmount, callbackBlock]
            .some((value) => String(value || '').trim().length > 0)
        || divisible
        || lockOnCreate
        || Object.values(lockChecks).some(Boolean)
        || !!allowListIdx
        || !!blockListIdx
    ), [name, displayName, supply, description, maxMint, transferTo, transferSupplyTo,
        imageUrl, parentToken, perAddressMax, mintStartBlock, mintStopBlock,
        callbackTick, callbackAmount, callbackBlock, divisible, lockOnCreate,
        lockChecks, allowListIdx, blockListIdx]);
    // The template, network, signer and fee switch fill themselves in, so only
    // what the user typed, turned on or chose makes a draft. A draft of
    // defaults would come back as a Restore banner, and the wizard holds its
    // autosave while that banner waits.
    const draftEditable = stage === 'template' || stage === 'chain' || stage === 'details';
    useEffect(() => {
        if (!draftEditable || !draftPending) return;
        if (!hasRealInput) {
            draft.clear();
            return;
        }
        draft.save({
            template, chainId, fromAddressId, sourceChosen: sourceChosenFor === chainId,
            name, displayName, supply, divisible, description, maxMint, lockOnCreate,
            transferTo, transferSupplyTo, imageUrl, parentToken, perAddressMax,
            mintStartBlock, mintStopBlock, showAdvanced, lockChecks, callbackTick,
            callbackAmount, callbackBlock, allowListIdx, allowListCount, allowListName,
            blockListIdx, blockListCount, blockListName, payFeeInNativeCoin,
        });
    }, [
        draftEditable, draftPending, draft, hasRealInput,
        template, chainId, fromAddressId, sourceChosenFor,
        name, displayName, supply, divisible, description, maxMint, lockOnCreate,
        transferTo, transferSupplyTo, imageUrl, parentToken, perAddressMax,
        mintStartBlock, mintStopBlock, showAdvanced, lockChecks, callbackTick,
        callbackAmount, callbackBlock, allowListIdx, allowListCount, allowListName,
        blockListIdx, blockListCount, blockListName, payFeeInNativeCoin,
    ]);

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
                const signingByChain = signingAddressesByChain(byChain, settings);
                setAddressesByChain(signingByChain);
                setActiveByChain(active || {});
                if (Object.keys(signingByChain).length === 0) {
                    setLoadError(hasAnyAddress(byChain)
                        ? WATCH_ONLY_SIGNING_MESSAGE
                        : 'No addresses on any network yet. Use Receive to generate one before issuing a token.');
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key opened the wizard on the wallet's OLDEST chain
                // forever. Open on the last-used chain instead, ahead of the
                // first-key fallback, exactly as Send does.
                setChainId((prev) => pickDefaultChainId(signingByChain, {
                    explicitChainId: prev,
                    settings,
                }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Default the fee payer the way Send does: the chain's active address,
    // else the newest HD external. A dispenser-delegated address is never
    // the default, since it is a vending address rather than a funding one.
    // Never re-pick over a choice the user made for THIS chain. A subtoken is
    // only valid from the address that owns its parent, so re-picking behind
    // the user is not a cosmetic reset here: it silently restores the signer
    // whose action the chain refuses.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        if (sourceChosenFor === chainId) return;
        const funding = (addressesByChain[chainId] || []).filter((a) => a.role !== 'dispenser');
        setFromAddressId(preferredSourceId(funding, activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain, sourceChosenFor]);

    // PC-06: chain tip, for the callback block's future-block rail and
    // its date estimate. Only fetched once the advanced panel is open.
    useEffect(() => {
        if (!showAdvanced || !chainId) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId })
            .then((r) => { if (!cancelled) setCurrentHeight(r && r.watermark != null ? Number(r.watermark) : null); })
            .catch(() => { if (!cancelled) setCurrentHeight(null); });
        return () => { cancelled = true; };
    }, [showAdvanced, chainId, messaging, walletId]);

    // PC-06: prove the callback token's divisibility so a fractional
    // payout can be allowed. Anything short of a confirmed divisibility
    // (still loading, unknown ticker, unreachable explorer) stays null,
    // and the validator then holds the payout to whole numbers.
    useEffect(() => {
        const tick = callbackTick.trim().toUpperCase();
        setCallbackTickDecimals(null);
        if (!showAdvanced || !chainId || !tick) return undefined;
        if (typeof messaging?.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.getTokenInfo({ chainId, tick })
                .then((info) => {
                    if (cancelled) return;
                    const d = info?.divisibility;
                    setCallbackTickDecimals(Number.isInteger(d) ? d : null);
                })
                .catch(() => { if (!cancelled) setCallbackTickDecimals(null); });
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [showAdvanced, chainId, callbackTick, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const feeEstimate = useMemo(
        () => estimateNativeSendFee({ chainId, chainRegistry, speed: 'normal' }),
        [chainId],
    );
    const { formatNativeFee, formatProtocolFee } = useFeeFiat({
        chainId: descriptor?.id,
        chainCoin: descriptor?.coin,
        nativeTicker: coinTicker,
        settings,
    });
    const feeFiat = feeEstimate ? formatNativeFee(feeEstimate.coinAmount) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    // Host composition and signing use the shared confirmation page after the
    // wizard's review step, keeping the reviewed and signed transaction equal.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // An already-unlocked wallet does not re-prompt on the confirm page.
    const signerReady = useSignerReady(walletId);
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    // Compose ISSUE v0 params from the current form state. Dispatched
    // by template (see TEMPLATE_COMPOSERS); each picks the subset of
    // ISSUE v0 fields its template wants. The memo key intentionally
    // includes `template` so switching templates re-composes.
    // PC-06: the advanced fields ride only the Custom template (the
    // other five are opinionated presets), so they are bundled once and
    // the composer ignores them everywhere else.
    const advanced = useMemo(() => ({
        lockChecks,
        callbackTick,
        callbackAmount,
        callbackBlock,
        allowListIdx,
        blockListIdx,
    }), [lockChecks, callbackTick, callbackAmount, callbackBlock,
         allowListIdx, blockListIdx]);

    const actionParams = useMemo(
        () => composeIssueParams(template, {
            name,
            supply,
            maxMint,
            divisible,
            description,
            lockOnCreate,
            transferTo,
            transferSupplyTo,
            imageUrl,
            parentToken,
            perAddressMax,
            mintStartBlock,
            mintStopBlock,
            advanced,
        }),
        [template, name, supply, maxMint, divisible, description,
         lockOnCreate, transferTo, transferSupplyTo, imageUrl, parentToken,
         perAddressMax, mintStartBlock, mintStopBlock, advanced],
    );

    const decoded = useMemo(() => {
        if (stage !== 'preview') return null;
        return decoderLib.decodeAction({
            action: 'ISSUE',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    // What the details submit validated against, read again after the
    // subtoken parent lookup resolves.
    const detailsInputsRef = useRef('');
    detailsInputsRef.current = JSON.stringify([
        stage, chainId, fromAddress?.address || null, actionParams,
    ]);

    // The same availability lookup Issue token runs while the name is typed.
    // It checks the ticker the transaction carries, so a subtoken checks
    // PARENT.CHILD, and only once the name (and a subtoken's parent) passes
    // the grammar.
    const tickerLookupSupported = Object.prototype.hasOwnProperty.call(messaging, 'getTokenInfo')
        && typeof messaging.getTokenInfo === 'function';
    const isSubtoken = resolveTemplate(template) === 'subtoken';
    const lookupTick = tickerGrammarError(name, { noun: 'Token name' })
        || (isSubtoken && tickerGrammarError(parentToken, { noun: 'Parent ticker', allowDot: true }))
        ? ''
        : String(actionParams.TICK || '').trim();
    const [tickerCheck, setTickerCheck] = useState(
        /** @type {{ ticker: string, status: 'idle' | 'checking' | 'available' | 'taken' | 'unknown' }} */
        ({ ticker: '', status: 'idle' }),
    );
    // A late response for an earlier name never marks the current one taken:
    // cleanup ties each debounced lookup to the exact ticker and network that
    // started it. A failed or stalled lookup reads as 'unknown', which leaves
    // the name to composition instead of trapping the wizard in an outage.
    useEffect(() => {
        setTickerCheck({ ticker: lookupTick, status: lookupTick ? 'checking' : 'idle' });
        if (!chainId || !lookupTick || !tickerLookupSupported) {
            setTickerCheck({ ticker: lookupTick, status: 'idle' });
            return undefined;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            const lookup = Promise.resolve()
                .then(() => messaging.getTokenInfo({ chainId, tick: lookupTick }));
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
                        ticker: lookupTick,
                        status: verdict === 'found' ? 'taken'
                            : verdict === 'missing' ? 'available' : 'unknown',
                    });
                })
                .catch(() => {
                    if (!cancelled) setTickerCheck({ ticker: lookupTick, status: 'unknown' });
                });
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [chainId, lookupTick, messaging, tickerLookupSupported]);
    const tickerTaken = !!lookupTick && tickerCheck.ticker === lookupTick && tickerCheck.status === 'taken';

    // A Details submit inside the debounce or the lookup is held and replayed
    // once the check settles. Editing the name or network, or leaving Details,
    // drops it: the user is no longer asking to review that name.
    const [reviewQueued, setReviewQueued] = useState(false);
    useEffect(() => { setReviewQueued(false); }, [chainId, lookupTick, stage]);
    useEffect(() => {
        if (!reviewQueued || stage !== 'details') return;
        if (tickerCheck.status === 'checking' || tickerCheck.ticker !== lookupTick) return;
        setReviewQueued(false);
        handleDetailsSubmit({ preventDefault() {} });
    });

    async function handleDetailsSubmit(event) {
        event.preventDefault();
        if (parentCheckRef.current) return;
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        // The grammar is the chain's own allowlist minus the caret, and it
        // lives in one module both authoring surfaces read: a plain
        // `/^[A-Za-z0-9]+$/` here would refuse names the chain admits.
        const nameError = tickerGrammarError(name, { noun: 'Token name' });
        if (nameError) {
            setFormError(nameError);
            return;
        }
        const descriptionError = actionTextSafetyError(description, 'Description');
        if (descriptionError) {
            setFormError(descriptionError);
            return;
        }
        if (template === 'subtoken') {
            if (!parentToken.trim()) {
                setFormError('Parent ticker is required for subtokens.');
                return;
            }
            // The parent is a REFERENCE to a token that already exists, not a
            // name being coined here, so it has to be able to address what the
            // ledger actually holds. A parent may itself be a subtoken: the
            // indexer resolves a child's parent as `parts.slice(0,-1).join('.')`
            // (issue.js), so `A.B.C` is a child of `A.B` and nests to any depth,
            // priced at the same discounted ISSUE_SUBTOKEN rate. Demanding a
            // single alphanumeric run made every grandchild uncreatable from the
            // only surface that can author a subtoken at all.
            //
            // This follows from the child field beside it: once a symbol-bearing
            // or lowercase name can be COINED, it has to stay addressable as a
            // parent, or the wallet hands out names it can never build on. Same
            // grammar, same module, including the dot-structure rules the chain
            // enforces.
            const parentError = tickerGrammarError(parentToken, {
                noun: 'Parent ticker',
                allowDot: true,
            });
            if (parentError) {
                setFormError(parentError);
                return;
            }
        }
        if (tickerLookupSupported && lookupTick
            && (tickerCheck.ticker !== lookupTick || tickerCheck.status === 'checking')) {
            setFormError(null);
            setReviewQueued(true);
            return;
        }
        if (tickerTaken) {
            setFormError(t('issue.tickerTaken', { ticker: lookupTick }));
            return;
        }
        // Collectible's supply is hard-wired to 1 by the composer;
        // no user-facing supply field.
        if (template !== 'collectible') {
            if (!isPositiveDecimal(supply)) {
                setFormError('Supply must be a positive number.');
                return;
            }
            const decimals = divisible && ['utility', 'subtoken', 'custom'].includes(template)
                ? 8
                : 0;
            if (!hasAmountPrecision(supply, decimals)) {
                setFormError(decimals === 0
                    ? 'Supply must be a whole number for an indivisible token.'
                    : 'Supply can have at most 8 decimal places.');
                return;
            }
            const supplyLimitError = issueSupplyLimitError(supply);
            if (supplyLimitError) {
                setFormError(supplyLimitError);
                return;
            }
        }
        if ((template === 'utility' || template === 'custom') && maxMint.trim()) {
            if (!isPositiveDecimal(maxMint)) {
                setFormError('Max mint per transaction must be a positive number, or left blank for no limit.');
                return;
            }
            const decimals = divisible ? 8 : 0;
            if (!hasAmountPrecision(maxMint, decimals)) {
                setFormError(decimals === 0
                    ? 'Max mint per transaction must be a whole number for an indivisible token.'
                    : 'Max mint per transaction can have at most 8 decimal places.');
                return;
            }
        }
        if (template === 'edition') {
            if (!isPositiveDecimal(maxMint)) {
                setFormError('Copies per mint must be a positive number.');
                return;
            }
            if (!hasAmountPrecision(maxMint, 0)) {
                setFormError('Copies per mint must be a whole number.');
                return;
            }
            if (perAddressMax.trim() && !isPositiveDecimal(perAddressMax)) {
                setFormError('Limit per address must be a positive number, or left blank for no limit.');
                return;
            }
            if (perAddressMax.trim() && !hasAmountPrecision(perAddressMax, 0)) {
                setFormError('Limit per address must be a whole number.');
                return;
            }
            if (perAddressMax.trim()
                && compareDecimalStrings(perAddressMax, maxMint) === -1) {
                setFormError('Limit per address must be at least the copies per mint.');
                return;
            }
            if (mintStartBlock.trim() && !/^\d+$/.test(mintStartBlock.trim())) {
                setFormError('Minting start must be a whole block number.');
                return;
            }
            if (mintStopBlock.trim() && !/^\d+$/.test(mintStopBlock.trim())) {
                setFormError('Minting close must be a whole block number.');
                return;
            }
            if (mintStartBlock && mintStopBlock
                && compareDecimalStrings(mintStopBlock, mintStartBlock) !== 1) {
                setFormError('Minting must close after it opens. Check the block numbers.');
                return;
            }
        }
        if ((template === 'collectible' || template === 'edition') && !imageUrl.trim()) {
            setFormError('Image URL is required for this template.');
            return;
        }
        // Collectible and edition write the image URL into DESCRIPTION, so it
        // takes the description rules; the others write the description field.
        const usesImageUrl = template === 'collectible' || template === 'edition';
        const storedTextError = usesImageUrl
            ? issueImageUrlError(imageUrl)
            : issueDescriptionError(description);
        if (storedTextError) {
            setFormError(storedTextError);
            return;
        }
        // PC-06: the advanced fields share the create transaction, so a
        // bad one costs the whole token, not just the field. Pre-flight
        // them here rather than letting the indexer reject the ISSUE.
        if (template === 'custom') {
            const advancedError = validateAdvancedIssueFields(advanced, {
                supply,
                currentHeight,
                callbackTickDecimals,
            });
            if (advancedError) {
                setShowAdvanced(true);
                setFormError(advancedError);
                return;
            }
        }
        if (template === 'custom'
            && transferTo.trim() && !isValidIssueAddress(transferTo, descriptor)) {
            setFormError(`Transfer ownership address is not valid for ${descriptor?.displayName || 'this chain'}.`);
            return;
        }
        if (template === 'custom'
            && transferSupplyTo.trim() && !isValidIssueAddress(transferSupplyTo, descriptor)) {
            setFormError(`Initial mint destination is not valid for ${descriptor?.displayName || 'this chain'}.`);
            return;
        }
        if (template === 'subtoken') {
            const checkedInputs = detailsInputsRef.current;
            parentCheckRef.current = true;
            let parentError = null;
            try {
                parentError = await parentOwnershipError();
            } finally {
                parentCheckRef.current = false;
            }
            // The user went Back, or changed the network, the signer or a
            // field, while the lookup ran: its answer is about values no
            // longer on screen, so it neither reviews nor reports them.
            if (detailsInputsRef.current !== checkedInputs) return;
            if (parentError) {
                setFormError(parentError);
                return;
            }
        }
        setFormError(null);
        setStage('preview');
    }

    // The chain refuses a subtoken whose parent is missing or owned by another
    // address, after the fee is spent. Look the parent up before review: it has
    // to exist, be owned by this wallet, and be owned by the fee-paying address
    // that will sign. An explorer that cannot answer is a refusal, never a pass.
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
        if (creator !== fromAddress.address) {
            return `${parent} is owned by another address in this wallet. Go back and choose it as the address that pays the fee.`;
        }
        return null;
    }

    // Compose, tamper-check, and pre-flight run host-side after review.
    // Approve signs the byte-identical prebuilt PSBT via issueToken.prebuiltPsbt.
    async function openConfirmScreen() {
        if (!networkAvailable) return;
        if (submitPendingRef.current) return;
        submitPendingRef.current = true;
        const from = fromAddress ? {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        } : null;
        if (!from) {
            setFormError('No source address available.');
            submitPendingRef.current = false;
            return;
        }
        setFormError(null);
        // The parent can change hands while Review sits open, and the chain
        // refuses the child after the fee, so the lookup runs again here.
        if (template === 'subtoken') {
            const parentError = await parentOwnershipError();
            if (parentError) {
                setFormError(parentError);
                submitPendingRef.current = false;
                return;
            }
        }
        try {
            if (isWatcherMode) {
                const res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    actionData: { action: 'ISSUE', params: actionParams },
                    encoderOpts: { payFeeInNativeCoin: payFeeInNativeCoin || undefined },
                });
                setResult(res);
                setStage('done');
                draft.clear();
                setDraftPending(false);
                return;
            }
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'ISSUE', params: actionParams },
                encoderOpts: { payFeeInNativeCoin: payFeeInNativeCoin || undefined },
                onApprove: (prebuiltPsbt) => messaging.issueToken({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    password: passwordValueRef.current,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
            // The draft is the token this approval just created. Kept, it
            // comes back as unfinished and invites a second ISSUE of the
            // same ticker, which the chain refuses after the fee.
            draft.clear();
            setDraftPending(false);
        } catch (err) {
            if (isUserRejection(err)) return;
            // Same mapping as handleSign below: a native-fee refusal arrives as
            // NativeFeeForfeitError, whose own message is wire wording ("native-coin fee
            // pre-flight failed (dust): ..."). This is the path the confirm flow actually
            // takes, so leaving it unmapped showed that wording to every user.
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: err?.message || 'Issue failed.',
            }));
        } finally {
            submitPendingRef.current = false;
        }
    }

    const stageBack = stage === 'chain'
        ? () => { setFormError(null); setStage('template'); }
        : stage === 'details'
            ? () => { setFormError(null); setStage('chain'); }
            : stage === 'preview'
                ? () => { setFormError(null); setStage('details'); }
                : onBack;
    // The host is composing the reviewed values. Going Back now would let the
    // user edit Details while the confirm page opens for the old values.
    const composingReview = stage === 'preview' && actionConfirm.composing;
    const header = (
        <PageHeader
            onBack={stageBack}
            backDisabled={composingReview}
            backLabel={stage === 'template' || stage === 'done' ? 'Back to home' : 'Back'}
            title="Issue a token"
        />
    );
    // Shown on every step that edits the draft, since the autosave holds while
    // the banner waits for a choice.
    const draftBanner = draftEditable && addressesByChain && chainId && !loadError
        && draft.hasDraft() && !draftPending ? (
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
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={stage !== 'preview'}>
            {/* A load error is the page's one message; the offline note waits. */}
            {!networkAvailable && !loadError ? (
                <StatusMessage variant="warning">Creating a token needs a network connection.</StatusMessage>
            ) : null}
            {draftBanner}
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(<ListPage><StatusMessage variant="error">{loadError}</StatusMessage></ListPage>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);
    }

    // The confirmation page replaces the wizard step while keeping wizard
    // state intact for Reject and host errors.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                        + (feeFiat ? ` (${feeFiat})` : '')
                    : 'Network fee estimate unavailable.'}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                formatNativeFee={formatNativeFee}
                formatProtocolFee={formatProtocolFee}
                hintClassName={styles.hint}
            />
        );
    }

    // The signer, choosable. Every other authoring form in the wallet routes
    // its From field here; this one auto-picked the newest HD address and
    // offered no way past it, which made SUBTOKEN unreachable for any wallet
    // whose parent owner was not that address - the chain refuses a child
    // signed by anyone else, and no field on this screen could change who
    // signed. Same picker, so the coin filtering and the address list are the
    // wallet's own rather than this form's.
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

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Fee paid by"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourceChosenFor(chainId);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // PC-06 access lists: the same TYPE=2 address-list picker the admin
    // access-lists mode uses, so create and edit bind lists identically.
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
                    if (listPickerFor === 'allow') {
                        setAllowListIdx(row.actionIndex);
                        setAllowListCount(row.memberCount);
                        setAllowListName(typeof row.name === 'string' && row.name.length > 0 ? row.name : null);
                    } else {
                        setBlockListIdx(row.actionIndex);
                        setBlockListCount(row.memberCount);
                        setBlockListName(typeof row.name === 'string' && row.name.length > 0 ? row.name : null);
                    }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (stage === 'template') {
        return wrap(
            <>
                <WizardProgress stage={stage} />
                {renderTemplateStage({
                    onPick: (t) => { setTemplate(resolveTemplate(t)); setStage('chain'); },
                })}
            </>,
        );
    }

    if (stage === 'chain') {
        return wrap(
            <>
                <WizardProgress stage={stage} />
                {renderChainStage({
                    demoGuard,
                    chainsWithAddresses,
                    chainId,
                    setChainId,
                    descriptor,
                    fromAddress,
                    subtoken: template === 'subtoken',
                    onPickSource: () => setSourcePickerOpen(true),
                    onNext: () => setStage('details'),
                })}
            </>,
        );
    }

    if (stage === 'details') {
        return wrap(<>
            <WizardProgress stage={stage} />
            {renderDetailsStage({
            demoGuard,
            template,
            name, setName,
            nameError: tickerTaken ? t('issue.tickerTaken', { ticker: lookupTick }) : undefined,
            displayName, setDisplayName,
            supply, setSupply,
            divisible, setDivisible,
            description, setDescription,
            maxMint, setMaxMint,
            lockOnCreate, setLockOnCreate,
            transferTo, setTransferTo,
            transferSupplyTo, setTransferSupplyTo,
            onPickContact: (target) => { setContactsTarget(target); setContactsPickerOpen(true); },
            imageUrl, setImageUrl,
            parentToken, setParentToken,
            perAddressMax, setPerAddressMax,
            mintStartBlock, setMintStartBlock,
            mintStopBlock, setMintStopBlock,
            payFeeInNativeCoin, setPayFeeInNativeCoin, coinTicker, nativeFeeMandatory,
            advancedPanel: {
                showAdvanced, setShowAdvanced,
                lockChecks, setLockChecks,
                lockOnCreate,
                callbackTick, setCallbackTick,
                callbackAmount, setCallbackAmount,
                callbackBlock, setCallbackBlock,
                callbackBlockEstimate: blockDateEstimateText({
                    coin: descriptor?.coin, currentHeight, targetBlock: callbackBlock,
                }),
                callbackTickDecimals,
                currentHeight,
                allowListIdx, blockListIdx, allowListCount, blockListCount,
                allowListName, blockListName,
                onPickList: setListPickerFor,
                onClearList: (which) => {
                    if (which === 'allow') {
                        setAllowListIdx(null);
                        setAllowListCount(null);
                        setAllowListName(null);
                    } else {
                        setBlockListIdx(null);
                        setBlockListCount(null);
                        setBlockListName(null);
                    }
                },
                warnings: advancedIssueWarnings(advanced),
            },
            formError,
            onEdit: () => { if (formError) setFormError(null); },
            onSubmit: handleDetailsSubmit,
            submitLabel: 'Review token',
        })}
        </>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={() => { setResult(null); setStage('details'); }}
                    onDone={onBack}
                />,
            );
        }
        // Signed but not broadcast, so the token does not exist yet.
        if (result?.queued) {
            return wrap(
                <ListPage>
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} what="token issuance" unsaved={result.unsaved} />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <SectionHeader title="Token issued" />
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                        <CopyButton value={txid} label="Copy transaction ID" />
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    // The review is the final wizard step. Host-side composition begins only
    // after this form is submitted, so Back can still edit every value without
    // holding encoder inputs or changing the transaction being reviewed.
    return wrap(
        <>
            <WizardProgress stage={stage} />
            <FormPage
                demoGuard={demoGuard}
                label="Review token issuance"
                onSubmit={(event) => {
                    event.preventDefault();
                    openConfirmScreen();
                }}
                status={formError ? (
                    <StatusMessage variant="error">{formError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={actionConfirm.composing}
                        disabled={actionConfirm.composing || !networkAvailable}
                        title={!networkAvailable ? 'Creating a token needs a network connection' : undefined}
                    >
                        Continue to confirmation
                    </Button>
                )}
            >
                <p className={styles.summary}>{decoded?.summary}</p>
                {/* Native definition list remains because the UI kit has no read-only detail-list primitive. */}
                <dl className={styles.detailsList}>
                    <DetailRow label="Template" value={templateLabel(template)} />
                    {displayName.trim() ? (
                        <DetailRow label="Display name (not in transaction)" value={displayName.trim()} />
                    ) : null}
                    {descriptor ? (
                        <>
                            <dt className={styles.detailsLabel}>Network</dt>
                            <dd className={styles.detailsValue}><ChainBadge descriptor={descriptor} size="sm" /></dd>
                        </>
                    ) : null}
                    {fromAddress ? (
                        <>
                            <dt className={styles.detailsLabel}>From</dt>
                            <dd className={styles.detailsValue}>
                                <AddressText address={fromAddress.address} />
                            </dd>
                        </>
                    ) : null}
                    {(decoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                                + (feeFiat ? ` (${feeFiat})` : '')
                            : 'Fee estimate unavailable for this network.'}
                    />
                    <DetailRow
                        label="Protocol fee paid in"
                        value={payFeeInNativeCoin ? coinTicker : 'XCHAIN'}
                    />
                </dl>
                {payFeeInNativeCoin ? (
                    <FormNotice variant="warning" role="alert">{NATIVE_FEE_WARNING}</FormNotice>
                ) : null}
                {decoded && decoded.warnings.length > 0 ? (
                    <FormNotice variant="warning" role="alert" lines={decoded.warnings} />
                ) : null}
            </FormPage>
        </>,
    );
}

const WIZARD_STEPS = ['template', 'chain', 'details', 'preview'];
const WIZARD_STEP_LABELS = {
    template: 'Template',
    chain: 'Network',
    details: 'Details',
    preview: 'Review',
};

function WizardProgress({ stage }) {
    const index = WIZARD_STEPS.indexOf(stage);
    if (index === -1) return null;
    return (
        <p className={styles.progress} aria-current="step">
            Step {index + 1} of {WIZARD_STEPS.length}: {WIZARD_STEP_LABELS[stage]}
        </p>
    );
}

function templateLabel(template) {
    return TEMPLATES.find((item) => item.id === resolveTemplate(template))?.name || 'Custom';
}

/**
 * Compose an ISSUE v0 action-params object from the wizard's details
 * form. Dispatches by template; each composer picks the subset of
 * ISSUE fields its template wants. The shape matches what
 * `actionDecoder` and the SDK's `Actions.createAction` both consume.
 *
 * Template semantics (§40.1):
 *
 * - **meme**: fire-and-forget: MAX_SUPPLY + MINT_SUPPLY + non-divisible
 *               + LOCK_MAX_SUPPLY + LOCK_MINT + LOCK_MINT_SUPPLY in one
 *               ISSUE transaction. (The spec describes a BATCH but the
 *               protocol's ISSUE v0 composes all three atomically via
 *               `MINT_SUPPLY` + `LOCK_*` fields, simpler and one fewer
 *               signature.) All three locks are needed for "fixed
 *               supply" to be true; see collectible.
 * - **utility**: mintable, adjustable: MAX_SUPPLY + MAX_MINT, no lock
 *               flags. Description encouraged for discovery.
 *               folded the old **community** template into this one:
 *               it composed a byte-identical ISSUE and its only claim
 *               ("dividend-enabled") is true of every token, because
 *               DIVIDEND validation has no per-token opt-in - it only
 *               requires that both ticks exist, that neither they nor
 *               the source are sleeping, and that the payer has funds.
 *               The card copy now says so instead of implying that
 *               dividends are a choice made at creation time. Legacy
 *               'community' ids still resolve here via TEMPLATE_ALIASES.
 * - **collectible**: single-edition: MAX_SUPPLY=1 + MINT_SUPPLY=1 +
 *               non-divisible + LOCK_MAX_SUPPLY + LOCK_MINT +
 *               LOCK_MINT_SUPPLY. The third lock is what makes the 1-of-1
 *               the token's own promise rather than a protocol flag day's
 *: a re-ISSUE carrying MINT_SUPPLY is refused
 *               `MINT_SUPPLY (locked)` on every chain, at every block.
 *               Image URL goes into DESCRIPTION (the JDOG protocol example). Full
 *               FILE + BATCH path is deferred past Phase 2 (BATCH bans
 *               FILE per protocol §BATCH; the FILE-action pipeline is
 *               its own feature).
 * - **edition**: fair-mint set of N identical prints (mirrors
 *               `sdk.nft.edition({mint})`): MAX_SUPPLY=N + DECIMALS=0 +
 *               LOCK_MAX_SUPPLY + MAX_MINT (+ optional MINT_ADDRESS_MAX /
 *               MINT_START_BLOCK / MINT_STOP_BLOCK). Deliberately **no
 *               MINT_SUPPLY and no LOCK_MINT**. The cap locks at
 *               issuance with zero minted supply (LOCK_MAX_SUPPLY
 *               validates the declared cap) so every print stays
 *               publicly mintable through the MINT window.
 * - **subtoken**: TICK = "PARENT.CHILD"; supply + decimals + optional
 *               description. Parent-ownership check is runtime at the
 *               protocol layer; the wizard doesn't verify pre-flight.
 * - **custom**: every ISSUE v0 field exposed. Superset of the other
 *               five; used for edge cases the templates don't cover.
 *               PC-06 completes it: the advanced disclosure adds the
 *               seven lock flags, the callback trio, and the
 *               allow/block lists, so a token that previously needed a
 *               create plus three admin edits is one transaction.
 */
function composeIssueParams(template, form) {
    const composer = TEMPLATE_COMPOSERS[resolveTemplate(template)] || TEMPLATE_COMPOSERS.custom;
    return composer(form);
}

/**
 * Retired template ids, mapped to the template that absorbed them.
 * Without this a stale id would fall through to `custom`, which shows
 * different fields and composes a different ISSUE.
 */
const TEMPLATE_ALIASES = { community: 'utility' };

function resolveTemplate(template) {
    return TEMPLATE_ALIASES[template] || template;
}

const TEMPLATE_COMPOSERS = {
    meme(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';           // meme tokens are indivisible
        seedSupply(p, form);
        p.LOCK_MAX_SUPPLY = '1';
        p.LOCK_MINT = '1';
        // The third inflation path. See the collectible composer
        // below for why LOCK_MAX_SUPPLY + LOCK_MINT alone do not make a
        // supply fixed, and why this template writes the third lock.
        p.LOCK_MINT_SUPPLY = '1';
        maybeDescription(p, form);
        return p;
    },

    utility(form) {
        const p = baseParams(form);
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        maybeDescription(p, form);
        return p;
    },

    collectible(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';
        p.MAX_SUPPLY = '1';
        p.MINT_SUPPLY = '1';
        p.LOCK_MAX_SUPPLY = '1';
        p.LOCK_MINT = '1';
        //LOCK_MAX_SUPPLY freezes the cap and LOCK_MINT closes the
        // MINT action, but MINT_SUPPLY is credited on EVERY valid ISSUE, not
        // only the first, and a re-ISSUE that restates the cap unchanged
        // never trips the locked-cap check. Without this third lock the
        // owner can keep minting fresh supply onto a "1 of 1", and the only
        // thing refusing it is the indexer's ISSUE_MINT_SUPPLY_CUMULATIVE_CAP
        // protocol change, which is gated: at genesis on testnet/regtest but
        // on a flag day on mainnet. A token-level lock costs nothing (one
        // more field in the same ISSUE, same fee) and holds on every chain
        // from the moment the token exists, so the promise is the token's
        // rather than the network's.
        p.LOCK_MINT_SUPPLY = '1';
        // The image URL lives in DESCRIPTION (the TIS IMAGE format);
        // the lightweight path. For fully ON-CHAIN artwork + metadata,
        // create the token here, then use Manage Token → Artwork with
        // "make this the token's picture everywhere": it uploads the
        // image and a TIS document as FILE actions and re-points
        // DESCRIPTION at the document (action:<index>, TIS On-Chain
        // Format).
        if (form.imageUrl) p.DESCRIPTION = form.imageUrl.trim();
        else if (form.description) p.DESCRIPTION = form.description.trim();
        return p;
    },

    edition(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';
        if (form.supply) p.MAX_SUPPLY = String(form.supply).trim();
        p.LOCK_MAX_SUPPLY = '1';
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        if (form.perAddressMax) p.MINT_ADDRESS_MAX = String(form.perAddressMax).trim();
        if (form.mintStartBlock) p.MINT_START_BLOCK = String(form.mintStartBlock).trim();
        if (form.mintStopBlock) p.MINT_STOP_BLOCK = String(form.mintStopBlock).trim();
        // Same DESCRIPTION convention as collectible; the shared
        // artwork URL, falling back to a plain description.
        if (form.imageUrl) p.DESCRIPTION = form.imageUrl.trim();
        else if (form.description) p.DESCRIPTION = form.description.trim();
        return p;
    },

    subtoken(form) {
        const p = baseParams(form);
        // Compose parent.child if both are present. `parentToken` is the
        // existing tick the user owns; the wizard's Subtoken form prompts for it
        // separately and joins here.
        //
        // Neither half is upper-cased: the chain records a tick exactly as
        // written, and coercing here would silently rewrite a lowercase
        // parent into one the ledger does not hold.
        if (form.parentToken) {
            const parent = String(form.parentToken).trim();
            const child = String(form.name).trim();
            p.TICK = `${parent}.${child}`;
        }
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        maybeDescription(p, form);
        return p;
    },

    custom(form) {
        const p = baseParams(form);
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        maybeDescription(p, form);
        if (form.lockOnCreate) {
            p.LOCK_MAX_SUPPLY = '1';
            p.LOCK_MINT = '1';
        }
        if (form.transferTo) p.TRANSFER = form.transferTo.trim();
        // seedSupply above always mints the whole supply here, so a
        // destination for it is never a dead field on this template.
        if (form.transferSupplyTo && p.MINT_SUPPLY) p.TRANSFER_SUPPLY = form.transferSupplyTo.trim();
        // PC-06: the advanced disclosure's lock matrix, callback trio,
        // and access lists. Applied last so an explicitly checked flag
        // and the `lockOnCreate` shortcut converge on the same '1'
        // rather than fighting over the field.
        applyAdvancedIssueFields(p, form.advanced);
        return p;
    },
};

function baseParams(form) {
    return {
        VERSION: '0',
        // Written through as typed: this is the second half of a two-part
        // uppercase coercion (the input carries the first), so leaving this
        // line alone while fixing only the input would leave the wire form
        // upper-cased regardless.
        TICK: String(form.name || '').trim(),
    };
}

function seedSupply(p, form) {
    if (!form.supply) return;
    const supply = String(form.supply).trim();
    p.MAX_SUPPLY = supply;
    p.MINT_SUPPLY = supply;
}

function maybeDescription(p, form) {
    if (form.description) p.DESCRIPTION = form.description.trim();
}

const TEMPLATES = [
    {
        id: 'meme',
        name: 'Meme token',
        tagline: 'Fixed supply, locked, and non-divisible. No more supply can be minted after issuance.',
        interactive: true,
    },
    {
        id: 'utility',
        name: 'Utility token',
        tagline: 'Mintable, adjustable supply. Can pay dividends, like every token.',
        interactive: true,
    },
    {
        id: 'collectible',
        name: 'Collectible',
        tagline: 'One-of-a-kind collectible with on-chain artwork.',
        interactive: true,
    },
    {
        id: 'edition',
        name: 'Limited edition',
        tagline: 'A fixed set of identical collectibles that anyone can mint.',
        interactive: true,
    },
    {
        id: 'subtoken',
        name: 'Subtoken',
        tagline: 'Named sub-token under a ticker you own.',
        interactive: true,
    },
    {
        id: 'custom',
        name: 'Custom',
        tagline: 'Every token field, fully editable.',
        interactive: true,
    },
];

function renderTemplateStage({ onPick }) {
    return (
        <ListPage>
            {/* Native list markup preserves template-list semantics because the UI kit has no list primitive. */}
            <ul className={styles.templateGrid}>
                {TEMPLATES.map((t) => (
                    // Native list items preserve list semantics because the UI kit has no list-item primitive.
                    <li key={t.id}>
                        <ListRow
                            type="button"
                            className={styles.templateCard}
                            title={t.name}
                            subtitle={t.tagline}
                            onClick={() => t.interactive && onPick(t.id)}
                            disabled={!t.interactive}
                            aria-disabled={!t.interactive}
                            tooltip={t.interactive ? undefined : 'No dedicated form for this template yet. Use the Custom template instead.'}
                        />
                    </li>
                ))}
            </ul>
            {/* dividends are not a template setting, and the
                wizard used to imply they were by selling a "Community"
                card on a promise every token already keeps. Saying it
                once here is what stops an issuer from abandoning a
                perfectly good token and paying a second ISSUE fee to
                re-create it under the "right" template. */}
            <p className={styles.stageHint}>
                Any token you issue here can pay dividends to its holders later.
                That is a property of every token, not something a template turns on.
            </p>
        </ListPage>
    );
}

function renderChainStage({
    chainsWithAddresses, chainId, setChainId, descriptor, fromAddress,
    subtoken, onPickSource, onNext, demoGuard,
}) {
    return (
        <FormPage
            demoGuard={demoGuard}
            label="Choose token network"
            onSubmit={(event) => {
                event.preventDefault();
                if (fromAddress) onNext();
            }}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress}
                >
                    Next
                </Button>
            )}
        >
            <ChainPicker label="Network" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} hideNetworkKind />

            {fromAddress ? (
                <AddressField
                    label="Fee paid by"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={onPickSource}
                    iconLabel="Choose source address"
                    hint={subtoken
                        ? 'A subtoken can only be issued by the address that owns its parent.'
                        : undefined}
                />
            ) : (
                <FormNotice variant="error">
                    {t('send.source.noAddress')}
                </FormNotice>
            )}
        </FormPage>
    );
}

/**
 * Which ISSUE-form fields each template wants the user to fill in.
 * Fields not listed are either fixed by the composer (Meme's
 * DECIMALS=0, Collectible's MAX_SUPPLY=1) or irrelevant for the
 * template's use case. Custom exposes every field.
 */
const TEMPLATE_FIELDS = {
    meme: {
        name: true, displayName: true, supply: true, description: true,
    },
    utility: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true,
    },
    collectible: {
        name: true, displayName: true, imageUrl: true,
    },
    edition: {
        name: true, displayName: true, supply: true, imageUrl: true,
        maxMint: true, perAddressMax: true, mintStartBlock: true,
        mintStopBlock: true,
    },
    subtoken: {
        parentToken: true, name: true, displayName: true, supply: true,
        divisible: true, description: true,
    },
    custom: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true, lockOnCreate: true, transferTo: true,
        transferSupplyTo: true,
    },
};

function renderDetailsStage({
    demoGuard,
    template,
    name, setName, nameError,
    displayName, setDisplayName,
    supply, setSupply,
    divisible, setDivisible,
    description, setDescription,
    maxMint, setMaxMint,
    lockOnCreate, setLockOnCreate,
    transferTo, setTransferTo,
    transferSupplyTo, setTransferSupplyTo,
    onPickContact,
    imageUrl, setImageUrl,
    parentToken, setParentToken,
    perAddressMax, setPerAddressMax,
    mintStartBlock, setMintStartBlock,
    mintStopBlock, setMintStopBlock,
    payFeeInNativeCoin, setPayFeeInNativeCoin, coinTicker, nativeFeeMandatory,
    advancedPanel,
    formError, onEdit, onSubmit, submitLabel = 'Preview', submitLoading = false,
}) {
    const resolved = resolveTemplate(template);
    const show = TEMPLATE_FIELDS[resolved] || TEMPLATE_FIELDS.custom;
    const isEdition = resolved === 'edition';
    return (
        <FormPage
            demoGuard={demoGuard}
            label="Token details"
            onSubmit={onSubmit}
            onChangeCapture={onEdit}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            actions={(
                <Button type="submit" variant="primary" loading={submitLoading}>
                    {submitLabel}
                </Button>
            )}
        >
            {show.parentToken ? (
                <Input
                    label="Parent ticker"
                    hint={'An existing token you own, which can itself be a subtoken. '
                        + "The new token's full ticker will be PARENT.CHILD."}
                    value={parentToken}
                    onChange={(e) => setParentToken(e.target.value)}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
            {show.name ? (
                <Input
                    label={resolved === 'subtoken' ? 'Subtoken name' : 'Token name (ticker)'}
                    hint={TICKER_HINT}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    error={nameError}
                />
            ) : null}
            {show.displayName ? (
                <Input
                    label="Display name (optional)"
                    hint="Shown only in this wallet; not saved on-chain."
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.supply ? (
                <Input
                    label={isEdition ? 'Edition size' : 'Supply'}
                    hint={isEdition
                        ? 'How many copies will ever exist. This number is locked permanently when the edition is issued.'
                        : undefined}
                    inputMode="decimal"
                    value={supply}
                    onChange={(e) => setSupply(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.divisible ? (
                <Switch
                    label="Divisible (8 decimal places)"
                    checked={divisible}
                    onChange={(e) => setDivisible(e.target.checked)}
                />
            ) : null}
            {show.description ? (
                <Input
                    label="Description (optional)"
                    hint={`Up to ${MAX_ISSUE_TEXT_LENGTH} characters. Stored on-chain.`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    autoComplete="off"
                    maxLength={MAX_ISSUE_TEXT_LENGTH}
                />
            ) : null}
            {show.imageUrl ? (
                <Input
                    label="Image URL"
                    hint={isEdition
                        ? 'URL for the artwork shared by every copy. The URL is saved on-chain, so use a stable host such as IPFS.'
                        : "URL for the collectible's image. The URL is saved on-chain, so use a stable host such as IPFS."}
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    maxLength={MAX_ISSUE_TEXT_LENGTH}
                />
            ) : null}
            {show.maxMint ? (
                <Input
                    label={isEdition ? 'Copies per mint' : 'Max mint per transaction (optional)'}
                    hint={isEdition
                        ? 'How many copies one mint claims. Anyone can mint until the edition sells out.'
                        : 'Caps how much can be minted in one transaction.'}
                    inputMode="decimal"
                    value={maxMint}
                    onChange={(e) => setMaxMint(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.perAddressMax ? (
                <Input
                    label="Limit per address (optional)"
                    hint="The most copies any single address can mint in total. Leave blank for no limit."
                    inputMode="decimal"
                    value={perAddressMax}
                    onChange={(e) => setPerAddressMax(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.mintStartBlock ? (
                <Input
                    label="Minting opens at block (optional)"
                    hint="Block height when public minting starts. Leave blank to open immediately."
                    inputMode="numeric"
                    value={mintStartBlock}
                    onChange={(e) => setMintStartBlock(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.mintStopBlock ? (
                <Input
                    label="Minting closes at block (optional)"
                    hint="Block height when public minting ends. Leave blank to keep it open until sold out."
                    inputMode="numeric"
                    value={mintStopBlock}
                    onChange={(e) => setMintStopBlock(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.lockOnCreate ? (
                <Switch
                    label="Lock supply + minting immediately (irreversible)"
                    checked={lockOnCreate}
                    onChange={(e) => setLockOnCreate(e.target.checked)}
                />
            ) : null}
            {show.transferTo ? (
                <AddressField
                    label="Transfer ownership to (optional)"
                    icon="contacts"
                    hint="Leave blank to keep control. Transferring ownership does not move the minted tokens; use the field below to send those too."
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    onIconClick={() => onPickContact('owner')}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                />
            ) : null}
            {show.transferSupplyTo ? (
                <AddressField
                    label="Send the initial mint to (optional)"
                    icon="contacts"
                    hint="Leave blank to keep the minted tokens at the issuing address."
                    value={transferSupplyTo}
                    onChange={(e) => setTransferSupplyTo(e.target.value)}
                    onIconClick={() => onPickContact('supply')}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                />
            ) : null}
            {resolved === 'custom' && advancedPanel ? (
                <AdvancedIssuePanel {...advancedPanel} />
            ) : null}
            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
                mandatory={nativeFeeMandatory}
            />
        </FormPage>
    );
}

/**
 * PC-06: the Custom template's advanced disclosure - the ISSUE v0
 * fields that used to be reachable only as post-create admin edits.
 *
 * Collapsed by default: these are permanent, consequential settings
 * that most issuers never touch, and every one of them shares the
 * create transaction, so a mistake here costs the token itself.
 */
function AdvancedIssuePanel({
    showAdvanced, setShowAdvanced,
    lockChecks, setLockChecks,
    lockOnCreate,
    callbackTick, setCallbackTick,
    callbackAmount, setCallbackAmount,
    callbackBlock, setCallbackBlock,
    callbackBlockEstimate,
    callbackTickDecimals,
    currentHeight,
    allowListIdx, blockListIdx, allowListCount, blockListCount,
    allowListName, blockListName,
    onPickList, onClearList,
    warnings = [],
}) {
    // The shortcut checkbox above already commits these two flags, so
    // their rows render checked-and-disabled rather than offering a
    // second, contradictory control for the same wire field.
    const forcedByShortcut = { max_supply: !!lockOnCreate, mint: !!lockOnCreate };
    return (
        <div className={styles.advanced}>
            <Button
                type="button"
                variant="ghost"
                block
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced(!showAdvanced)}
            >
                {showAdvanced ? 'Hide advanced settings' : 'Advanced settings (optional)'}
            </Button>
            {!showAdvanced ? (
                <p className={styles.hint}>
                    Locks, a callback, and allow/block lists. All optional, and all
                    settable later from Manage Token - except the locks, which are
                    permanent whenever they are set.
                </p>
            ) : (
                <div className={styles.advancedBody}>
                    <p className={styles.hint}>
                        These settings are included in the transaction that issues the token,
                        so everything below is configured in one signature. If the network
                        rejects any value, it rejects the whole issuance and does not issue the token.
                    </p>

                    <FormSection
                        title="Locks (permanent)"
                        headingLevel="h3"
                        description="Each flag is a one-way switch. Once the token is issued with a lock set, it can never be unlocked."
                    >
                        <div role="group" aria-label="Lock flags">
                            {LOCK_FLAGS.map((f) => {
                                const forced = !!forcedByShortcut[f.key];
                                return (
                                    <div key={f.key} className={styles.lockFlagRow}>
                                        <Checkbox
                                            label={(
                                                <>
                                                    {f.label}
                                                    {forced ? ' (set by "Lock supply + minting immediately")' : ''}
                                                </>
                                            )}
                                            description={f.hint}
                                            checked={forced || !!lockChecks[f.key]}
                                            disabled={forced}
                                            onChange={(e) => setLockChecks({
                                                ...lockChecks,
                                                [f.key]: e.target.checked,
                                            })}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </FormSection>

                    <FormSection
                        title="Callback"
                        headingLevel="h3"
                        description={<>A callback lets you later recall <strong>all</strong> of this token back to your address in one action, paying every holder a set amount of another token per unit they held. It can only be configured before any supply is distributed, so setting it during issuance guarantees it is available.</>}
                    >
                        <Input
                            label="Callback token (optional)"
                            hint="The ticker holders are paid in when you call back. Must be a token you'll hold enough of to cover every holder."
                            value={callbackTick}
                            onChange={(e) => setCallbackTick(e.target.value.toUpperCase())}
                            autoComplete="off"
                            autoCapitalize="characters"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                        <Input
                            label="Payout per unit"
                            hint={callbackTickDecimals != null
                                ? `How much of ${callbackTick} each holder receives per unit they hold. Up to ${callbackTickDecimals} decimal place${callbackTickDecimals === 1 ? '' : 's'}.`
                                : 'How much of the callback token each holder receives per unit they hold. Whole numbers only until the wallet can confirm the callback token is divisible.'}
                            inputMode="decimal"
                            value={callbackAmount}
                            onChange={(e) => setCallbackAmount(e.target.value)}
                            autoComplete="off"
                        />
                        <Input
                            label="Callback allowed from block"
                            hint={callbackBlockEstimate
                                ? `The earliest block you can trigger the callback. Est. ${callbackBlockEstimate}.`
                                : 'The earliest block height you can trigger the callback. Must be a future block.'}
                            inputMode="numeric"
                            value={callbackBlock}
                            onChange={(e) => setCallbackBlock(e.target.value)}
                            autoComplete="off"
                        />
                        {currentHeight != null ? (
                            <p className={styles.hint}>
                                Current block: {currentHeight.toLocaleString('en-US')}.
                                Date above is a rough estimate; real block times vary.
                            </p>
                        ) : null}
                    </FormSection>

                    <FormSection
                        title="Access lists"
                        headingLevel="h3"
                        description="Restrict who can interact with the token by pointing it at address lists you've published. An allow-list permits only its members; a block-list denies its members. Create one in My Lists first."
                    >
                        {/* Value-and-action rows remain custom because the UI kit has no list-picker field. */}
                        <div className={styles.listRow}>
                            <div className={styles.fromLine}>
                                <span className={styles.detailsLabel}>Allow-list</span>
                                <span className={styles.detailsValue}>
                                    {allowListIdx
                                        ? `${listLabel(allowListIdx, allowListName)}${allowListCount != null ? ` · ${allowListCount} member${allowListCount === 1 ? '' : 's'}` : ''}`
                                        : 'None (anyone may interact)'}
                                </span>
                            </div>
                            <Button type="button" variant="ghost" onClick={() => onPickList('allow')}>
                                {allowListIdx ? 'Change allow-list' : 'Choose allow-list'}
                            </Button>
                            {allowListIdx ? (
                                <Button type="button" variant="ghost" onClick={() => onClearList('allow')}>
                                    Remove
                                </Button>
                            ) : null}
                        </div>
                        {/* Value-and-action rows remain custom because the UI kit has no list-picker field. */}
                        <div className={styles.listRow}>
                            <div className={styles.fromLine}>
                                <span className={styles.detailsLabel}>Block-list</span>
                                <span className={styles.detailsValue}>
                                    {blockListIdx
                                        ? `${listLabel(blockListIdx, blockListName)}${blockListCount != null ? ` · ${blockListCount} member${blockListCount === 1 ? '' : 's'}` : ''}`
                                        : 'None'}
                                </span>
                            </div>
                            <Button type="button" variant="ghost" onClick={() => onPickList('block')}>
                                {blockListIdx ? 'Change block-list' : 'Choose block-list'}
                            </Button>
                            {blockListIdx ? (
                                <Button type="button" variant="ghost" onClick={() => onClearList('block')}>
                                    Remove
                                </Button>
                            ) : null}
                        </div>
                        <p className={styles.hint}>
                            Removing a list here only clears it before the token exists. Once
                            issued, a bound list can be replaced but never removed: the
                            protocol has no "clear" for one. To lift a restriction later, point
                            it at an empty address list.
                        </p>
                    </FormSection>

                    {warnings.length > 0 ? (
                        <FormNotice variant="warning" role="alert" lines={warnings} />
                    ) : null}
                </div>
            )}
        </div>
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
