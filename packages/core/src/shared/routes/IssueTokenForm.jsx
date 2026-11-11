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
    NetworkField,
    OptionalPill,
    AddressText,
    Icon,
    StatusMessage,
    FeeSelector,
    AddressField,
    FormErrorSummary,
    Switch,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
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
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { FeesCard } from '../components/FeesCard.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { MAX_TICKER_LENGTH, TICKER_HELP, tickerGrammarError } from '../utils/tickerGrammar.js';
import {
    issueDescriptionError,
    issueSupplyLimitError,
} from '../utils/issueFieldValidation.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { tickLookupVerdict } from '../utils/listTickItems.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { useFormLeaveGuard } from '../hooks/useFormLeaveGuard.js';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { DraftDiscardButton } from '../components/DraftDiscardButton.jsx';
import {
    compareDecimalStrings,
    subtractDecimalStrings,
} from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/issue.js';
import '../../i18n/locales/en/send.js';

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

const INITIAL_OPEN_SECTIONS = {
    supply: true,
    publicMinting: false,
    description: false,
    locks: false,
    lists: false,
    ownership: false,
};

function OptionalSection({
    id,
    title,
    summary,
    icon: SectionIcon,
    irreversible = false,
    open,
    onToggle,
    children,
}) {
    const panelId = `issue-section-${id}`;
    return (
        <section className={styles.optionalSection}>
            <Button
                type="button"
                variant="rowAction"
                icon={null}
                className={styles.sectionHeader}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={onToggle}
            >
                <span className={styles.sectionIcon} aria-hidden="true"><SectionIcon /></span>
                <span className={styles.sectionTitle}>{title}</span>
                <OptionalPill />
                {irreversible ? (
                    <span className={styles.irreversibleTag}>{t('issue.irreversible')}</span>
                ) : null}
                {!open ? <span className={styles.sectionSummary}>{summary}</span> : null}
                <span
                    className={`${styles.sectionChevron} ${open ? `${styles.sectionChevronOpen} ${styles.sectionChevronTrailing}` : ''}`}
                    aria-hidden="true"
                >
                    <Icon.ChevronDownIcon />
                </span>
            </Button>
            <div id={panelId} className={styles.sectionBody} hidden={!open}>
                {children}
            </div>
        </section>
    );
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
 * Standalone ISSUE form (§40.2).
 *
 * The Token Creation Wizard (§40.1) is the primary authoring surface.
 * This form is the escape hatch for users who want to compose ISSUE
 * without the template picker: every ISSUE v0 field the Custom
 * template exposes, on a single screen. Two stages: form -> review+sign,
 * mirroring Send.jsx.
 *
 * Backed by the same `messaging.issueToken` helper the wizard uses.
 * No new flow, no new background handler. The review step runs the
 * draft through `decoder.decodeAction` so the plain-English summary
 * matches the sign screen shown for dApp-initiated ISSUE requests.
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
    const [blockList, setBlockList] = useState('');
    const [openSections, setOpenSections] = useState(INITIAL_OPEN_SECTIONS);
    // ISSUE v0 carries two separate destinations, and a form that offers only
    // the first reads as if it moved both: TRANSFER hands away the token's
    // issuer rights, TRANSFER_SUPPLY says where the initial mint lands. The
    // indexer credits MINT_SUPPLY to the issuing address and moves it only when
    // TRANSFER_SUPPLY is set (xchain-indexer src/actions/issue/settle.js), so a
    // tester who filled "Transfer ownership to" on testnet handed the operator
    // control of the token and kept every minted unit, then reported it as a
    // bug. Both fields live here so the form says what the chain will do.
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
        let section;
        if (/supply|initial mint/i.test(formError)) section = 'supply';
        else if (/max mint|mint per address|start block|stop block/i.test(formError)) section = 'publicMinting';
        else if (/description/i.test(formError)) section = 'description';
        else if (/lock/i.test(formError)) section = 'locks';
        else if (/allow list|block list/i.test(formError)) section = 'lists';
        else if (/ownership|destination|sending the initial mint/i.test(formError)) section = 'ownership';
        if (section) setOpenSections((current) => ({ ...current, [section]: true }));
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
            transferSupplyTo, password,
        ]
            .some((value) => String(value || '').trim().length > 0)
        || divisible !== DIVISIBLE_DEFAULT
        || Object.values(locks).some(Boolean)
    ), [
        ticker, supply, initialMint, maxMint, mintAddressMax, mintStartBlock,
        mintStopBlock, description, allowList, blockList, transferTo,
        transferSupplyTo, password, divisible, locks,
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
        });
    }, [
        stage, draftPending, draft, hasRealInput,
        chainId, fromAddressId, ticker, supply, initialMint, maxMint, mintAddressMax,
        mintStartBlock, mintStopBlock, divisible, description, locks, allowList,
        blockList, transferTo, transferSupplyTo, payFeeInNativeCoin,
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
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any network yet. Use Receive to generate one before issuing a token.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key issued on the wallet's OLDEST chain forever. Open
                // on the last-used chain instead, ahead of that fallback,
                // exactly as Send and Swap do.
                setChainId((prev) => pickDefaultChainId(byChain, {
                    explicitChainId: prev,
                    settings,
                }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

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

    // A late response for an earlier ticker must not mark the current name as
    // taken. Cleanup ties each debounced lookup to the exact field value and
    // network that started it, while lookup failures leave protocol validation
    // to composition instead of trapping the form during an explorer outage.
    useEffect(() => {
        const checkedTicker = ticker.trim();
        setTickerCheck({ ticker: checkedTicker, status: checkedTicker ? 'checking' : 'idle' });
        if (!chainId || !checkedTicker || tickerGrammarError(checkedTicker)
            || !tickerLookupSupported) {
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
    }, [chainId, ticker, messaging, tickerLookupSupported]);

    // Editing the ticker or network drops a held submit: the user is no
    // longer asking to review the name they submitted.
    const [reviewQueued, setReviewQueued] = useState(false);
    useEffect(() => { setReviewQueued(false); }, [chainId, ticker]);
    useEffect(() => {
        if (!reviewQueued || tickerCheck.status === 'checking' || tickerCheck.ticker !== ticker.trim()) return;
        setReviewQueued(false);
        handleReview({ preventDefault() {} });
    });

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
            TICK: ticker.trim(),
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
            // the fair-mint shape (see TokenWizard's `edition` template): the
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
        if (description) p.DESCRIPTION = description.trim();
        for (const lock of ISSUE_LOCKS) {
            if (locks[lock.key]) p[lock.field] = '1';
        }
        if (allowList.trim()) p.ALLOW_LIST = allowList.trim();
        if (blockList.trim()) p.BLOCK_LIST = blockList.trim();
        if (transferTo.trim()) p.TRANSFER = transferTo.trim();
        // Only meaningful beside a MINT_SUPPLY: with nothing minted at issuance
        // there is nothing to deliver, and the indexer would ignore the field.
        // The submit check refuses that pairing before it gets here.
        if (transferSupplyTo.trim() && p.MINT_SUPPLY) p.TRANSFER_SUPPLY = transferSupplyTo.trim();
        return p;
    }, [
        ticker, supply, initialMint, maxMint, mintAddressMax, mintStartBlock,
        mintStopBlock, divisible, description, locks, allowList, blockList,
        transferTo, transferSupplyTo,
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
        const checkedTicker = ticker.trim();
        if (tickerLookupSupported
            && (tickerCheck.ticker !== checkedTicker || tickerCheck.status === 'checking')) {
            return { queue: true };
        }
        if (tickerCheck.ticker === checkedTicker && tickerCheck.status === 'taken') {
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

    function handleReview(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        setValidationAttempt((attempt) => attempt + 1);
        const inputsCheck = issueInputsCheck();
        if (inputsCheck?.queue) {
            // A submit that lands inside the debounce or the lookup is held
            // and replayed when the check settles, rather than refused.
            setFormError(null);
            setReviewQueued(true);
            return;
        }
        if (inputsCheck) {
            setFormError(inputsCheck.error);
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode wallets have pubkeys but
    // no keys to sign with. Submit path routes through buildActionPsbt
    // (encode-only, no vault unlock, no signer, no broadcast); the user
    // takes the resulting unsigned PSBT to a Signer-mode wallet.
    const { isWatcherMode } = useWalletMode();

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
        setStage('submitting');
        setSubmitError(null);
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
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
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
    if (/ticker/i.test(formError || '')) issueErrorTarget = { id: 'issue-ticker', label: 'Ticker' };
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
    const hasSupply = isPositiveDecimal(supply) || isPositiveDecimal(initialMint);
    const supplySummary = (() => {
        const parts = [];
        if (isPositiveDecimal(supply)) parts.push(`${supply.trim()} max`);
        if (isPositiveDecimal(initialMint)) parts.push(`${initialMint.trim()} minted`);
        else if (isPositiveDecimal(supply)) parts.push(`${supply.trim()} minted`);
        return parts.length ? parts.join(', ') : t('issue.summary.notSet');
    })();
    const mintingSetCount = [maxMint, mintAddressMax, mintStartBlock, mintStopBlock]
        .filter((value) => String(value).trim()).length;
    const lockCount = ISSUE_LOCKS.filter((lock) => locks[lock.key]).length;
    const toggleSection = (section) => {
        setOpenSections((current) => ({ ...current, [section]: !current[section] }));
    };
    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label={t('issue.title')}
            cardless
            onSubmit={handleReview}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            status={[<FormErrorSummary key="errors" errors={issueErrors} focusKey={validationAttempt} />, draftBanner]}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={hasSupply ? <Icon.TokenIcon /> : <Icon.PlusIcon />}
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !ticker.trim() || actionConfirm.composing}
                >
                    {hasSupply ? t('issue.title') : t('issue.reserveTicker')}
                </Button>
            )}
        >
            <NetworkField disabled={composing} label={t('settings.network.label')} help={t('issue.networkHelp')} value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />

            {fromAddress ? (
                <AddressField
                    disabled={composing}
                    label={t('send.fields.from')}
                    icon="addresses"
                    value={fromAddress.address}
                    help={t('issue.fromHelp')}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel={t('send.source.choose')}
                    aria-required="false"
                />
            ) : (
                <FormNotice variant="error">
                    {t('send.source.noAddress')}
                </FormNotice>
            )}

            <Input
                disabled={composing}
                id="issue-ticker"
                label={<>{t('issue.ticker')} <span className={styles.requiredTag}>{t('issue.required')}</span></>}
                aria-label={t('issue.ticker')}
                required
                help={TICKER_HELP}
                maxLength={MAX_TICKER_LENGTH}
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                error={tickerCheck.ticker === ticker.trim() && tickerCheck.status === 'taken'
                    ? t('issue.tickerTaken', { ticker: ticker.trim() })
                    : undefined}
            />
            <div className={styles.optionalSections} data-xc-preserve-nested-cards>
                <OptionalSection
                    id="supply"
                    title={t('issue.supply')}
                    summary={supplySummary}
                    icon={Icon.TokenIcon}
                    open={openSections.supply}
                    onToggle={() => toggleSection('supply')}
                >
                    {/* Amount fields at the precision Divisible sets: 8 places on, whole
                        numbers off. Switching it re-formats the stored value at once and
                        a value finer than the new precision shows its field error. */}
                    <AmountField
                        disabled={composing}
                        id="issue-supply"
                        aria-required="false"
                        label={t('issue.maxSupply')}
                        help={t('issue.supplyHint')}
                        amount={supply}
                        divisibility={amountDecimals}
                        onAmountFieldChange={(rawValue) => setSupply(String(rawValue).replace(/,/g, ''))}
                        onValidationError={(message) => setAmountInputErrors((prev) => ({ ...prev, supply: message }))}
                    />
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
                    <Switch
                        disabled={composing}
                        label={t('issue.divisible')}
                        checked={divisible}
                        onChange={(event) => setDivisible(event.target.checked)}
                    />
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
                </OptionalSection>

                <OptionalSection
                    id="public-minting"
                    title={t('issue.section.publicMinting')}
                    summary={mintingSetCount
                        ? t('issue.summary.setCount', { count: mintingSetCount })
                        : t('issue.summary.notSet')}
                    icon={Icon.MintIcon}
                    open={openSections.publicMinting}
                    onToggle={() => toggleSection('publicMinting')}
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
                </OptionalSection>

                <OptionalSection
                    id="description"
                    title={t('issue.section.description')}
                    summary={description.trim()
                        ? t('issue.summary.descriptionAdded')
                        : t('issue.summary.notSet')}
                    icon={Icon.PencilIcon}
                    open={openSections.description}
                    onToggle={() => toggleSection('description')}
                >
                    <Textarea
                        disabled={composing}
                        id="issue-description"
                        aria-label={t('issue.descriptionAria')}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        autoComplete="off"
                        rows={4}
                        aria-required="false"
                    />
                </OptionalSection>

                <OptionalSection
                    id="locks"
                    title={t('issue.section.locks')}
                    summary={lockCount
                        ? t(lockCount === 1 ? 'issue.summary.oneLockOn' : 'issue.summary.locksOn', {
                            count: lockCount,
                        })
                        : t('issue.summary.notSet')}
                    icon={Icon.LockIcon}
                    irreversible
                    open={openSections.locks}
                    onToggle={() => toggleSection('locks')}
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
                </OptionalSection>

                <OptionalSection
                    id="lists"
                    title={t('issue.section.lists')}
                    summary={allowList.trim() || blockList.trim()
                        ? t('issue.summary.set')
                        : t('issue.summary.notSet')}
                    icon={Icon.TokenListIcon}
                    open={openSections.lists}
                    onToggle={() => toggleSection('lists')}
                >
                    <Input
                        disabled={composing}
                        id="issue-allow-list"
                        label={t('issue.allowList')}
                        help={t('issue.allowListHelp')}
                        inputMode="numeric"
                        value={allowList}
                        onChange={(e) => setAllowList(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                    <Input
                        disabled={composing}
                        id="issue-block-list"
                        label={t('issue.blockList')}
                        help={t('issue.blockListHelp')}
                        inputMode="numeric"
                        value={blockList}
                        onChange={(e) => setBlockList(e.target.value)}
                        autoComplete="off"
                        aria-required="false"
                    />
                </OptionalSection>

                <OptionalSection
                    id="ownership"
                    title={t('issue.section.ownership')}
                    summary={transferTo.trim()
                        ? t('issue.summary.newOwner')
                        : t('issue.summary.notSet')}
                    icon={Icon.UserIcon}
                    open={openSections.ownership}
                    onToggle={() => toggleSection('ownership')}
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
                </OptionalSection>
            </div>

            <FeesCard
                chainId={chainId}
                quote={protocolFeeQuote}
                pending={protocolFeePending}
                feeSelector={(
                    <FeeSelector
                        chainId={chainId}
                        disabled={composing}
                        key={chainId}
                        label={t('send.networkFee')}
                        coinTicker={coinTicker}
                        tiers={feeTiers}
                        value={feePick}
                        onChange={setFeePick}
                        customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                    />
                )}
                fiat={feeFiatFormatters}
            >
                <NativeFeeToggle
                    disabled={composing}
                    checked={payFeeInNativeCoin}
                    onChange={setPayFeeInNativeCoin}
                    coinTicker={coinTicker}
                    mandatory={nativeFeeMandatory}
                />
            </FeesCard>
        </FormPage>,
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
