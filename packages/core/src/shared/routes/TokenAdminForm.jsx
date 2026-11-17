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
import { t } from '../../i18n/index.js';
import { titleCase } from '../utils/titleCase.js';
import { isExactTypedConfirmation } from '../../flows/typedConfirmation.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Network and the fee selector come from the Wallet Form
// Standard's FromSection and FeeSection.
import { AddressField, Button, FieldNote, FormNotice, Icon, Input, ListPage, Notice, PageHeader, Screen, StatusMessage, Switch, Textarea, useFormErrors } from '@xchain-wallet/core/ui';
// Every Manage token mode is laid out on the Wallet Form Standard:
// From (closed), the mode's own section (open: Token and the mode's fields),
// Network fee, the status slot and the mode's action.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    useFormSections,
} from '../components/formStandard/index.js';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { actionWarningIds } from '../../flows/actionWarnings.js';
// A preset token shows in the standard Token field.
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { invalidateTokenInfo } from '../utils/tokenInfoCache.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { ListField } from '../components/ListField.jsx';
import { NetworksField } from '../components/NetworksField.jsx';
import { NetworksPickerScreen } from '../components/NetworksPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { blockDateEstimateText } from '../utils/blockDateEstimate.js';
import { bridgeChainsList, isReachableBridgeChain, coinDisplay as bridgeCoinDisplay } from './BridgeTick.js';
import { detectAddressCoin, isValidAddressForChain } from '../utils/addressValidation.js';
import { LOCK_FLAGS } from '../utils/issueAdvancedFields.js';
import { lockIconFor } from './lockIcons.js';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { approveRefusal } from '../utils/approveRefusal.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import {
    MAX_ISSUE_TEXT_LENGTH,
    issueDescriptionError,
    issueSupplyLimitError,
} from '../utils/issueFieldValidation.js';
import { currentListMemberCount } from '../../flows/listMembership.js';
import { compareDecimalStrings, formatWithThousands, groupDecodedAmounts, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { exceedsHeadroom, mintHeadroom } from '../utils/mintHeadroom.js';
import { isNativeCoinTick, unknownTickMessage } from '../utils/dividendTickChecks.js';
import { tickLookupVerdict } from '../utils/listTickItems.js';
import { sharedBlockPickState } from '../utils/sharedBlockPick.js';
import { listLabel } from '../utils/listLabel.js';
import { tokenIssuerEligibility } from '../utils/tokenIssuerEligibility.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import {
    TOKEN_RECORD_GATE_KEYS, tokenRecordChangedMessage, tokenRecordChangedSince,
} from '../utils/tokenRecordDrift.js';
import { boundListIndex, listInBothSlots, listInBothSlotsMessage } from '../../flows/accessListSlots.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

// One empty address list, so the list picker's load does not rerun on every
// render while the wallet's addresses are still loading.
const NO_ADDRESSES = Object.freeze([]);

function isPositiveDecimal(value) {
    const text = String(value || '').trim();
    return /^\d+(?:\.\d+)?$/.test(text) && compareDecimalStrings(text, '0') === 1;
}
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

const COIN_DISPLAY = { bitcoin: 'Bitcoin', litecoin: 'Litecoin', dogecoin: 'Dogecoin' };

// Every chain the protocol runs on, as the tickers ISSUE v7's BRIDGE_CHAINS
// carries. Derived from the same map above so a new chain lands in both at once.
const PROTOCOL_COIN_TICKERS = Object.values(PROTOCOL_COIN_TICKER);

function chainLabelFor(descriptor) {
    if (!descriptor?.coin) return null;
    return COIN_DISPLAY[descriptor.coin] || descriptor.coin;
}

// D-81: validate the TRANSFER destination against the chain the
// edit is broadcast on. Ownership moves to an address on that same chain,
// so an address for another coin, for the right coin on the wrong network,
// or simply mistyped, can never own the token: the indexer rejects the
// action ("invalid: TRANSFER (bad address)") and the protocol fee is burnt
// for nothing. The form used to require only a non-empty string, which let
// a mainnet bech32 address through on a regtest wallet with an enabled
// submit button. Same check Send and Sweep make on their destinations.
// Returns an error string, or null when the address is good (or when there
// is no chain yet to validate against).
function newOwnerAddressError(address, descriptor) {
    const a = (address || '').trim();
    if (!a || !descriptor?.coin || !descriptor?.networkKind) return null;
    if (isValidAddressForChain(a, descriptor.coin, descriptor.networkKind)) return null;

    const chainName = COIN_DISPLAY[descriptor.coin] || descriptor.coin;
    // Name the coin it *does* look like when that is unambiguous: far more
    // useful than "invalid" when someone pastes an address for another chain.
    const detected = detectAddressCoin(a);
    if (detected && detected !== descriptor.coin) {
        return `This looks like a ${COIN_DISPLAY[detected] || detected} address, not a ${chainName} address.`;
    }
    return `This is not a valid ${chainLabelFor(descriptor)} address. Check it for typos.`;
}

// The Allow list or Block list field's text: the bound or picked list with its
// member count, "None after this update" once cleared ('0' detaches), or null
// while the token has no list there, so the field shows its placeholder.
function accessListFieldText(idx, label, count) {
    if (idx === '0') return 'None after this update';
    if (!idx) return null;
    return `${label}${count != null ? ` · ${count} member${count === 1 ? '' : 's'}` : ''}`;
}

// PC-02's lock matrix and PC-06's create-time lock panel drive the same
// seven ISSUE lock flags, so the table lives in one place (see
// utils/issueAdvancedFields.js) and neither matrix can drift.

/**
 * Token admin surfaces (§40.5).
 *
 * Thin forms on top of the ISSUE mechanism, selected via `mode`:
 *
 *   - `'lock'`:          granular lock matrix (PC-02) over the seven
 *                         independent, one-way ISSUE v3 flags
 *                         (LOCK_MAX_SUPPLY, LOCK_MAX_MINT, LOCK_MINT,
 *                         LOCK_MINT_SUPPLY, LOCK_DESCRIPTION, LOCK_SLEEP,
 *                         LOCK_CALLBACK). Current state is read from
 *                         `getToken` via `useTokenInfo` (same read
 *                         `'mint-settings'` uses): a flag already set on
 *                         the token renders checked and disabled (locks
 *                         cannot be unset - issue.js `isValidLock` only
 *                         allows 0→1 or no-op, never 1→0), everything
 *                         else is check-to-lock. Only the newly-checked
 *                         flags are sent; an omitted v3 field is a no-op
 *                         (issue.js repopulates it from the existing
 *                         token record), never a clear.
 *   - `'description'`:   updates the on-chain DESCRIPTION
 *                         (ISSUE v1 with a single DESCRIPTION field).
 *   - `'transfer'`:      transfers token ownership to another address
 *                         (ISSUE v0 with the TRANSFER field set).
 *   - `'mint-settings'`: edits the ISSUE v2 mint-configuration fields
 *                         (MAX_MINT, MINT_SUPPLY, TRANSFER_SUPPLY,
 *                         MINT_ADDRESS_MAX, MINT_START_BLOCK,
 *                         MINT_STOP_BLOCK). Current values are read
 *                         from `getToken` via `useTokenInfo` and
 *                         prefilled; a field locked by LOCK_MAX_MINT /
 *                         LOCK_MINT / LOCK_MINT_SUPPLY is disabled with
 *                         an explanatory warning (PC-01). Always
 *                         launched from ManageToken (never the free
 *                         Actions menu), since it needs a real token's
 *                         current values to edit.
 *
 * Until the Token detail page (§40.5 home) exists, `'lock'` /
 * `'description'` / `'transfer'` accept a user-entered ticker. Future
 * prop: `initialTicker` so Token detail can prefill. Every mode uses
 * `messaging.issueToken` (no new background handlers or core flows).
 *
 * @typedef {'lock' | 'description' | 'transfer' | 'mint-settings' | 'callback-settings' | 'access-lists'} AdminMode
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {AdminMode} props.mode
 * @param {() => void} props.onBack
 * @param {'shared-block'} [props.initialPicker]
 */
export function TokenAdminForm({ walletId, mode, onBack, initialChainId, initialTick, initialFromAddress, initialPicker }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id?: string, address?: string }> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [ticker, setTicker] = useState(initialTick || '');
    const [description, setDescription] = useState('');
    const [transferTo, setTransferTo] = useState('');
    // Mint settings (mode === 'mint-settings', PC-01): the four ISSUE v2
    // config fields (prefilled from the current token record) plus the
    // two "mint additional supply now" fields, which have no current
    // value to prefill (they're a one-shot action, not persisted state).
    const [maxMint, setMaxMint] = useState('');
    const [mintAddressMax, setMintAddressMax] = useState('');
    const [mintStartBlock, setMintStartBlock] = useState('');
    const [mintStopBlock, setMintStopBlock] = useState('');
    const [mintSupply, setMintSupply] = useState('');
    const [transferSupply, setTransferSupply] = useState('');
    // Callback settings (mode === 'callback-settings', PC-03, ISSUE v4):
    // the three CALLBACK config fields, prefilled from the current token
    // record. Editable only while supply is undistributed and while
    // LOCK_CALLBACK is unset.
    const [callbackBlock, setCallbackBlock] = useState('');
    const [callbackTick, setCallbackTick] = useState('');
    const [callbackAmount, setCallbackAmount] = useState('');
    // Access lists (mode === 'access-lists', PC-04, ISSUE v5): the ALLOW_LIST
    // / BLOCK_LIST address-list action indexes, prefilled from the token
    // record. `null` = unset; the picker sets a new action index. Member
    // counts are display-only.
    const [allowListIdx, setAllowListIdx] = useState(/** @type {string | null} */ (null));
    const [blockListIdx, setBlockListIdx] = useState(/** @type {string | null} */ (null));
    const [allowListCount, setAllowListCount] = useState(/** @type {number | null} */ (null));
    const [blockListCount, setBlockListCount] = useState(/** @type {number | null} */ (null));
    const [allowListName, setAllowListName] = useState(/** @type {string | null} */ (null));
    const [blockListName, setBlockListName] = useState(/** @type {string | null} */ (null));
    // The list picker for the Allow list or Block list field. Manage token's
    // Shared block list entry opens the block picker on All, where the
    // published lists are.
    const [listPickerFor, setListPickerFor] = useState(
        /** @type {'allow' | 'block' | null} */ (initialPicker === 'shared-block' ? 'block' : null),
    );
    const [listPickerTab, setListPickerTab] = useState(
        /** @type {'all' | undefined} */ (initialPicker === 'shared-block' ? 'all' : undefined),
    );
    const [sharedAllowListLabel, setSharedAllowListLabel] = useState(/** @type {string | null} */ (null));
    const [sharedBlockListLabel, setSharedBlockListLabel] = useState(/** @type {string | null} */ (null));
    const blockListTouched = useRef(false);
    // Bridgeability (mode === 'bridge-settings', ISSUE v7,
    // xchain-token-bridge.md section 7). Three owner-set fields on the ORIGIN
    // row: which destination chains this token may be locked to (default none),
    // a raise-only confirmation depth the federation must honour for its locks,
    // and a one-way freeze of both. `bridgeChainPicks` is a per-coin on/off
    // map because the wire field is a comma list and a free-text box invites a
    // typo that reads as "no chains". The networks are chosen on their own
    // picker page (G117), so the form keeps one field however many chains exist.
    const [bridgeChainPicks, setBridgeChainPicks] = useState(/** @type {Record<string, boolean>} */ ({}));
    const [bridgeNetworksPickerOpen, setBridgeNetworksPickerOpen] = useState(false);
    const [bridgeMinDepth, setBridgeMinDepth] = useState('');
    const [bridgeLock, setBridgeLock] = useState(false);
    const [bridgePrefilled, setBridgePrefilled] = useState(false);
    const [password, setPassword] = useState('');
    // Lock-mode typed-confirmation gate. Locking is irreversible, so
    // the review stage requires the user to type LOCK before the Sign
    // button enables (on top of the existing password / HW gate).
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = isExactTypedConfirmation(typedConfirm, 'LOCK');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [callbackTokenPickerOpen, setCallbackTokenPickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    // The standard sections' open state, held above every early
    // return (pickers, list screens, review). Only the mode's section opens.
    const formSections = useFormSections({ from: false, main: true, fee: false });

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    // The form error standard: the main action is always enabled; a press
    // lists every problem in one notice at the top, outlines each failing
    // field, and a field clears when it changes. Refusals with no field
    // (the source, the fee, a failed compose) go in as form-level entries.
    const form = useFormErrors();
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitPendingRef = useRef(false);
    const reviewInFlightRef = useRef(false);

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default). Settings
    // ride the same load so the last-used chain is known in the render that
    // first shows the form, never applied a beat later.
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
                        'No addresses on any network yet. Use Receive to generate one first.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key opened every token-admin action on the wallet's
                // OLDEST chain forever. Open on the last-used chain instead,
                // behind a caller-seeded one (a token context) and ahead of
                // the first-key fallback, exactly as Send and Swap do.
                if (!lockedToken) {
                    setChainId((prev) => pickDefaultChainId(byChain, {
                        explicitChainId: prev,
                        settings,
                    }));
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const all = addressesByChain[chainId] || [];
        // When the caller knows which address must sign (e.g. issuer
        // address from ManageToken), prefer that.
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        // Otherwise the same default as Send and every other spend-from-balance
        // form: the chain's active address, else the newest HD external. The
        // hand-rolled newest-index sort this replaces ignored the active address
        // entirely, so a wallet that had just generated a receive address paid
        // the fee from an empty one. role='dispenser' excluded: a delegated
        // address vends rather than funds, and must never be a default payer.
        const funding = all.filter((a) => a.role !== 'dispenser');
        setFromAddressId(preferredSourceId(funding, activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain, initialFromAddress]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    // The wallet has no synchronized activation entry for this change yet.
    // Regtest runs the live protocol head, so removal stays hidden elsewhere.
    const listDetachActive = descriptor?.networkKind === 'regtest';
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Live network-aware check on the new owner (D-81). Derived, so
    // it clears itself the moment the address is corrected instead of sitting
    // stale under a field the user already fixed.
    const transferToError = useMemo(
        () => (mode === 'transfer' ? newOwnerAddressError(transferTo, descriptor) : null),
        [mode, transferTo, descriptor],
    );

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Keep the chain-required flag in every submit path without presenting a
    // protocol-fee choice for these free token updates.
    const nativeFee = nativeFeeForFeelessAction(coinTicker);

    // Every mode edits issuer-controlled token state, so each one reads the
    // current owner before it can compose. The same record supplies lock state
    // for the modes that need it. This keeps direct Actions-menu routes behind
    // the same owner boundary as Manage Token instead of relying on a later
    // protocol rejection that still spends the action fee.
    const assetInfo = useTokenInfo({ chainId, tick: ticker });
    const callbackTickKey = callbackTick.trim();
    const callbackTokenInfo = useTokenInfo({
        chainId,
        tick: callbackTickKey,
        skip: mode !== 'callback-settings' || !callbackTickKey,
    });
    // Accept decimal metadata only for the exact chain and ticker still in the field.
    const callbackTokenDivisibility = callbackTokenInfo?.chainId === chainId
        && callbackTokenInfo?.tick === callbackTickKey
        && Number.isInteger(callbackTokenInfo?.divisibility)
        ? callbackTokenInfo.divisibility
        : null;
    // Payout per unit follows the callback token's own format: every
    // edit is checked against its decimal places, and a valid value is padded
    // to them when the callback token changes or the field loses focus.
    const callbackAmountPrecisionError = mode === 'callback-settings' && callbackAmount.trim()
        && callbackTokenDivisibility != null
        ? tokenAmountPrecisionError(callbackAmount.trim(), {
            divisibility: callbackTokenDivisibility,
            tick: callbackTickKey,
            noun: 'Payout per unit',
        })
        : null;
    useEffect(() => {
        if (mode !== 'callback-settings' || callbackTokenDivisibility == null) return;
        setCallbackAmount((v) => padCallbackAmount(v, callbackTokenDivisibility));
    }, [mode, callbackTokenDivisibility]);
    const assetInfoMatchesSelection = !assetInfo || (
        (!assetInfo.chainId || assetInfo.chainId === chainId)
        && (!assetInfo.tick || String(assetInfo.tick) === ticker.trim())
    );
    const currentAssetInfo = assetInfoMatchesSelection ? assetInfo : null;
    const tokenInfoPending = !!chainId && !!ticker && !currentAssetInfo;
    const tokenInfoFailed = !!currentAssetInfo?.loadError;
    const tokenLocks = currentAssetInfo?.locks || {};
    const ownerEligibility = tokenIssuerEligibility({
        tokenInfo: currentAssetInfo,
        addressesByChain,
        chainId,
        tick: ticker,
        sourceAddress: fromAddress?.address,
    });
    const ownershipError = ownerEligibility.error;
    const descriptionLocked = mode === 'description' && !!tokenLocks.description;
    const eligibilityError = descriptionLocked
        ? `Description is permanently locked for ${ticker} and cannot be updated.`
        : ownershipError;
    // A non-owner is told at submit (handleReview), never as soon as the token
    // is picked. Only an unconfirmed issuer and a locked description show early.
    const eagerEligibilityError = descriptionLocked
        ? eligibilityError
        : (ownerEligibility.issuerAddress ? null : ownershipError);
    // Callback config gate (PC-03): the indexer only allows CALLBACK_BLOCK
    // /TICK/AMOUNT edits while LOCK_CALLBACK is unset AND supply is
    // undistributed (issue.js). LOCK_CALLBACK reads straight off the lock
    // map; distribution needs a holder read (below).
    const callbackLocked = !!tokenLocks.callback;
    // LOCK_MAX_MINT: MAX_MINT itself can't change (issue.js "MAX_MINT (locked)").
    const maxMintLocked = !!tokenLocks.max_mint;
    // LOCK_MINT: the MINT command is permanently dead (mint.js "LOCK_MINT").
    // Not a protocol restriction on MINT_ADDRESS_MAX / the mint window, but
    // editing them has no effect once minting itself can never happen again,
    // so the UI disables them here as a courtesy rather than protocol law.
    const mintDeadLocked = !!tokenLocks.mint;
    // LOCK_MINT_SUPPLY: MINT_SUPPLY (mint-now) is blocked (issue.js "MINT_SUPPLY (locked)").
    const mintSupplyLocked = !!tokenLocks.mint_supply;
    // LOCK_MAX_SUPPLY doesn't gate any ISSUE v2 field (MAX_SUPPLY itself is
    // only editable via v0); surfaced as read-only context, nothing to disable.
    const maxSupplyLockedInfo = !!tokenLocks.max_supply;
    const maxMintFieldDisabled = maxMintLocked || mintDeadLocked;
    const mintWindowFieldsDisabled = mintDeadLocked;
    const mintNowFieldsDisabled = mintSupplyLocked;
    const nothingMintEditable = maxMintFieldDisabled && mintWindowFieldsDisabled && mintNowFieldsDisabled;

    // Lock matrix (PC-02): the seven independent, one-way ISSUE v3 locks.
    // `lockChecks` holds only flags the owner has newly checked THIS
    // session; a flag already set on the token (tokenLocks[key]) is never
    // written here; it renders checked-and-disabled straight off tokenLocks.
    const [lockChecks, setLockChecks] = useState(/** @type {Record<string, boolean>} */ ({}));
    const hasAnyNewLock = LOCK_FLAGS.some((f) => lockChecks[f.key] && !tokenLocks[f.key]);
    const allLocksSet = LOCK_FLAGS.every((f) => !!tokenLocks[f.key]);
    // The token's lock state is read as soon as a token is set. While that read
    // runs, or after it fails, no switch can move: the state is not known.
    const lockStateLoading = mode === 'lock' && tokenInfoPending;
    const lockStateUnknown = mode === 'lock' && !!chainId && !!ticker
        && (!currentAssetInfo || !!currentAssetInfo.loadError);

    // Prefill the four persisted mint-config fields from the token's
    // current record, once, so re-fetches (or the user editing a field
    // to empty) don't clobber their in-progress edit. MINT_SUPPLY /
    // TRANSFER_SUPPLY have no current value to prefill: they're a
    // one-shot "mint more now" action bundled into the same edit, not
    // persisted token state. A field the owner already typed into before
    // the token record arrived keeps that text; only empty fields prefill.
    const [mintPrefilled, setMintPrefilled] = useState(false);
    useEffect(() => {
        if (mode !== 'mint-settings' || !assetInfo || mintPrefilled) return;
        setMaxMint((current) => current || assetInfo.mintMax || '');
        setMintAddressMax((current) => current || assetInfo.mintAddressMax || '');
        setMintStartBlock((current) => current || assetInfo.mintStartBlock || '');
        setMintStopBlock((current) => current || assetInfo.mintStopBlock || '');
        setMintPrefilled(true);
    }, [mode, assetInfo, mintPrefilled]);

    // Prefill the three callback-config fields once from the token record
    // (PC-03). Same once-only guard as the mint prefill so a re-fetch (or
    // the owner clearing a field) doesn't clobber an in-progress edit.
    const [callbackPrefilled, setCallbackPrefilled] = useState(false);
    useEffect(() => {
        if (mode !== 'callback-settings' || !assetInfo || callbackPrefilled) return;
        setCallbackBlock(assetInfo.callbackBlock || '');
        setCallbackTick(assetInfo.callbackTick || '');
        setCallbackAmount(assetInfo.callbackAmount || '');
        setCallbackPrefilled(true);
    }, [mode, assetInfo, callbackPrefilled]);

    // Prefill the current allow/block list action indexes once (PC-04).
    const [listsPrefilled, setListsPrefilled] = useState(false);
    useEffect(() => {
        if (mode !== 'access-lists' || !assetInfo || listsPrefilled) return;
        setAllowListIdx(assetInfo.allowList || null);
        if (!blockListTouched.current) setBlockListIdx(assetInfo.blockList || null);
        setListsPrefilled(true);
    }, [mode, assetInfo, listsPrefilled]);

    // The once-only prefills above belong to one token. When the owner moves
    // from one chosen token to another, the next token's record prefills
    // afresh: list bindings, the edited-block-list mark and the mint and
    // callback fields from the first token never carry into an action
    // composed for the second, where they would read as changes to it.
    const prefillSelection = useRef(/** @type {string | null} */ (null));
    useEffect(() => {
        const selection = chainId && ticker ? `${chainId}:${ticker}` : null;
        const previous = prefillSelection.current;
        prefillSelection.current = selection;
        if (previous === selection) return;
        // Each token has its own lock state: switches turned on for the first
        // token never carry to the next, which reloads its own.
        setLockChecks({});
        if (!previous) return;
        blockListTouched.current = false;
        setAllowListIdx(null);
        setBlockListIdx(null);
        setSharedAllowListLabel(null);
        setSharedBlockListLabel(null);
        setListsPrefilled(false);
        setMaxMint('');
        setMintAddressMax('');
        setMintStartBlock('');
        setMintStopBlock('');
        setMintPrefilled(false);
        setCallbackBlock('');
        setCallbackTick('');
        setCallbackAmount('');
        setCallbackPrefilled(false);
    }, [chainId, ticker]);

    // Member counts for whichever allow/block lists are currently set
    // (display only; one detail read each, tolerant of failure).
    useEffect(() => {
        if (mode !== 'access-lists' || !chainId || !allowListIdx || allowListIdx === '0') { setAllowListCount(null); setAllowListName(null); return undefined; }
        if (typeof messaging?.getListByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getListByActionIndex({ chainId, actionIndex: allowListIdx })
            .then((d) => {
                if (!cancelled) {
                    setAllowListCount(currentListMemberCount(d));
                    setAllowListName(typeof d?.name === 'string' && d.name.length > 0 ? d.name : null);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setAllowListCount(null);
                    setAllowListName(null);
                }
            });
        return () => { cancelled = true; };
    }, [mode, chainId, allowListIdx, messaging]);
    useEffect(() => {
        if (mode !== 'access-lists' || !chainId || !blockListIdx || blockListIdx === '0') { setBlockListCount(null); setBlockListName(null); return undefined; }
        if (typeof messaging?.getListByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getListByActionIndex({ chainId, actionIndex: blockListIdx })
            .then((d) => {
                if (!cancelled) {
                    setBlockListCount(currentListMemberCount(d));
                    setBlockListName(typeof d?.name === 'string' && d.name.length > 0 ? d.name : null);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setBlockListCount(null);
                    setBlockListName(null);
                }
            });
        return () => { cancelled = true; };
    }, [mode, chainId, blockListIdx, messaging]);

    // A v5 edit is meaningful only when at least one list changed from the
    // token's current binding (blank = leave-unchanged, so re-submitting
    // the same indexes is a no-op the form shouldn't allow through).
    const listsChanged = mode === 'access-lists' && assetInfo != null && (
        (allowListIdx || null) !== (assetInfo.allowList || null)
        || (blockListIdx || null) !== (assetInfo.blockList || null)
    );

    // --- Bridgeability (ISSUE v7) ---------------------------------------
    // Every protocol coin except the one this token is native to: a token
    // cannot be bridged to the chain it already lives on.
    const bridgeDestinations = useMemo(
        () => PROTOCOL_COIN_TICKERS.filter((t) => t !== coinTicker),
        [coinTicker],
    );
    // The token's current opt-in, as the origin row holds it. `null` means the
    // venue does not report the field, and that is NOT "opted out": the form
    // then prefills nothing and says it cannot read the current setting, rather
    // than showing every box unchecked as if the issuer had cleared them.
    const currentBridgeChains = useMemo(
        () => bridgeChainsList(assetInfo?.bridgeChains ?? assetInfo?.bridge_chains ?? null),
        [assetInfo],
    );
    const bridgeFrozen = !!(assetInfo?.lockBridge ?? assetInfo?.lock_bridge);
    // Milestone 1 keeps policy and bridging mutually exclusive in both
    // directions (token-bridge section 8): a token with a currently bound list
    // cannot opt in. The issuer must detach the policy before opening a bridge.
    const bridgePolicyBound = !!(assetInfo?.allowList || assetInfo?.blockList);
    useEffect(() => {
        if (mode !== 'bridge-settings' || !assetInfo || bridgePrefilled) return;
        if (currentBridgeChains) {
            const picks = {};
            for (const coin of currentBridgeChains) picks[coin] = true;
            setBridgeChainPicks(picks);
        }
        const depth = assetInfo.minDepth ?? assetInfo.min_depth ?? null;
        if (depth !== null && depth !== undefined) setBridgeMinDepth(String(depth));
        setBridgePrefilled(true);
    }, [mode, assetInfo, bridgePrefilled, currentBridgeChains]);
    const pickedBridgeChains = useMemo(
        () => bridgeDestinations.filter((c) => bridgeChainPicks[c]),
        [bridgeDestinations, bridgeChainPicks],
    );
    // The Destination networks field and its picker page (G117): one row per
    // destination ticker, drawn with that coin's chain on this token's network
    // kind (a regtest token shows the regtest icons). The value stays the ticker
    // BRIDGE_CHAINS carries, so the picks map and the compose are unchanged. The
    // row's muted line is the ticker alone: the network kind is the banner's to say.
    const bridgeNetworkKind = descriptor?.networkKind || 'mainnet';
    const bridgeNetworkOptions = useMemo(() => bridgeDestinations.map((coin) => {
        const coinId = Object.keys(PROTOCOL_COIN_TICKER).find((id) => PROTOCOL_COIN_TICKER[id] === coin);
        const chain = coinId ? chainRegistry.byCoin(coinId).find((d) => d.networkKind === bridgeNetworkKind) : null;
        return {
            value: coin,
            chainId: chain?.id || (coinId ? `${coinId}-${bridgeNetworkKind}` : coin),
            title: bridgeCoinDisplay(coin),
            ticker: coin,
            description: coin,
        };
    }), [bridgeDestinations, bridgeNetworkKind]);
    // The entries a lock can reach: a stored lower-case entry checks no box and opens no chain.
    const reachableBridgeChains = useMemo(
        () => (currentBridgeChains || []).filter(isReachableBridgeChain),
        [currentBridgeChains],
    );
    // Compared as sets: the boxes emit the networks in the form's order, so a
    // stored list in another order or with a repeat opens the same networks.
    const bridgeChanged = mode === 'bridge-settings' && (
        bridgeLock
        || [...new Set(pickedBridgeChains)].sort().join(',') !== [...new Set(reachableBridgeChains)].sort().join(',')
        || String(bridgeMinDepth).trim() !== String(assetInfo?.minDepth ?? assetInfo?.min_depth ?? '')
    );

    // Distribution gate (PC-03): CALLBACK config is only editable while
    // supply is undistributed (indexer isDistributed = >1 holder or one
    // non-owner holder). Read the live holder summary so the form can
    // disable the fields with an honest reason. Null while loading /
    // when the read fails: the fields stay editable (a false "distributed"
    // would wrongly block a valid config change), and Review reads the
    // holders again and refuses while they are unread or distributed.
    const [distribution, setDistribution] = useState(/** @type {{ isDistributed: boolean, holderCount: number } | null} */ (null));
    useEffect(() => {
        if (mode !== 'callback-settings' || !chainId || !ticker) { setDistribution(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.tokenHolderSummary !== 'function') return undefined;
        let cancelled = false;
        const owner = assetInfo?.creator || null;
        messaging.tokenHolderSummary({ chainId, tick: ticker, owner })
            .then((s) => { if (!cancelled) setDistribution(s ? { isDistributed: !!s.isDistributed, holderCount: Number(s.holderCount) || 0 } : null); })
            .catch(() => { if (!cancelled) setDistribution(null); });
        return () => { cancelled = true; };
    }, [mode, chainId, ticker, messaging, walletId, assetInfo?.creator]);
    const callbackDistributed = distribution?.isDistributed === true;
    // Fields lock when LOCK_CALLBACK is set (permanent) or supply is
    // already distributed (config frozen once holders exist).
    const callbackFieldsDisabled = callbackLocked || callbackDistributed;

    // Current indexed block height (same read as History's Indexed-stage
    // timeline, messaging.getIndexerWatermark) so the block-height inputs
    // can caption themselves with an estimated date (blockDateEstimate.js).
    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        if (mode !== 'mint-settings' && mode !== 'callback-settings') return undefined;
        if (!chainId) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId })
            .then((r) => { if (!cancelled) setCurrentHeight(r && r.watermark != null ? Number(r.watermark) : null); })
            .catch(() => { if (!cancelled) setCurrentHeight(null); });
        return () => { cancelled = true; };
    }, [mode, chainId, messaging, walletId]);
    const mintStartEstimate = blockDateEstimateText({ coin: descriptor?.coin, currentHeight, targetBlock: mintStartBlock });
    const mintStopEstimate = blockDateEstimateText({ coin: descriptor?.coin, currentHeight, targetBlock: mintStopBlock });
    const callbackBlockEstimate = blockDateEstimateText({ coin: descriptor?.coin, currentHeight, targetBlock: callbackBlock });
    const hasAnyCallbackField = !!(callbackBlock || callbackTick || callbackAmount);
    // One or two of the three set: say what a working callback needs, live.
    const callbackFilledCount = [callbackBlock, callbackTick, callbackAmount]
        .filter((v) => String(v || '').trim()).length;
    const callbackPartlySet = mode === 'callback-settings' && callbackFilledCount > 0 && callbackFilledCount < 3;
    const hasAnyMintField = !!(maxMint || mintAddressMax || mintStartBlock || mintStopBlock || mintSupply || transferSupply);

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
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

    useEffect(() => {
        let cancelled = false;
        if (mode !== 'transfer' || typeof messaging.listContacts !== 'function') return undefined;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(rows || []); })
            .catch(() => { if (!cancelled) setContacts([]); });
        return () => { cancelled = true; };
    }, [mode, messaging]);

    const actionParams = useMemo(
        () => composeAdminParams(mode, {
            ticker,
            description,
            transferTo,
            maxMint,
            mintAddressMax,
            mintStartBlock,
            mintStopBlock,
            mintSupply,
            transferSupply,
            lockChecks,
            currentLocks: currentAssetInfo?.locks || null,
            callbackBlock,
            callbackTick,
            callbackAmount,
            allowListIdx,
            blockListIdx,
            currentAllowList: assetInfo?.allowList || null,
            currentBlockList: assetInfo?.blockList || null,
            bridgeChains: pickedBridgeChains,
            currentBridgeChains,
            bridgeMinDepth,
            currentMinDepth: assetInfo?.minDepth ?? assetInfo?.min_depth ?? '',
            bridgeLock,
        }),
        [mode, ticker, description, transferTo, maxMint, mintAddressMax,
         mintStartBlock, mintStopBlock, mintSupply, transferSupply, lockChecks,
         callbackBlock, callbackTick, callbackAmount,
         allowListIdx, blockListIdx, assetInfo?.allowList, assetInfo?.blockList,
         pickedBridgeChains, currentBridgeChains, bridgeMinDepth, bridgeLock,
         assetInfo?.minDepth, assetInfo?.min_depth, currentAssetInfo?.locks],
    );

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return groupDecodedAmounts(decoderLib.decodeAction({
            action: 'ISSUE',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        }));
    }, [stage, actionParams, chainId]);
    const reviewWarningIds = useMemo(
        () => (decoded ? actionWarningIds({ action: 'ISSUE', params: actionParams }) : []),
        [actionParams, decoded],
    );
    const legacyComposed = useMemo(() => (decoded ? {
        action: 'ISSUE',
        chainId,
        decoded,
        actionWarnings: reviewWarningIds,
        protocolFeeKnownFree: true,
    } : null), [chainId, decoded, reviewWarningIds]);

    async function callbackDistributionError() {
        if (flowsLib.isDemoWallet(walletId) || typeof messaging?.tokenHolderSummary !== 'function') return null;
        let fresh = null;
        try {
            fresh = await messaging.tokenHolderSummary({
                chainId, tick: ticker, owner: currentAssetInfo?.creator || null,
            });
        } catch {
            fresh = null;
        }
        if (!fresh || typeof fresh.isDistributed !== 'boolean') {
            return t('routes.tokenAdmin.callbackHoldersUnread', { tick: ticker.trim() });
        }
        setDistribution({ isDistributed: fresh.isDistributed, holderCount: Number(fresh.holderCount) || 0 });
        if (fresh.isDistributed) {
            return 'Callback settings can only be changed before any supply is distributed. This token already has holders.';
        }
        // A capped or short page is a floor, not the holder set, so an
        // undistributed reading over it proves nothing and Review refuses.
        return fresh.partial === true
            ? t('routes.tokenAdmin.callbackHoldersUnread', { tick: ticker.trim() })
            : null;
    }

    async function handleReview(event) {
        event.preventDefault();
        if (reviewInFlightRef.current) return;
        if (actionUnavailable) return;
        // Every press validates the whole form: an empty required field is
        // marked on the field itself and takes the cursor, and nothing else
        // is checked until it is filled.
        const problems = {};
        if (!ticker.trim()) problems['token-admin-token'] = 'Pick the token.';
        if (mode === 'description' && !descriptionLocked && !description.trim()) {
            problems['token-admin-description'] = 'Enter the new description.';
        }
        if (mode === 'transfer' && !transferTo.trim()) problems['token-admin-transfer-to'] = 'Enter the new owner address.';
        if (mode === 'lock' && singleEncode && !typedConfirmOk) {
            problems['token-admin-lock-confirm'] = 'Type LOCK to confirm the permanent lock.';
        }
        const firstMissing = Object.keys(problems)[0] || null;
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        // A custom fee the fee field already refuses has no message of its own.
        if (feeStop) problems['form:fee'] = feeStop.formError;
        if (!chainId || !fromAddress) problems['form:from'] = 'Pick a source address first.';
        if (firstMissing || feeStop) {
            form.validate(problems);
            if (firstMissing) setTimeout(() => document.getElementById(firstMissing)?.focus(), 0);
            return;
        }
        // The mode checks run in order and the first refusal is listed, under
        // its field's id when it names one.
        let chainProblem = null;
        const setFormError = (message, key = 'form') => { if (!chainProblem) chainProblem = [key, message]; };
        const runChecks = () => {
        if (!ticker.trim()) {
            setFormError('Ticker is required.');
            return;
        }
        const tickerError = tickerReferenceError(ticker);
        if (tickerError) {
            setFormError(tickerError, 'token-admin-token');
            return;
        }
        if (tokenInfoPending) {
            setFormError(`Wait for the wallet to verify the current owner of ${ticker}.`, 'token-admin-token');
            return;
        }
        if (eligibilityError) {
            setFormError(eligibilityError, 'token-admin-token');
            return;
        }
        if (mode === 'description' && !description.trim()) {
            setFormError('Description is required.', 'token-admin-description');
            return;
        }
        if (mode === 'description') {
            const descriptionError = actionTextSafetyError(description, 'Description')
                || issueDescriptionError(description);
            if (descriptionError) {
                setFormError(descriptionError, 'token-admin-description');
                return;
            }
        }
        if (mode === 'transfer') {
            if (!transferTo.trim()) {
                setFormError('New owner address is required.', 'token-admin-transfer-to');
                return;
            }
            if (transferToError) {
                // The field already shows the reason under itself; the banner
                // names the field once instead of saying it again.
                setFormError('Fix the New owner address below.', 'token-admin-transfer-to');
                return;
            }
        }
        if (mode === 'lock' && !hasAnyNewLock) {
            setFormError('Select at least one lock to apply.');
            return;
        }
        if (mode === 'mint-settings') {
            if (!hasAnyMintField) {
                setFormError('Enter at least one field to update.');
                return;
            }
            if (maxMint && !isPositiveDecimal(maxMint)) {
                setFormError('Max mint per transaction must be a positive number.', 'token-admin-max-mint');
                return;
            }
            if (mintAddressMax && !isPositiveDecimal(mintAddressMax)) {
                setFormError('Max mint per address must be a positive number.', 'token-admin-mint-address-max');
                return;
            }
            if (mintSupply && !isPositiveDecimal(mintSupply)) {
                setFormError('Mint supply must be a positive number.', 'token-admin-mint-supply');
                return;
            }
            // Keep all token quantities within this token's on-chain decimal scale.
            for (const [value, noun, fieldId] of [
                [maxMint, 'Max mint per transaction', 'token-admin-max-mint'],
                [mintAddressMax, 'Max mint per address', 'token-admin-mint-address-max'],
                [mintSupply, 'Mint supply', 'token-admin-mint-supply'],
            ]) {
                if (!value) continue;
                const precisionError = tokenAmountPrecisionError(value, {
                    divisibility: assetInfo?.divisibility,
                    tick: ticker,
                    noun,
                });
                if (precisionError) {
                    setFormError(precisionError, fieldId);
                    return;
                }
                const amountLimitError = issueSupplyLimitError(value, noun);
                if (amountLimitError) {
                    setFormError(amountLimitError, fieldId);
                    return;
                }
            }
            if (mintStartBlock && !/^\d+$/.test(mintStartBlock.trim())) {
                setFormError('Minting start must be a whole block number.', 'token-admin-mint-start');
                return;
            }
            if (mintStopBlock && !/^\d+$/.test(mintStopBlock.trim())) {
                setFormError('Minting close must be a whole block number.', 'token-admin-mint-stop');
                return;
            }
            if (mintAddressMax && maxMint
                && compareDecimalStrings(mintAddressMax, maxMint) === -1) {
                setFormError('Max mint per address must be at least the max mint per transaction.', 'token-admin-mint-address-max');
                return;
            }
            if (mintStartBlock && mintStopBlock && Number(mintStopBlock) <= Number(mintStartBlock)) {
                setFormError('Minting must close after it opens. Check the block numbers.', 'token-admin-mint-stop');
                return;
            }
            // Mint supply creates supply in this transaction, so it is bounded by what
            // is left under the cap exactly as a MINT is; the indexer refuses an excess
            // after the fee is spent. The form refuses it while the cap (above 0, since
            // 0 is uncapped) and the current supply are both known for this ticker.
            const capInfo = currentAssetInfo;
            const capped = capInfo?.maxSupply != null && compareDecimalStrings(capInfo.maxSupply, '0') === 1;
            const supplyRoom = capped && capInfo?.totalSupply != null
                ? mintHeadroom({ maxSupply: capInfo.maxSupply, totalSupply: capInfo.totalSupply })
                : null;
            if (mintSupply && exceedsHeadroom(mintSupply, supplyRoom)) {
                setFormError(`Only ${formatWithThousands(supplyRoom)} ${ticker.trim()} can still be minted.`, 'token-admin-mint-supply');
                return;
            }
            if (transferSupply && !mintSupply) {
                setFormError('Sending new supply needs a mint supply amount.', 'token-admin-mint-supply');
                return;
            }
            if (transferSupply && !isValidAddressForChain(
                transferSupply.trim(), descriptor.coin, descriptor.networkKind,
            )) {
                setFormError(`New supply destination is not valid for ${descriptor.displayName || chainId}.`, 'token-admin-transfer-supply');
                return;
            }
        }
        if (mode === 'callback-settings') {
            if (callbackLocked) {
                setFormError('Callback is permanently locked for this token.');
                return;
            }
            if (callbackDistributed) {
                setFormError('Callback settings can only be changed before any supply is distributed. This token already has holders.');
                return;
            }
            if (!hasAnyCallbackField) {
                setFormError('Enter at least one callback field to update.');
                return;
            }
            if (callbackBlock && (!/^\d+$/.test(String(callbackBlock).trim()) || (currentHeight != null && Number(callbackBlock) < currentHeight))) {
                setFormError('Callback block must be a whole block height at or after the current block.', 'token-admin-callback-block');
                return;
            }
            const callbackTickError = callbackTick
                ? tickerReferenceError(callbackTick, { noun: 'Callback token' })
                : null;
            if (callbackTickError) {
                setFormError(callbackTickError);
                return;
            }
            // The payout token must be an XChain token on this chain: a callback that names the
            // chain's own coin or a token that does not exist can never pay, and the terms freeze
            // once supply is distributed.
            if (callbackTickKey && isNativeCoinTick(callbackTickKey, { coinTicker, descriptor })) {
                setFormError(`${coinTicker} is ${descriptor?.displayName || 'the native coin'} itself, not an XChain token. A callback pays holders in an XChain token, so enter one of those.`);
                return;
            }
            const callbackTickMatches = callbackTokenInfo?.chainId === chainId && callbackTokenInfo?.tick === callbackTickKey;
            if (callbackTickKey && !callbackTickKey.startsWith('^') && callbackTickMatches
                && tickLookupVerdict(callbackTokenInfo) === 'missing') {
                setFormError(unknownTickMessage(callbackTickKey, descriptor?.displayName || 'the active network'));
                return;
            }
            if (callbackAmount && !isPositiveDecimal(callbackAmount)) {
                setFormError('Callback amount must be a positive number.', 'token-admin-callback-amount');
                return;
            }
            // Hold fractional payouts until the newly typed token lookup resolves.
            if (callbackAmount.includes('.') && callbackTokenDivisibility == null) {
                setFormError(`Callback amount must be a whole number until the wallet confirms whether ${callbackTickKey || 'the callback token'} supports decimals.`, 'token-admin-callback-amount');
                return;
            }
            // Price callback payouts in the payout token's decimal scale.
            const callbackPrecisionError = tokenAmountPrecisionError(callbackAmount, {
                divisibility: callbackTokenDivisibility,
                tick: callbackTick,
                noun: 'Callback amount',
            });
            if (callbackPrecisionError) {
                setFormError(callbackPrecisionError, 'token-admin-callback-amount');
                return;
            }
            // A usable callback needs all three set (block + tick + amount);
            // warn if the owner is leaving the config half-built. This is a
            // soft guard: a partial edit is protocol-valid (blank = keep),
            // but a token with e.g. a block and no tick can never fire.
            const effTick = callbackTick || assetInfo?.callbackTick;
            const effAmount = callbackAmount || assetInfo?.callbackAmount;
            const effBlock = callbackBlock || assetInfo?.callbackBlock;
            if ((effBlock || effTick || effAmount) && !(effBlock && effTick && effAmount)) {
                setFormError('A working callback needs a block, a payout token, and a payout amount. Fill all three (values you leave blank keep their current setting).');
                return;
            }
        }
        if (mode === 'access-lists') {
            if (!listsChanged) {
                setFormError('Pick a different allow-list or block-list to apply. Leaving both unchanged does nothing.');
                return;
            }
            // One list in both slots admits nobody: every address the allow-list
            // accepts the block-list refuses. Dispensers refuse the same pairing.
            if (listInBothSlots({ allowList: allowListIdx, blockList: blockListIdx })) {
                setFormError(listInBothSlotsMessage(boundListIndex(allowListIdx)));
                return;
            }
        }
        if (mode === 'bridge-settings') {
            if (bridgeFrozen) {
                setFormError('Bridge settings are permanently frozen for this token. Neither the network list nor the depth can change again.');
                return;
            }
            if (bridgePolicyBound && pickedBridgeChains.length > 0) {
                setFormError('A token bound to an allow-list or block-list cannot be opened to the bridge: the copy on the other network would carry none of that policy. Detach the policy list first.');
                return;
            }
            const depth = String(bridgeMinDepth).trim();
            if (depth && !/^\d+$/.test(depth)) {
                setFormError('Minimum confirmations must be a whole number of blocks.', 'token-admin-bridge-depth');
                return;
            }
            if (!bridgeChanged) {
                setFormError('Change a destination network, the minimum confirmations, or the freeze before applying.');
                return;
            }
        }
        };
        runChecks();
        if (chainProblem) problems[chainProblem[0]] = chainProblem[1];
        if (!form.validate(problems)) return;
        // The gates and prefilled values above came from the record read when
        // the form opened; a lock, transfer or settings edit since then makes
        // them stale. Mint settings also bounds a mint-now amount by supply.
        reviewInFlightRef.current = true;
        try {
            // The holder read that disables the callback fields can fail or
            // predate the first transfer out, and the indexer refuses a
            // callback edit on distributed supply after the fee is spent, so
            // Review reads it again and refuses when it is unread.
            if (mode === 'callback-settings') {
                const distributionError = await callbackDistributionError();
                if (distributionError) {
                    form.fail(distributionError);
                    return;
                }
            }
            const watched = mode === 'mint-settings' && mintSupply
                ? [...TOKEN_RECORD_GATE_KEYS, 'totalSupply']
                : TOKEN_RECORD_GATE_KEYS;
            if (await tokenRecordChangedSince({
                messaging, chainId, tick: ticker.trim(), current: currentAssetInfo, keys: watched,
            })) {
                form.fail(tokenRecordChangedMessage(ticker.trim()));
                return;
            }
        } finally {
            reviewInFlightRef.current = false;
        }
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    // Token admin uses the ISSUE action with admin-only field combinations.
    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included. Watcher mode still branches: it encodes, it
    // never signs.
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
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: async (prebuiltPsbt) => {
                    // Review checked the owner and gates before composing; the
                    // confirm page's pre-flight re-check waits for its report to
                    // age, so a transfer, lock or list binding that lands while
                    // the page is open is caught here.
                    if (await tokenRecordChangedSince({
                        messaging, chainId, tick: ticker.trim(), current: currentAssetInfo, keys: TOKEN_RECORD_GATE_KEYS,
                    })) {
                        throw approveRefusal(tokenRecordChangedMessage(ticker.trim()));
                    }
                    return submitConfirmed({
                        walletId,
                        chainId,
                        from,
                        params: actionParams,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    });
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            form.fail(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Update failed.',
            }));
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (submitPendingRef.current) return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        submitPendingRef.current = true;
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
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ISSUE', params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
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
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || `${MODE_LABEL[mode] || 'Action'} failed.`,
                    }),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitPendingRef.current = false;
        }
    }

    function handleBuildAnother() {
        setResult(null);
        form.reset(); // a fresh form opens with no marks
        setSubmitError(null);
        setStage('form');
    }
        const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setTypedConfirm(''); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting'
                    ? titleCase(`Review ${MODE_LABEL_LOWER[mode]}`)
                    : titleCase(`${MODE_LABEL[mode]}`)}
        />
    );
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(<ListPage notices={<StatusMessage variant="error">{loadError}</StatusMessage>} />);
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
                    onDone={onBack}
                />,
            );
        }
        // Signed, not broadcast. The confirm pipeline resolves this
        // case, so the done screen has to tell them apart.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} what="update" unsaved={result.unsaved} />);
        }
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>{MODE_DONE_TITLE[mode]}</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return (
            <ConfirmActionModal
                phase={stage === 'submitting' ? 'signing' : 'ready'}
                composed={legacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={stage === 'review'}
                onApprove={() => handleSubmit({ preventDefault() {} })}
                onReject={() => { setSubmitError(null); setTypedConfirm(''); setStage('form'); }}
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentialsReady={mode !== 'lock' || typedConfirmOk}
                credentials={(
                    <>
                        <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                        {mode === 'lock' ? (
                            <Input
                                label="Type LOCK to confirm"
                                help={t('common.typedConfirmationHint', { word: 'LOCK' })}
                                value={typedConfirm}
                                onChange={(event) => setTypedConfirm(event.target.value)}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                        ) : null}
                    </>
                )}
                summary={{
                    verb: titleCase(MODE_SUBMIT_LABEL[mode] || MODE_LABEL[mode] || ''),
                    ticker: String(ticker || '').trim().toUpperCase(),
                    chainId,
                    direction: 'none',
                    address: fromAddress?.address,
                    ...(mode === 'transfer' && transferTo.trim() ? { recipient: transferTo.trim() } : {}),
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        // Every mode changes the token itself: the token is the hero, the
        // mode is the action, and a transfer names the new owner.
        const adminSummary = {
            verb: titleCase(MODE_SUBMIT_LABEL[mode] || MODE_LABEL[mode] || ''),
            ticker: String(ticker || '').trim().toUpperCase(),
            chainId,
            direction: 'none',
            address: fromAddress?.address,
            ...(mode === 'transfer' && transferTo.trim() ? { recipient: transferTo.trim() } : {}),
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={adminSummary}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // An ownership transfer's warning is the confirm screen's
                // warnings card (flows/actionWarnings.js TOKEN_OWNERSHIP_TRANSFER).
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
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

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select Token"
                onSelect={(sel) => {
                    setTicker(String(sel.tick || ''));
                    if (!lockedToken && sel.chainId) setChainId(sel.chainId);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    if (callbackTokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                chainIdFilter={chainId}
                kindFilter="tokens"
                kindLocked
                title="Select Callback Token"
                onSelect={(sel) => {
                    setCallbackTick(String(sel.tick || ''));
                    setCallbackTokenPickerOpen(false);
                }}
                onBack={() => setCallbackTokenPickerOpen(false)}
            />
        );
    }

    if (contactsPickerOpen) {
        return (
            <ContactsPickerScreen
                variant={variant}
                contacts={contacts}
                onPick={(entry) => {
                    setTransferTo(entry.address);
                    form.clear('token-admin-transfer-to');
                    form.clear('token-admin-transfer-supply');
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    // G117: Destination networks opens its own picker page. Each switch writes
    // the picks map straight away, so Back returns to the form showing the new
    // choice; a frozen or policy-bound token cannot open it (the field is
    // disabled), and the switches stay disabled here too as a second guard.
    if (bridgeNetworksPickerOpen && mode === 'bridge-settings') {
        return (
            <NetworksPickerScreen
                variant={variant}
                title="Destination Networks"
                options={bridgeNetworkOptions}
                selected={pickedBridgeChains}
                disabled={bridgeFrozen || bridgePolicyBound}
                notice="Turn on each network this token may be bridged to. Turning every network off closes the bridge to new transfers."
                onToggle={(coin, on) => setBridgeChainPicks((prev) => ({ ...prev, [coin]: on }))}
                onBack={() => setBridgeNetworksPickerOpen(false)}
            />
        );
    }

    // PC-04: the list picker for the Allow list and Block list fields. Only
    // TYPE=2 (address) lists are valid ALLOW_LIST/BLOCK_LIST targets
    // (issue.js isValidList(x, 2)), so filter to them. A published list from
    // the shared directory binds its local mirror on this chain, exactly as
    // a plain list index does, and keeps its "shared from" label.
    if (listPickerFor) {
        const closePicker = () => { setListPickerFor(null); setListPickerTab(undefined); };
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || NO_ADDRESSES}
                filterType="2"
                includeUnions
                walletId={walletId}
                initialTab={listPickerTab}
                title={listPickerFor === 'allow' ? 'Select Allow List' : 'Select Block List'}
                onSelect={(row) => {
                    const shared = row.shared ? sharedBlockPickState(row) : null;
                    if (row.shared && !shared) return;
                    const name = shared ? null : (typeof row.name === 'string' && row.name.length > 0 ? row.name : null);
                    if (listPickerFor === 'allow') {
                        setAllowListIdx(shared ? shared.blockListIdx : row.actionIndex);
                        setAllowListCount(shared ? shared.memberCount : row.memberCount);
                        setAllowListName(name);
                        setSharedAllowListLabel(shared ? shared.label : null);
                    } else {
                        blockListTouched.current = true;
                        setBlockListIdx(shared ? shared.blockListIdx : row.actionIndex);
                        setBlockListCount(shared ? shared.memberCount : row.memberCount);
                        setBlockListName(name);
                        setSharedBlockListLabel(shared ? shared.label : null);
                    }
                    closePicker();
                }}
                onBack={closePicker}
            />
        );
    }

    // Which standard section the current error belongs to, so that
    // section reopens on every attempt; and the closed sections' summaries.
    // A source refusal belongs to From, a custom fee refusal (the review's
    // fee stop) to Network fee, every other entry to the main section.
    const errorKeys = Object.keys(form.errors);
    const sectionHasError = (id) => (id === 'from' ? errorKeys.includes('form:from')
        : id === 'fee' ? errorKeys.includes('form:fee')
            : errorKeys.some((key) => key !== 'form:from' && key !== 'form:fee'));
    const sectionErrorKey = (id) => (sectionHasError(id)
        ? (id === 'fee' ? `fee-${form.errors['form:fee']}-${form.attempt}` : form.attempt + 1)
        : 0);
    // No source to default to: no funding address on the network (the default
    // skips dispenser-delegated ones) and none picked by hand.
    const sourceMissing = Boolean(addressesByChain) && !fromAddress
        && (addressesByChain[chainId] || []).filter((a) => a.role !== 'dispenser').length === 0;
    const mainSummary = ticker ? String(ticker).trim().toUpperCase() : null;
    const ModeIcon = MODE_ACTION_ICON[mode] || Icon.GearIcon;
    const actionUnavailable = tokenInfoPending || tokenInfoFailed
        || (mode === 'mint-settings' && nothingMintEditable)
        || (mode === 'callback-settings' && callbackFieldsDisabled)
        || (mode === 'lock' && (allLocksSet || lockStateUnknown));
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={MODE_LABEL[mode]}
            onSubmit={handleReview}
            // The press list leads the page, far above the button on a phone.
            errors={form}
            status={!form.hasErrors && eagerEligibilityError ? (
                <StatusMessage
                    variant="error"
                    recovery={tokenInfoFailed ? {
                        label: t('common.tryAgain'),
                        onAction: () => invalidateTokenInfo(chainId, ticker),
                    } : undefined}
                >
                    {eagerEligibilityError}
                </StatusMessage>
            ) : null}
            action={(
                // The main action is green on every mode, Lock token
                // included; the typed LOCK gate carries the warning.
                // The standard FormAction: an icon per mode and a verb label.
                <FormAction
                    icon={<ModeIcon />}
                    loading={actionConfirm.composing}
                    // G22: never disabled for an empty or unchanged field; a
                    // press marks it or says what to change. Only a live read
                    // or a token with nothing left to change holds it.
                    aria-disabled={actionUnavailable ? 'true' : undefined}
                >
                    {titleCase(MODE_SUBMIT_LABEL[mode])}
                </FormAction>
            )}
            from={(
                // Network and From live in the closed From section.
                // The token decides the network: a preset token locks it, and
                // the Token picker lists every chain and moves the form, so
                // Network locks once a token is set.
                <FromSection
                    {...formSections.bind('from')}
                    revealKey={sectionErrorKey('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={setChainId}
                    lockNetwork={lockedToken || Boolean(ticker)}
                    networkHelp={MODE_NETWORK_HELP[mode]}
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp={MODE_FROM_HELP[mode]}
                    missing={sourceMissing ? (
                        <FormNotice variant="error">
                            {t('send.source.noAddress')}
                        </FormNotice>
                    ) : null}
                    formErrorKey="form:from"
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    revealKey={sectionErrorKey('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    formErrorKey="form:fee"
                />
            )}
        >
            <FormSection
                id="main"
                title={MODE_SECTION_TITLE[mode] || titleCase(MODE_LABEL[mode] || '')}
                icon={ModeIcon}
                {...formSections.bind('main')}
                revealKey={sectionErrorKey('main')}
                summary={mainSummary}
            >
            {/* The token always shows as the standard Token field (icon and
                ticker); a preset token fills it and its picker stays shut. */}
            {lockedToken ? (
                <TokenField
                    label="Token"
                    help={MODE_TOKEN_HELP[mode]}
                    value={ticker && chainId ? { chainId, tick: ticker } : null}
                    disabled
                />
            ) : (
                <TokenField
                    id="token-admin-token"
                    label="Token"
                    help={MODE_TOKEN_HELP[mode]}
                    value={ticker && chainId ? { chainId, tick: ticker } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}

            {mode === 'description' ? (
                <Textarea
                    id="token-admin-description"
                    label="Description"
                    help={`Stored on-chain and replaces the current description. Up to ${MAX_ISSUE_TEXT_LENGTH} characters.`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={descriptionLocked}
                    autoComplete="off"
                    maxLength={MAX_ISSUE_TEXT_LENGTH}
                    rows={4}
                />
            ) : null}

            {mode === 'transfer' ? (
                <AddressField
                    label="New owner address"
                    icon="contacts"
                    help={`The ${chainLabelFor(descriptor) || 'same-network'} address that will receive ownership.`}
                    id="token-admin-transfer-to"
                    value={transferTo}
                    error={transferToError || undefined}
                    onChange={(e) => {
                        setTransferTo(e.target.value);
                        // Drop any form-level error the previous submit left
                        // behind; the field's own error is derived and live.
                        form.clear('form');
                    }}
                    onIconClick={() => setContactsPickerOpen(true)}
                />
            ) : null}

            {mode === 'lock' ? (
                <>
                    {allLocksSet ? (
                        <p className={styles.hint}>Everything is already locked.</p>
                    ) : null}
                    {/* The same lock switches as the Issue form: each row's icon
                        names the thing locked; the switch shows the state. The
                        token's own lock state decides which are on and fixed;
                        until it is read (or when the read fails) none can move. */}
                    <div
                        role="group"
                        aria-label="Lock flags"
                        aria-busy={lockStateLoading ? 'true' : undefined}
                        className={styles.lockFlagList}
                    >
                        {LOCK_FLAGS.map((f) => {
                            const isLocked = !!tokenLocks[f.key];
                            const checked = isLocked || !!lockChecks[f.key];
                            const ItemIcon = lockIconFor(f.field);
                            return (
                                <div
                                    key={f.key}
                                    className={checked ? `${styles.lockRow} ${styles.lockRowOn}` : styles.lockRow}
                                    data-lock-flag={f.key}
                                >
                                    <Switch
                                        icon={<ItemIcon />}
                                        id={`token-admin-lock-${f.key}`}
                                        label={`${f.label}${isLocked ? ' (already locked)' : ''}`}
                                        description={isLocked ? 'Already locked' : f.hint}
                                        help={f.help}
                                        checked={checked}
                                        disabled={isLocked || lockStateUnknown}
                                        onChange={(e) => setLockChecks((prev) => ({
                                            ...prev,
                                            [f.key]: e.target.checked,
                                        }))}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : null}

            {mode === 'mint-settings' ? (
                <>
                    {nothingMintEditable ? (
                        <FormNotice variant="warning" role="alert">
                            {`Every mint setting for ${ticker} is permanently locked. There is nothing left to edit here.`}
                        </FormNotice>
                    ) : (
                        <>
                            {mintDeadLocked ? (
                                <FormNotice variant="warning" role="alert">
                                    {`Minting is permanently locked for ${ticker}. The mint window, max mint per transaction, and per-address cap below can no longer take effect.`}
                                </FormNotice>
                            ) : maxMintLocked ? (
                                <FormNotice variant="warning" role="alert">
                                    {`Max mint per transaction is permanently locked for ${ticker}.`}
                                </FormNotice>
                            ) : null}
                            {mintSupplyLocked ? (
                                <FormNotice variant="warning" role="alert">
                                    {`Mint supply is permanently locked for ${ticker}.`}
                                </FormNotice>
                            ) : null}
                            {maxSupplyLockedInfo ? (
                                <FormNotice variant="warning" role="alert">
                                    {`Max supply is also permanently locked for ${ticker}. That is a separate token setting, not part of Mint settings.`}
                                </FormNotice>
                            ) : null}
                        </>
                    )}

                    <Input
                        id="token-admin-max-mint"
                        label="Max mint per transaction"
                        optional
                        help="Caps how much can be minted in one transaction. Leave blank for no limit."
                        inputMode="decimal"
                        value={maxMint}
                        onChange={(e) => setMaxMint(e.target.value)}
                        autoComplete="off"
                        disabled={maxMintFieldDisabled}
                    />
                    <Input
                        id="token-admin-mint-address-max"
                        label="Max mint per address"
                        optional
                        help="The most this address can ever mint in total, across every MINT transaction. Leave blank for no limit."
                        inputMode="decimal"
                        value={mintAddressMax}
                        onChange={(e) => setMintAddressMax(e.target.value)}
                        autoComplete="off"
                        disabled={mintWindowFieldsDisabled}
                    />
                    <Input
                        id="token-admin-mint-start"
                        label="Minting opens at block"
                        optional
                        help="Block height when public minting starts. Leave blank to open immediately. Dates shown are rough estimates; real block times vary."
                        // Live text only under the field (U57): the estimate
                        // and the current block, never a loose note below.
                        hint={[
                            mintStartEstimate ? `Est. ${mintStartEstimate}.` : null,
                            currentHeight != null ? `Current block: ${String(currentHeight)}.` : null,
                        ].filter(Boolean).join(' ') || undefined}
                        inputMode="numeric"
                        value={mintStartBlock}
                        onChange={(e) => setMintStartBlock(e.target.value)}
                        autoComplete="off"
                        disabled={mintWindowFieldsDisabled}
                    />
                    <Input
                        id="token-admin-mint-stop"
                        label="Minting closes at block"
                        optional
                        help="Block height when public minting ends. Leave blank to keep it open. Dates shown are rough estimates; real block times vary."
                        hint={mintStopEstimate ? `Est. ${mintStopEstimate}.` : undefined}
                        inputMode="numeric"
                        value={mintStopBlock}
                        onChange={(e) => setMintStopBlock(e.target.value)}
                        autoComplete="off"
                        disabled={mintWindowFieldsDisabled}
                    />
                    <Input
                        id="token-admin-mint-supply"
                        label="Mint supply now"
                        optional
                        help="Mints this amount immediately, in this same transaction, on top of the settings above."
                        inputMode="decimal"
                        value={mintSupply}
                        onChange={(e) => setMintSupply(e.target.value)}
                        autoComplete="off"
                        disabled={mintNowFieldsDisabled}
                    />
                    <AddressField
                        id="token-admin-transfer-supply"
                        label="Send that new supply to"
                        optional
                        icon="contacts"
                        help="Only used together with Mint supply now. Leave blank to keep it in your own address."
                        value={transferSupply}
                        onChange={(e) => setTransferSupply(e.target.value)}
                        onIconClick={() => setContactsPickerOpen(true)}
                        disabled={mintNowFieldsDisabled}
                    />
                </>
            ) : null}

            {mode === 'callback-settings' ? (
                <>
                    {callbackLocked ? (
                        <FormNotice variant="warning" role="alert">
                            {`Callback is permanently locked for ${ticker}. Its settings can no longer be changed.`}
                        </FormNotice>
                    ) : callbackDistributed ? (
                        <FormNotice variant="warning" role="alert">
                            {`${ticker} already has holders${distribution?.holderCount ? ` (${distribution.holderCount.toLocaleString('en-US')})` : ''}, so its callback settings are frozen. They can only be set before any supply leaves your address.`}
                        </FormNotice>
                    ) : null}
                    <TokenField
                        label="Callback token"
                        help="The token every holder is paid in when the callback runs. Leave it empty to keep the current one."
                        value={callbackTick && chainId ? { chainId, tick: callbackTick } : null}
                        onOpenPicker={() => setCallbackTokenPickerOpen(true)}
                        disabled={callbackFieldsDisabled}
                    />
                    <Input
                        id="token-admin-callback-amount"
                        label="Payout per unit"
                        help={`When you run the callback, every holder hands back all of their ${ticker || 'token'} and receives this much of the callback token for each unit. It can only be set before any supply is distributed; leave it blank to keep the current value.`}
                        inputMode="decimal"
                        value={callbackAmount}
                        error={callbackAmountPrecisionError || undefined}
                        onChange={(e) => setCallbackAmount(e.target.value)}
                        onBlur={() => setCallbackAmount((v) => padCallbackAmount(v, callbackTokenDivisibility))}
                        autoComplete="off"
                        disabled={callbackFieldsDisabled}
                    />
                    <Input
                        id="token-admin-callback-block"
                        label="Callback allowed from block"
                        help="The earliest block height you can trigger the callback. Must be a future block. Leave it blank to keep the current value. The date shown is a rough estimate; real block times vary."
                        // Live text only under the field (U57): the estimate
                        // and the current block, never a loose note below.
                        hint={[
                            callbackBlockEstimate ? `Est. ${callbackBlockEstimate}.` : null,
                            currentHeight != null ? `Current block: ${String(currentHeight)}.` : null,
                        ].filter(Boolean).join(' ') || undefined}
                        inputMode="numeric"
                        value={callbackBlock}
                        onChange={(e) => setCallbackBlock(e.target.value)}
                        autoComplete="off"
                        disabled={callbackFieldsDisabled}
                    />
                    {callbackPartlySet ? (
                        <FieldNote variant="warning">
                            A working callback needs all three fields set.
                        </FieldNote>
                    ) : null}
                </>
            ) : null}

            {mode === 'access-lists' ? (
                // Allow list and Block list are list fields like Token above
                // them: the field opens the list picker (My lists, Recent, and
                // All with the published lists), and on a network that can
                // detach a list its clear action sets the field to none. An
                // empty field reads "None set" (G114).
                <>
                    <ListField
                        label="Allow list"
                        help={`Only members of this allow list may interact with the token. Pick one of your address lists or a published one. A field you do not change keeps its current binding.${listDetachActive ? ' Clearing the field detaches a bound list.' : ''}`}
                        placeholder="None set"
                        valueText={accessListFieldText(allowListIdx, sharedAllowListLabel || listLabel(allowListIdx, allowListName), allowListCount)}
                        onOpenPicker={() => setListPickerFor('allow')}
                        onClear={listDetachActive && allowListIdx && allowListIdx !== '0'
                            ? () => { setAllowListIdx('0'); setAllowListCount(null); setAllowListName(null); setSharedAllowListLabel(null); }
                            : undefined}
                        clearLabel="Remove allow-list"
                    />
                    <ListField
                        label="Block list"
                        help={`Members of this block list are denied interaction with the token. Pick one of your address lists or a published one, such as a shared block list. A field you do not change keeps its current binding.${listDetachActive ? ' Clearing the field detaches a bound list.' : ''}`}
                        placeholder="None set"
                        valueText={accessListFieldText(blockListIdx, sharedBlockListLabel || listLabel(blockListIdx, blockListName), blockListCount)}
                        onOpenPicker={() => setListPickerFor('block')}
                        onClear={listDetachActive && blockListIdx && blockListIdx !== '0'
                            ? () => { blockListTouched.current = true; setBlockListIdx('0'); setBlockListCount(null); setBlockListName(null); setSharedBlockListLabel(null); }
                            : undefined}
                        clearLabel="Remove block-list"
                    />
                </>
            ) : null}

            {mode === 'bridge-settings' ? (
                <>
                    {bridgeFrozen ? (
                        <FormNotice variant="status">
                            These settings are frozen for good: this token's bridge configuration was locked and can never change again.
                        </FormNotice>
                    ) : null}
                    {bridgePolicyBound ? (
                        <FormNotice variant="status">
                            {`${ticker || 'This token'} is bound to an address list, and a bridged copy `
                                + 'would carry none of that policy on the other network. It cannot be '
                                + 'opened to the bridge. Detach the policy list first.'}
                        </FormNotice>
                    ) : null}
                    {currentBridgeChains === null && assetInfo ? (
                        <p className={styles.hint}>
                            This venue does not report the token's current bridge setting, so
                            nothing below is pre-filled. Applying will set it to exactly what
                            you choose here.
                        </p>
                    ) : null}
                    {currentBridgeChains && reachableBridgeChains.length < currentBridgeChains.length ? (
                        <FormNotice variant="status">
                            {`The current setting names ${currentBridgeChains.filter((c) => !isReachableBridgeChain(c)).map((c) => `"${c}"`).join(', ')}, `
                                + 'a spelling the network does not accept, so it opens no network. '
                                + (bridgeFrozen
                                    ? 'The settings are frozen, so it cannot be corrected.'
                                    : 'Choose the networks you mean and apply to correct it.')}
                        </FormNotice>
                    ) : null}
                    {/* G117: one picker field that shows the chosen networks and
                        opens the networks page, so the form never grows with the
                        number of chains. It shows the reachable picks only, never
                        a stored spelling no network accepts. */}
                    <NetworksField
                        label="Destination networks"
                        help="Bridging lets holders lock this token here and receive a copy of it on another chain. It is off until you turn it on, and only you can. Holders can always bring a copy back, even after you close a chain again. Turning every network off closes the door to NEW transfers. It never touches copies already out there, and holders can still bring those back."
                        options={bridgeNetworkOptions}
                        selected={pickedBridgeChains}
                        placeholder="None set"
                        disabled={bridgeFrozen || bridgePolicyBound}
                        onOpenPicker={() => setBridgeNetworksPickerOpen(true)}
                    />
                    <Input
                        id="token-admin-bridge-depth"
                        label="Minimum confirmations"
                        optional
                        help="Blocks to wait before copying a locked transfer to the other network. Longer waits are safer but slower. Values below the platform default have no effect."
                        value={bridgeMinDepth}
                        onChange={(e) => setBridgeMinDepth(e.target.value)}
                        disabled={bridgeFrozen}
                        inputMode="numeric"
                    />
                    {/* G120: a plain toggle field with its static warning
                        right under it, on the page whether the switch is on or
                        off, so the owner reads what freezing means before
                        turning it on. Flipping the switch shows or hides no
                        notice anywhere on the form. */}
                    {!bridgeFrozen ? (
                        <>
                            <Switch
                                id="token-admin-bridge-freeze"
                                label="Freeze settings permanently"
                                help={t('routes.tokenAdmin.freezeHelp')}
                                checked={bridgeLock}
                                onChange={(e) => setBridgeLock(e.target.checked)}
                            />
                            <Notice tone="danger" role="note" flush data-bridge-freeze-warning="">
                                Freezing is one-way. Neither the destination networks nor the minimum confirmations can ever be changed again, by you or by a future owner. That is the assurance a holder has against both.
                            </Notice>
                        </>
                    ) : null}
                </>
            ) : null}

            {/* The fee selector lives in the Network fee section; the typed
                LOCK gate is last inside the mode's section. */}
            {/*
              * D-165: the typed confirmation for a LOCK, on the path a normal
              * wallet actually takes. It used to live only in the legacy
              * review stage below, which `singleEncode = !isWatcherMode`
              * renders for watcher wallets and nobody else - so that
              * confirm-page slice left the wallet's one irreversible action
              * (every flag here is a one-way switch) behind a checkbox and a
              * single click, while lesser and reversible actions kept their
              * typed gates. Rendered only for `singleEncode` so each path has
              * exactly one gate rather than two.
              */}
            {mode === 'lock' && singleEncode && !allLocksSet ? (
                <Input
                    id="token-admin-lock-confirm"
                    label="Type LOCK to confirm"
                    help={t('common.typedConfirmationHint', { word: 'LOCK' })}
                    value={typedConfirm}
                    onChange={(e) => setTypedConfirm(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
            </FormSection>
        </FormFrame>,
    );
}

/**
 * Compose ISSUE params for each admin mode. Each mode picks the
 * protocol ISSUE version that yields the cleanest decoded summary
 * (see action-decoder.smoke.js cases 2b–2d).
 *
 * - **lock**: ISSUE v3 (PC-02 lock matrix) with one LOCK_* field per
 *   flag the owner newly checked (`form.lockChecks`); a flag already
 *   set on the token is never re-sent. Decoded as "Lock TICK (max
 *   supply, minting…)" listing only the newly-checked flags, since
 *   collectLockFlags reads straight off the params sent.
 * - **description**: ISSUE v1 with only DESCRIPTION set, decoded as
 *   "Update description of TICK…".
 * - **transfer**: ISSUE v0 with only TRANSFER set, decoded as
 *   "Transfer ownership of TICK to ADDR…".
 * - **mint-settings**: ISSUE v2 with whichever of MAX_MINT / MINT_SUPPLY
 *   / TRANSFER_SUPPLY / MINT_ADDRESS_MAX / MINT_START_BLOCK /
 *   MINT_STOP_BLOCK the owner filled in; a blank field is omitted
 *   entirely rather than sent as an empty string, since the indexer
 *   treats an omitted v2 field as "leave unchanged" (issue.js `isNull`
 *   guards on every one of these), never as "clear to zero". Decoded
 *   as "Update mint parameters of TICK…".
 */
function composeAdminParams(mode, form) {
    const TICK = (form.ticker || '').trim();
    if (mode === 'lock') {
        const p = { VERSION: '3', TICK };
        const checks = form.lockChecks || {};
        for (const f of LOCK_FLAGS) {
            if (checks[f.key] && !form.currentLocks?.[f.key]) p[f.field] = '1';
        }
        return p;
    }
    if (mode === 'description') {
        return {
            VERSION: '1',
            TICK,
            DESCRIPTION: (form.description || '').trim(),
        };
    }
    if (mode === 'mint-settings') {
        const p = { VERSION: '2', TICK };
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        if (form.mintSupply) p.MINT_SUPPLY = String(form.mintSupply).trim();
        if (form.transferSupply) p.TRANSFER_SUPPLY = form.transferSupply.trim();
        if (form.mintAddressMax) p.MINT_ADDRESS_MAX = String(form.mintAddressMax).trim();
        if (form.mintStartBlock) p.MINT_START_BLOCK = String(form.mintStartBlock).trim();
        if (form.mintStopBlock) p.MINT_STOP_BLOCK = String(form.mintStopBlock).trim();
        return p;
    }
    if (mode === 'callback-settings') {
        // ISSUE v4 (PC-03): only the callback fields the owner filled in.
        // Blank is OMITTED, never sent as empty: the indexer treats an
        // omitted v4 field as "leave unchanged" (issue.js populates it
        // from the current record), never "clear to zero".
        const p = { VERSION: '4', TICK };
        if (form.callbackBlock) p.CALLBACK_BLOCK = String(form.callbackBlock).trim();
        if (form.callbackTick) p.CALLBACK_TICK = String(form.callbackTick).trim();
        if (form.callbackAmount) p.CALLBACK_AMOUNT = String(form.callbackAmount).trim();
        return p;
    }
    if (mode === 'access-lists') {
        // ISSUE v5 (PC-04): emit only the access list(s) that CHANGED from
        // the token's current binding. An omitted field is "leave
        // unchanged" (issue.js isNull), so re-sending an unchanged index
        // is a harmless no-op we skip to keep the decoded summary clean.
        // The 0 sentinel detaches a policy list after activation; blank still
        // means keep the current binding.
        const p = { VERSION: '5', TICK };
        if (form.allowListIdx && form.allowListIdx !== form.currentAllowList) p.ALLOW_LIST = String(form.allowListIdx).trim();
        if (form.blockListIdx && form.blockListIdx !== form.currentBlockList) p.BLOCK_LIST = String(form.blockListIdx).trim();
        return p;
    }
    if (mode === 'bridge-settings') {
        // ISSUE v7 (token-bridge section 7). An EMPTY field means UNCHANGED
        // here, not cleared: issue.js back-fills every empty field from the
        // current row, which is why closing a token to the bridge takes the '-'
        // sentinel and never an empty string. Getting that backwards would leave
        // an issuer believing they had shut the door.
        const p = { VERSION: '7', TICK };
        const picks = form.bridgeChains || [];
        const current = form.currentBridgeChains;
        const nextList = picks.length > 0 ? picks.join(',') : '-';
        if (current === null || nextList !== (current.length > 0 ? current.join(',') : '-')) {
            p.BRIDGE_CHAINS = nextList;
        }
        const depth = String(form.bridgeMinDepth ?? '').trim();
        if (depth !== '' && depth !== String(form.currentMinDepth ?? '')) p.MIN_DEPTH = depth;
        if (form.bridgeLock) p.LOCK_BRIDGE = '1';
        return p;
    }
    // mode === 'transfer'
    return {
        VERSION: '0',
        TICK,
        TRANSFER: (form.transferTo || '').trim(),
    };
}

/** The Network field's help tip, written for what the chain means in each mode. */
const MODE_NETWORK_HELP = {
    lock: "The chain the token lives on. Locks are recorded on this network and your From address pays the fee here.",
    description: "The chain the token lives on. The new description is recorded on this network.",
    transfer: "The chain the token lives on. Ownership moves to a new address on this same network.",
    'mint-settings': "The chain the token lives on. The new mint settings are recorded on this network.",
    'callback-settings': "The chain the token lives on. The callback is configured on this network.",
    'access-lists': "The chain the token lives on. The lists restrict who can use it on this network.",
    'bridge-settings': "The chain the token lives on. Its destination networks are the other chains a copy can be bridged to.",
};

/** The Token field's help tip, written for what the token is in each mode. */
const MODE_TOKEN_HELP = {
    lock: "The token you are locking. Only the flags you tick below are locked, and a lock can never be undone.",
    description: "The token whose description you are replacing. Your From address must be its owner.",
    transfer: "The token whose ownership you are handing over. Your From address must be its owner.",
    'mint-settings': "The token whose mint settings you are changing. Your From address must be its owner.",
    'callback-settings': "The token whose callback you are configuring. Your From address must be its owner.",
    'access-lists': "The token you are restricting with an allow-list or a block-list. Your From address must be its owner.",
    'bridge-settings': "The token whose bridging you are opening or closing. Your From address must be its owner.",
};

const MODE_LABEL = {
    lock: 'Lock token',
    description: 'Update description',
    transfer: 'Transfer ownership',
    'mint-settings': 'Mint settings',
    'callback-settings': 'Callback settings',
    'access-lists': 'Access lists',
    'bridge-settings': 'Bridge settings',
};

// The title of each mode's main standard section. It
// names the mode without repeating the action button's own label.
const MODE_SECTION_TITLE = {
    lock: 'Locks',
    description: 'Description',
    transfer: 'New Owner',
    'mint-settings': 'Mint Settings',
    'callback-settings': 'Callback Settings',
    'access-lists': 'Access Lists',
    'bridge-settings': 'Bridge Settings',
};

// The icon of each mode's main section and action button.
const MODE_ACTION_ICON = {
    lock: Icon.LockIcon,
    description: Icon.PencilIcon,
    transfer: Icon.UserIcon,
    'mint-settings': Icon.MintIcon,
    'callback-settings': Icon.CoinsIcon,
    'access-lists': Icon.TokenListIcon,
    'bridge-settings': Icon.LinkIcon,
};

const MODE_SUBMIT_LABEL = {
    lock: 'Lock token',
    description: 'Update description',
    transfer: 'Transfer ownership',
    'mint-settings': 'Update mint settings',
    'callback-settings': 'Update callback settings',
    'access-lists': 'Update access lists',
    'bridge-settings': 'Update bridge settings',
};

const MODE_LABEL_LOWER = {
    lock: 'lock',
    description: 'description update',
    transfer: 'ownership transfer',
    'mint-settings': 'mint settings update',
    'callback-settings': 'callback settings update',
    'access-lists': 'access lists update',
    'bridge-settings': 'bridge settings update',
};

const MODE_DONE_TITLE = {
    lock: 'Locked',
    description: 'Description updated',
    transfer: 'Ownership transferred',
    'mint-settings': 'Mint settings updated',
    'callback-settings': 'Callback settings updated',
    'access-lists': 'Access lists updated',
    'bridge-settings': 'Bridge settings updated',
};

/** The From field's help tip, written for what the owner's address does in each mode. */
const MODE_FROM_HELP = {
    lock: "The token owner's address. It signs this lock and pays the network fee.",
    description: "The token owner's address. It signs the new description and pays the network fee.",
    transfer: "The token's current owner. It signs the hand-over and pays the network fee.",
    'mint-settings': "The token owner's address. It signs the new mint settings and pays the network fee.",
    'callback-settings': "The token owner's address. It signs the callback settings and pays the network fee.",
    'access-lists': "The token owner's address. It signs the access-list change and pays the network fee.",
    'bridge-settings': "The token owner's address. It signs the bridge settings and pays the network fee.",
};

/**
 * Re-formats Payout per unit to the callback token's decimal places: "1"
 * reads "1.00000000" at 8, and "1.00000000" reads "1" again at 0, because
 * only the padding zeros are dropped before padding to the new places. Any
 * significant digit stays, so a value finer than the token allows keeps its
 * digits and its field error. A blank or malformed value, or an unknown
 * precision, comes back unchanged.
 *
 * @param {string} value
 * @param {number | null} places
 * @returns {string}
 */
function padCallbackAmount(value, places) {
    const text = String(value ?? '').trim();
    if (places == null || !/^\d+(?:\.\d*)?$/.test(text)) return value;
    const bare = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
    const dot = bare.indexOf('.');
    const have = dot === -1 ? 0 : bare.length - dot - 1;
    if (have >= places) return bare;
    return `${bare}${dot === -1 ? '.' : ''}${'0'.repeat(places - have)}`;
}
