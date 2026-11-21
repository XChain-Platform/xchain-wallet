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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Network, From and the fee selector come from the standard FromSection and
// FeeSection (formStandard, below).
// The list type is the wallet's own themed dropdown (IconSelect), an icon per
// type, never a native select.
import { AddressField, AddressText, Button, Checkbox, EmptyState, FieldNote, FormNotice, FormPage, Icon, IconSelect, InfoTip, Input, ListPage, ListRow, PageHeader, Screen, SegmentedControl, StatusMessage, Textarea, useFormErrors } from '@xchain-wallet/core/ui';
import { registry as registryLib, decoder as decoderLib, airdrop as airdropLib } from '@xchain-wallet/core';
import { ContactsPickerScreen } from '../components/ContactsPickerScreen.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { ContactAvatar } from '../components/WalletIdentity.jsx';
import contactsStyles from './ContactsList.module.css';
import { extractActionIndex } from '../utils/actionIndexFromTx.js';
import { listLabel } from '../utils/listLabel.js';
import { listShareEligibility } from '../../flows/listShareEligibility.js';
import { explorerReadFailure } from '../../sdk/explorerErrors.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { groupDecodedAmounts } from '../utils/amountFormat.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen, ActionWarningsCard } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { FileField } from '../components/FileField.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { DiagnosticDetails } from '../components/DiagnosticDetails.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { useFeeScheduleState } from '../hooks/useFeeSchedule.js';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { useSettings } from '../hooks/useSettings.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
import {
    listSharedEditFeeFromSchedule,
    listShareFeeFromSchedule,
    shareFeeRowText,
} from '../../flows/listFeeSchedule.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { TokenPicker } from './TokenPicker.jsx';
import { TickItemsEditor } from '../components/TickItemsEditor.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/confirmStandard.js';
import '../../i18n/locales/en/routes.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { classifyTickItems } from '../utils/listTickItems.js';
import { qualifyTickItem } from '../utils/listTickCoin.js';
import { ADDRESS_REFERENCE_ITEM_MESSAGE, addressReferenceNote } from '../utils/addressReferenceCopy.js';
import { listTickCoinSupport } from '../../flows/listTickCoinSupport.js';
import { listFormatSupport, listMetaSupported } from '../../flows/listFormatSupport.js';
import { currentListItems, currentListMemberCount, findListOwner, recheckListOwner } from '../../flows/listMembership.js';
import { unionPickState } from '../../flows/unionListPicks.js';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import '../../i18n/locales/en/ui.js';
import {
    LIST_META_DESCRIPTION_MAX_BYTES,
    LIST_META_NAME_MAX_BYTES,
    listMetaInputError,
    utf8ByteLength,
} from '../../flows/listMetaInput.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { listActionSize, listActionSizeError } from '../utils/listActionSize.js';
import {
    listActionCheckFailedMessage,
    listActionUnavailableMessage,
} from '../utils/listActionAvailability.js';
import { formatBytes, reachedEightyPercent } from '../utils/formatBytes.js';
// The form sits in the Wallet Form Standard frame: From, the List section,
// optional Details and Memo sections, the Network fee row, the status slot
// and the action.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    MemoSection,
    SummaryAddress,
    joinSummaryParts,
    useFormSections,
} from '../components/formStandard/index.js';

const chainRegistry = registryLib.defaultRegistry();
const TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const NO_ACKNOWLEDGMENTS = new Set();

const META_ERROR_TEXT = {
    pipe: 'Cannot contain the | character.',
    semicolon: 'Cannot contain the ; character.',
    unsafe: 'Cannot contain control, text-direction, or zero-width characters.',
    length: 'Too long.',
    format: 'A single - is not allowed.',
};

function metaFieldError(field, value) {
    const code = listMetaInputError(field, value, { isCreate: true });
    return code ? META_ERROR_TEXT[code] : null;
}

/**
 * What each action of the one List form is. The host holds the action, the
 * list it acts on and the fields every body shares (network, From, memo);
 * this table decides which body an action opens and the words, compose
 * version, guards and result each one uses.
 *
 * - `body`: 'create' (the address, token or union list), 'members' (LIST v1
 *   edit of the members, with the VERSION 5 name and description in Edit),
 *   'share' (LIST v2) or 'transfer' (LIST v3).
 * - `listRef`: the action needs an existing list; without one it shows in
 *   the Action field but cannot be picked.
 * - `version`: the LIST format the action composes (Create picks 0 or 4,
 *   or 0 TYPE 3 for a union; Edit composes 1 for members and 5 for the name
 *   and description, never both in one transaction).
 * - The confirm page's verb key is a literal t() call in each body, so the
 *   translation key scan can follow it.
 * - `sdkReason`: shown when the wallet's SDK cannot build the format, and
 *   `sdkCheckFailedReason` when the support check itself failed.
 * - `failText`: the fallback when a submit fails without a message.
 * - `resultWhat`: the noun the queued result screen names.
 */
const LIST_ACTIONS = {
    create: {
        label: 'Create',
        icon: Icon.PlusIcon,
        help: 'Create a new address, token or union list.',
        body: 'create',
        listRef: false,
        version: '0',
        title: 'Create List',
        formLabel: 'Create list',
        actionLabel: 'Publish List',
        failText: 'Create list failed.',
    },
    edit: {
        label: 'Edit',
        icon: Icon.PencilIcon,
        help: "Change the list's members, or its name and description. Each is its own transaction.",
        body: 'members',
        listRef: true,
        version: '1',
        metaVersion: '5',
        title: 'Edit List',
        formLabel: 'Edit list',
        actionLabel: 'Publish Edit',
        sdkReason: listActionUnavailableMessage('rename'),
        sdkCheckFailedReason: listActionCheckFailedMessage('rename'),
        failText: 'List fork broadcast failed.',
        metaFailText: 'List rename failed.',
        resultWhat: 'list fork',
        metaResultWhat: 'list rename',
    },
    share: {
        label: 'Share',
        icon: Icon.UsersIcon,
        help: 'Share the list with every chain.',
        body: 'share',
        listRef: true,
        version: '2',
        title: 'Share List',
        formLabel: 'Share list',
        actionLabel: 'Share List',
        sdkReason: listActionUnavailableMessage('share'),
        sdkCheckFailedReason: listActionCheckFailedMessage('share'),
        failText: 'List share failed.',
        resultWhat: 'list share',
    },
    transfer: {
        label: 'Transfer',
        icon: Icon.HandshakeIcon,
        help: "Hand the list's ownership to another address.",
        body: 'transfer',
        listRef: true,
        version: '3',
        title: 'Transfer List',
        formLabel: 'Transfer list',
        actionLabel: 'Transfer List',
        sdkReason: listActionUnavailableMessage('transfer'),
        sdkCheckFailedReason: listActionCheckFailedMessage('transfer'),
        failText: 'List transfer failed.',
        resultWhat: 'list transfer',
    },
    fork: {
        label: 'Fork',
        icon: Icon.ForkIcon,
        help: 'Publish an edit of the members at a new list index.',
        body: 'members',
        listRef: true,
        version: '1',
        title: 'Fork List',
        formLabel: 'Fork list',
        actionLabel: 'Publish Fork',
        failText: 'List fork broadcast failed.',
        resultWhat: 'list fork',
    },
};

const LIST_ACTION_ORDER = ['create', 'edit', 'share', 'transfer', 'fork'];
const NO_LIST_HELP = 'Open a list from My Lists to edit, share, transfer or fork it.';

/** The route names a rename; renaming is part of Edit now. */
function normalizeListAction(value) {
    if (value === 'rename') return 'edit';
    return Object.prototype.hasOwnProperty.call(LIST_ACTIONS, value) ? value : 'create';
}

function hasUsableListRef(listRef) {
    return Boolean(listRef && listRef.chainId && listRef.actionIndex != null && String(listRef.actionIndex) !== '');
}

/**
 * The one List form ("we're gonna have one form with shared options"): an
 * Action field picks Create, Edit, Share, Transfer or Fork, and every list
 * action button in the wallet opens it with its action already picked.
 *
 * Create is the LIST v0 create form. One transaction, so (unlike
 * AirdropForm/ProjectRosterForm's two-sign LIST+AIRDROP/LINK flows)
 * this is fully HW- and watcher-mode-compatible: it's just a LIST,
 * signed once. Three list types, chosen in the List type dropdown under the
 * Action field:
 *   TYPE=2 (ADDRESS) - paste/upload addresses, or add from Contacts.
 *   TYPE=1 (TICK)    - type or upload ticks, or add from the token picker.
 *   TYPE=3 (UNION)   - a one-level union of other lists (UnionListBody).
 *
 * Edit, Share, Transfer and Fork act on an existing list (`listRef`).
 *
 * The host keeps the action, the type and the fields every body shares
 * (network, From, memo); each body keeps its own compose lane, so every
 * action builds exactly the transaction it always did.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]
 * @param {string} [props.activeAccountId]   the union body reads this account's addresses
 * @param {'create' | 'edit' | 'share' | 'transfer' | 'fork' | 'rename'} [props.action]   the action the form opens on
 * @param {'create' | 'edit' | 'share' | 'transfer' | 'fork' | 'rename'} [props.initialAction]   same as action
 * @param {{ chainId: string, actionIndex: string | number, type?: string, items?: string[], editResolutionActive?: boolean | null, source?: string | null, parentIndex?: string | number | null, state?: { owner?: string | null } } | null} [props.listRef]   the list Edit, Share, Transfer and Fork act on
 * @param {'1' | '2' | '3'} [props.initialType]   defaults to '2' (address list); '3' opens on Union
 * @param {boolean | null} [props.editResolutionActive]   list-edit resolution on this chain; unknown when omitted
 * @param {Partial<Record<'issue-lists' | 'dispenser-lists' | 'order-lists', () => void>>} [props.repointHandlers]   a fork's "now referenced by" step
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]   where a submitted union or list action lands; defaults to onBack
 */
export function ListCreateForm({
    walletId,
    chainId,
    activeAccountId,
    action: openedAction,
    initialAction,
    listRef = null,
    initialType,
    editResolutionActive = null,
    repointHandlers,
    onBack,
    onDone = onBack,
}) {
    const listRefReady = hasUsableListRef(listRef);
    const [action, setAction] = useState(() => {
        const opened = normalizeListAction(openedAction ?? initialAction);
        return LIST_ACTIONS[opened].listRef && !listRefReady ? 'create' : opened;
    });
    const [listType, setListType] = useState(
        /** @type {'1' | '2' | '3'} */ (initialType === '1' || initialType === '3' ? initialType : '2'),
    );
    // Network, From and memo survive a switch between bodies. They reset when
    // the wallet, account, requested network or list changes, so a new
    // context never inherits the old one's picks.
    const listKey = listRefReady ? `${listRef.chainId}:${String(listRef.actionIndex)}` : '';
    const context = `${walletId}:${chainId || ''}:${activeAccountId || ''}:${listKey}`;
    const sharedRef = useRef({ context, values: /** @type {SharedListFields} */ ({}) });
    if (sharedRef.current.context !== context) sharedRef.current = { context, values: {} };
    const onSharedChange = useCallback((values) => {
        if (sharedRef.current.context === context) sharedRef.current.values = values;
    }, [context]);
    // A switch that swaps bodies remounts the form; the field that made the
    // switch takes focus back once, after the new body has loaded.
    const [focusField, setFocusField] = useState(/** @type {'action' | 'type' | null} */ (null));
    const changeAction = useCallback((next) => {
        if (!Object.prototype.hasOwnProperty.call(LIST_ACTIONS, next) || next === action) return;
        if (LIST_ACTIONS[next].listRef && !listRefReady) return;
        setFocusField('action');
        setAction(next);
    }, [action, listRefReady]);
    const changeType = useCallback((next) => {
        if (next !== '1' && next !== '2' && next !== '3') return;
        if ((listType === '3') !== (next === '3')) setFocusField('type');
        setListType(next);
    }, [listType]);
    // Cleared once taken, so a later picker or review return never steals focus.
    const onFieldFocused = useCallback(() => setFocusField(null), []);
    const actionOptions = useMemo(() => LIST_ACTION_ORDER.map((id) => {
        const ActionIcon = LIST_ACTIONS[id].icon;
        return {
            value: id,
            label: LIST_ACTIONS[id].label,
            icon: <ActionIcon />,
            disabled: LIST_ACTIONS[id].listRef && !listRefReady,
        };
    }), [listRefReady]);
    // A form opened by an action's own button has that action fixed by how
    // the user arrived (the page title names it), so it shows no Action
    // dropdown; only a form opened with no action keeps the dropdown.
    const requestedAction = openedAction ?? initialAction;
    const actionLocked = requestedAction != null && normalizeListAction(requestedAction) === action;
    const actionField = actionLocked ? null : (
        <ListActionField
            value={action}
            options={actionOptions}
            help={listRefReady ? LIST_ACTIONS[action].help : `${LIST_ACTIONS[action].help} ${NO_LIST_HELP}`}
            onChange={changeAction}
            autoFocus={focusField === 'action'}
            onFocused={onFieldFocused}
        />
    );
    const cfg = LIST_ACTIONS[action];
    const shared = sharedRef.current.values;

    if (cfg.body === 'members') {
        return (
            <ListMembersBody
                key={`${action}:${context}`}
                mode={action}
                cfg={cfg}
                walletId={walletId}
                listRef={listRef}
                actionField={actionField}
                shared={shared}
                onSharedChange={onSharedChange}
                repointHandlers={repointHandlers}
                onBack={onBack}
                onDone={onDone}
            />
        );
    }
    if (cfg.body === 'share') {
        return (
            <ListShareBody
                key={`${action}:${context}`}
                cfg={cfg}
                walletId={walletId}
                listRef={listRef}
                actionField={actionField}
                shared={shared}
                onSharedChange={onSharedChange}
                onBack={onBack}
                onDone={onDone}
            />
        );
    }
    if (cfg.body === 'transfer') {
        return (
            <ListTransferBody
                key={`${action}:${context}`}
                cfg={cfg}
                walletId={walletId}
                listRef={listRef}
                actionField={actionField}
                shared={shared}
                onSharedChange={onSharedChange}
                onBack={onBack}
                onDone={onDone}
            />
        );
    }

    // Create opened from a list action starts on that list's network.
    const createChainId = chainId || (listRefReady ? listRef.chainId : undefined);
    const typeProps = {
        listType,
        onListTypeChange: changeType,
        shared,
        onSharedChange,
        focusTypeOnMount: focusField === 'type',
        onTypeFocused: onFieldFocused,
        actionField,
    };
    if (listType === '3') {
        return (
            <UnionListBody
                key={`create:${context}`}
                walletId={walletId}
                chainId={createChainId}
                activeAccountId={activeAccountId}
                onBack={onBack}
                onDone={onDone}
                {...typeProps}
            />
        );
    }
    return (
        <StandardListBody
            key="create"
            walletId={walletId}
            chainId={createChainId}
            editResolutionActive={editResolutionActive}
            onBack={onBack}
            {...typeProps}
        />
    );
}

/** The one List form under its plain name; routes and guards still read ListCreateForm. */
export const ListForm = ListCreateForm;

/**
 * @typedef {{ chainId?: string | null, fromAddressId?: string | null, memo?: string }} SharedListFields
 */

/**
 * The Action field, first in every body's main section: the wallet's own
 * themed dropdown (IconSelect), an icon per action, never a native select.
 * It takes focus once after a switch has swapped bodies.
 *
 * @param {{ value: string, options: any[], help: string, onChange: (value: string) => void, autoFocus?: boolean, onFocused?: () => void }} props
 */
function ListActionField({ value, options, help, onChange, autoFocus = false, onFocused }) {
    const wrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!autoFocus) return;
        wrapRef.current?.querySelector('button[aria-haspopup="listbox"]')?.focus();
        onFocused?.();
        // Mount only: the field takes focus once after a body swap.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div ref={wrapRef} data-list-action-field>
            <IconSelect
                label="Action"
                help={help}
                value={value}
                onChange={onChange}
                options={options}
            />
        </div>
    );
}

const LIST_TYPE_HELP = {
    2: 'A reusable list of addresses. Used by airdrops, allow/block gates, dispensers, and orders.',
    1: 'A reusable list of tokens. Used for project rosters and allow/block gates.',
    3: 'A list built from up to 16 of your other lists of one type; its members are theirs. Used wherever an address or token list is.',
};

const LIST_TYPE_OPTIONS = [
    { value: '2', label: 'Addresses', icon: <Icon.AddressIcon /> },
    { value: '1', label: 'Tokens', icon: <Icon.TokenIcon /> },
    { value: '3', label: 'Union', icon: <Icon.LinkIcon /> },
];

/**
 * The List type field, first in the List section: Addresses, Tokens or
 * Union, an icon per type. Never disabled, so a union the SDK cannot build
 * can still switch back to an address or token list.
 *
 * @param {{ value: '1' | '2' | '3', onChange: (value: string) => void, autoFocus?: boolean, onFocused?: () => void }} props
 */
function ListTypeField({ value, onChange, autoFocus = false, onFocused }) {
    const wrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!autoFocus) return;
        wrapRef.current?.querySelector('button[aria-haspopup="listbox"]')?.focus();
        onFocused?.();
        // Mount only: the field takes focus once after a body swap.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div ref={wrapRef} data-list-type-field>
            <IconSelect
                label="List type"
                help={LIST_TYPE_HELP[value]}
                value={value}
                onChange={onChange}
                options={LIST_TYPE_OPTIONS}
            />
        </div>
    );
}

/**
 * The address and token list body: LIST v0 (or v4 with a name or
 * description). Stage machine mirrors CreatePollForm: 'form' -> 'review' ->
 * 'submitting' -> 'done', with the single-encode confirm page substituting
 * for 'review' when the source isn't HW/watcher.
 */
function StandardListBody({
    walletId,
    chainId: initialChainId,
    listType,
    onListTypeChange,
    shared,
    onSharedChange,
    focusTypeOnMount,
    onTypeFocused,
    actionField = null,
    editResolutionActive,
    onBack,
}) {
    const [chainId, setChainId] = useState(shared?.chainId || initialChainId || null);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
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
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (shared?.fromAddressId || null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [contactPickerOpen, setContactPickerOpen] = useState(false);

    // TYPE=2 (address list) member entry: same paste/CSV parsing as
    // AirdropForm, reused verbatim so behaviour (dedupe, invalid-address
    // detection, drag-and-drop) matches exactly.
    const [pasteText, setPasteText] = useState('');
    const [recipients, setRecipients] = useState(
        /** @type {{ valid: string[], invalid: string[], duplicates: number, wrongNetwork: string[], addressRefs: string[] }} */
        ({ valid: [], invalid: [], duplicates: 0, wrongNetwork: [], addressRefs: [] }),
    );
    const [showInvalid, setShowInvalid] = useState(false);
    // TYPE=1 (token list) member entry: same free-text tick parsing as
    // ProjectRosterForm.
    const [ticksText, setTicksText] = useState('');
    // Per-tick existence verdicts from the token lookup, keyed by tick.
    const [tickStatus, setTickStatus] = useState(
        /** @type {Record<string, 'found' | 'missing' | null>} */ ({}),
    );
    const [tickCoinSupported, setTickCoinSupported] = useState(false);
    const [anyCoins, setAnyCoins] = useState(/** @type {string[]} */ ([]));
    const [memo, setMemo] = useState(shared?.memo || '');
    const [metaSupported, setMetaSupported] = useState(false);
    const [listName, setListName] = useState('');
    const [listDescription, setListDescription] = useState('');

    const [password, setPassword] = useState('');
    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    // The standard sections' open state, held above the picker and
    // review early returns so it survives them; a counter of Publish attempts
    // reopens the section that holds the error on every attempt.
    const formSections = useFormSections({ from: false, list: true, details: false, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [feeStopped, setFeeStopped] = useState(false);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);

    // Hand the shared fields to the host so a switch to Union keeps them.
    useEffect(() => {
        onSharedChange({ chainId, fromAddressId, memo });
    }, [chainId, fromAddressId, memo, onSharedChange]);

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
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                // Open on the last-used chain, behind a caller-seeded one and
                // ahead of the first-key fallback: `byChain` is in address-
                // creation order, so its first key is the wallet's OLDEST chain.
                const picked = pickDefaultChainId(byChain, { explicitChainId: chainId, settings });
                if (!chainId && picked) setChainId(picked);
                if (Object.keys(byChain || {}).length === 0) setLoadError('No addresses on any network yet. Use Receive to generate one first.');
            })
            .catch((err) => { if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.')); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walletId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    // An ADDRESS list is only useful on the chain it is published to -
    // the indexer rejects items that are not addresses for that coin+network
    // (into `list_items_invalid`) while still storing the list. Validate here so
    // the count the form shows is the count the chain will keep.
    const recipientCoin = descriptor?.coin || null;
    const recipientNetwork = descriptor?.networkKind || null;

    useEffect(() => {
        let cancelled = false;
        setTickCoinSupported(false);
        if (!chainId) return () => { cancelled = true; };
        const sdkRegistry = {
            get: () => ({
                isListTickCoinActive: () => (typeof messaging.isListTickCoinActive === 'function'
                    ? messaging.isListTickCoinActive({ chainId })
                    : false),
            }),
        };
        listTickCoinSupport({ sdkRegistry, chainId })
            .then((supported) => { if (!cancelled) setTickCoinSupported(supported); })
            .catch(() => { if (!cancelled) setTickCoinSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    // Once token-policy inheritance is active the indexer takes an address item
    // for any configured coin on this network; the explorer's flag says when, so
    // the form never offers an item the chain would drop into list_items_invalid.
    useEffect(() => {
        let cancelled = false;
        setAnyCoins([]);
        if (!chainId || !recipientCoin || !recipientNetwork) return () => { cancelled = true; };
        Promise.resolve()
            .then(() => (typeof messaging.listAnyCoinItems === 'function'
                ? messaging.listAnyCoinItems({ chainId, coin: recipientCoin, networkKind: recipientNetwork })
                : []))
            .then((coins) => { if (!cancelled) setAnyCoins(Array.isArray(coins) ? coins : []); })
            .catch(() => { if (!cancelled) setAnyCoins([]); });
        return () => { cancelled = true; };
    }, [chainId, recipientCoin, recipientNetwork, messaging]);

    useEffect(() => {
        let cancelled = false;
        setMetaSupported(false);
        if (!chainId) return () => { cancelled = true; };
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listMetaSupported({ sdkRegistry, chainId }))
            .then((supported) => { if (!cancelled) setMetaSupported(supported === true); })
            .catch(() => { if (!cancelled) setMetaSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    useEffect(() => {
        if (listType !== '2') return;
        const parts = airdropLib.parsePaste(pasteText);
        setRecipients(airdropLib.classifyRecipients(
            parts,
            { coin: recipientCoin, network: recipientNetwork },
            { anyCoins },
        ));
    }, [pasteText, listType, recipientCoin, recipientNetwork, anyCoins]);

    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Same default as Send and every other spend-from-balance form: the
    // chain's active address, else the newest HD external, else the first
    // remaining record (a hardware-only wallet). A dispenser-delegated
    // address is never the default; it vends rather than funds.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        const funding = all.filter((a) => a.role !== 'dispenser');
        const picked = preferredSourceId(funding, activeByChain[chainId]) || funding[0]?.id || all[0]?.id;
        if (picked) setFromAddressId(picked);
    }, [chainId, addressesByChain, activeByChain, fromAddressId]);

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();
    const coinTicker = descriptor ? { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (LIST is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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

    // Parse tickers with chain grammar while counting duplicates
    // and malformed names the way the address branch does.
    const tickItems = useMemo(
        () => classifyTickItems(ticksText, { coinQualified: tickCoinSupported }),
        [ticksText, tickCoinSupported],
    );
    const memberTicks = tickItems.valid;
    const invalidTicks = tickItems.invalid;

    const missingTicks = useMemo(
        () => memberTicks.filter((t) => tickStatus[t] === 'missing'),
        [memberTicks, tickStatus],
    );

    const items = listType === '2' ? recipients.valid : memberTicks;
    const trimmedMemo = memo.trim();

    // MEMO is optional and sits before the ITEM tail; an empty memo leaves
    // the field out so the wire keeps its empty slot (`LIST|0|1||...`).
    const trimmedName = listName.trim();
    const trimmedDescription = listDescription.trim();
    const nameError = metaSupported ? metaFieldError('name', trimmedName) : null;
    const descriptionError = metaSupported ? metaFieldError('description', trimmedDescription) : null;
    const withMeta = metaSupported && (trimmedName !== '' || trimmedDescription !== '');
    const wireParams = useMemo(() => (withMeta ? {
        VERSION: '4',
        TYPE: listType,
        NAME: trimmedName,
        DESCRIPTION: trimmedDescription,
        ...(trimmedMemo ? { MEMO: trimmedMemo } : {}),
        ITEM: items,
    } : {
        VERSION: '0',
        TYPE: listType,
        ...(trimmedMemo ? { MEMO: trimmedMemo } : {}),
        ITEM: items,
    }), [withMeta, listType, items, trimmedMemo, trimmedName, trimmedDescription]);
    const actionSize = useMemo(
        () => listActionSize(wireParams),
        [wireParams],
    );
    // A new list is quoted once it holds an item; the venue answers free for
    // an unshared create, so the card's Total is the network fee alone.
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionString: items.length > 0 ? actionSize.actionString : null,
        enabled: true,
    });

    // A CSV or TXT file, picked or dropped, adds its addresses under any
    // already in the box. The file field names it only while the box still
    // holds exactly what the file left there.
    const [recipientsFile, setRecipientsFile] = useState(
        /** @type {{ name: string, before: string, after: string } | null} */ (null),
    );
    const recipientsFileName = recipientsFile && recipientsFile.after === pasteText ? recipientsFile.name : '';
    const recipientsDrop = useDropZone({
        accept: ['.csv', '.txt', 'text/csv', 'text/plain'],
        readAs: 'text',
        onError: (msg) => setFormError(msg),
        onFile: ({ file, content }) => {
            const text = typeof content === 'string' ? content : '';
            const joined = airdropLib.parseCsv(text).join('\n');
            const next = pasteText.trim() ? `${pasteText}\n${joined}` : joined;
            setPasteText(next);
            setRecipientsFile({ name: file?.name || 'Addresses file', before: pasteText, after: next });
            setFormError(null);
        },
    });

    // Removing the file takes back only the addresses it added; the box was
    // not edited since, or the file name would no longer show.
    function clearRecipientsFile() {
        if (recipientsFile && recipientsFile.after === pasteText) setPasteText(recipientsFile.before);
        setRecipientsFile(null);
    }

    // A token list takes a CSV or TXT of tickers the same way: the file's text
    // goes under any already in the Tokens box, where the typed-entry parser
    // (commas or new lines, chain ticker grammar) checks it like typed input.
    const [ticksFile, setTicksFile] = useState(
        /** @type {{ name: string, before: string, after: string } | null} */ (null),
    );
    const ticksFileName = ticksFile && ticksFile.after === ticksText ? ticksFile.name : '';
    const ticksDrop = useDropZone({
        accept: ['.csv', '.txt', 'text/csv', 'text/plain'],
        readAs: 'text',
        onError: (msg) => setFormError(msg),
        onFile: ({ file, content }) => {
            const text = (typeof content === 'string' ? content : '').replace(/^﻿/, '').trim();
            const next = ticksText.trim() ? `${ticksText}\n${text}` : text;
            setTicksText(next);
            setTicksFile({ name: file?.name || 'Tickers file', before: ticksText, after: next });
            setFormError(null);
        },
    });

    function clearTicksFile() {
        if (ticksFile && ticksFile.after === ticksText) setTicksText(ticksFile.before);
        setTicksFile(null);
    }

    // Software sources go through the single-encode confirm
    // page; hardware + watcher keep the legacy review stage (same split
    // as CreatePollForm / AirdropForm).
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'createList',
        hardware: 'createListHw',
    });

    const decoded = useMemo(() => {
        // residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only - the watcher, demo and locked-ECDH path. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review') return null;
        return groupDecodedAmounts(decoderLib.decodeAction({ action: 'LIST', params: wireParams, chainId: chainId || undefined, chainRegistry }));
    }, [stage, actionConfirm.open, wireParams, chainId]);
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyComposed = useMemo(() => (decoded ? {
        action: 'LIST',
        chainId,
        decoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    } : null), [chainId, decoded, protocolFeeQuote, quotedProtocolFee.free, quotedProtocolFee.known]);

    async function openConfirmScreen() {
        if (submitInFlightRef.current) return;
        submitInFlightRef.current = true;
        setSubmitError(null);
        try {
            const from = sourceDescriptor();
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LIST', params: wireParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: wireParams,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Create list failed.',
            }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function sourceDescriptor() {
        return {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
    }

    function validate() {
        if (!fromAddress) { setFormError('No signing address available on this network.'); return false; }
        // Verify no pipe or semicolon in MEMO (both are protocol delimiters)
        if (/[|;]/.test(memo)) { setFormError('Memo cannot contain | or ; characters.'); return false; }
        // Verify MEMO fits the chain's length limit, measured as sent (trimmed)
        const memoTooLong = memoLengthError(trimmedMemo);
        if (memoTooLong) { setFormError(memoTooLong); return false; }
        if (nameError || descriptionError) { setFormError('Fix the list name and description first.'); return false; }
        if (listType === '2') {
            if (recipients.invalid.length > 0) {
                setFormError(`Remove ${recipients.invalid.length} invalid address${recipients.invalid.length === 1 ? '' : 'es'} before reviewing.`);
                return false;
            }
            if (recipients.valid.length === 0) { setFormError('Add at least one valid address.'); return false; }
        } else {
            // Verify every token name is well formed before counting them
            if (invalidTicks.length > 0) {
                setFormError(`These don't look like token names: ${invalidTicks.join(', ')}`);
                return false;
            }
            if (memberTicks.length === 0) { setFormError('Add at least one token.'); return false; }
        }
        const sizeError = listActionSizeError(actionSize);
        if (sizeError) { setFormError(sizeError); return false; }
        return true;
    }

    function handleReview(event) {
        event.preventDefault();
        // Each attempt reopens the section holding the error; a
        // custom fee stop opens the Network fee row even when the fee field
        // shows the error itself.
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        setFeeStopped(Boolean(feeStop));
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!validate()) return;
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submitInFlightRef.current) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        submitInFlightRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const from = sourceDescriptor();
            const base = {
                walletId,
                chainId,
                from,
                params: wireParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    actionData: { action: 'LIST', params: wireParams },
                });
            } else {
                const fn = hw ? messaging.createListHw : messaging.createList;
                const args = hw ? { ...base, signerId: fromAddress.signerId } : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Create list failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !hw) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review List' : 'Create List'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
        </Screen>
    );

    // The load error, the loading line and every result lay out through
    // ListPage, as the contacts picker below does, so no state draws
    // straight into Screen.
    if (loadError) {
        return wrap(<ListPage notices={<StatusMessage variant="error">{loadError}</StatusMessage>} />);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.tx_hash;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ListPage>
                    <ResultScreen state="unsigned" result={result} onBuildAnother={() => { setResult(null); setStage('form'); }} onDone={onBack} />
                </ListPage>,
            );
        }
        // Signed but never broadcast. "List published... is on its
        // way" is the one thing that did not happen.
        if (result?.queued) {
            return wrap(
                <ListPage>
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} what="list" unsaved={result.unsaved} />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>List published</h2>
                <p className={styles.summary}>
                    {listType === '2' ? 'Address' : 'Token'} list with {items.length} item{items.length === 1 ? '' : 's'} is on its way.
                    Once it's indexed you can view it from My Lists and reference it from an airdrop, gate, dispenser, or order.
                </p>
                {listType === '1' && missingTicks.length > 0 ? (
                    <p className={styles.hint}>
                        {missingTicks.length} of these ({missingTicks.join(', ')}) {missingTicks.length === 1 ? 'was' : 'were'} not
                        found on the selected network; unknown tokens are left out of the list.
                        Check the members in My Lists once it's indexed.
                    </p>
                ) : null}
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}><code className={styles.txid}>{String(txid || 'n/a')}</code></dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    // confirm page, rendered in place of the form.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: t('components.confirmSummary.verbCreateList'),
                    ...(trimmedName ? { target: trimmedName } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                chainLabel={null}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
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
                onReject={() => { setSubmitError(null); setStage('form'); }}
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('components.confirmSummary.verbCreateList'),
                    ...(trimmedName ? { target: trimmedName } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: [
                        { label: 'Type', value: listType === '2' ? 'Address list' : 'Token list' },
                        { label: 'Items', value: String(items.length) },
                        { label: 'Action size', value: `${actionSize.compiledBytes.toLocaleString('en-US')} / ${actionSize.maxBytes.toLocaleString('en-US')} bytes` },
                    ],
                    ...(!nativeFee.flag && quotedProtocolFee.known ? {
                        protocolFee: {
                            amount: quotedProtocolFee.free ? '0' : String(quotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
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
                onChainChange={(cid) => { setChainId(cid); setFromAddressId(null); setFormError(null); }}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Add a Token"
                onSelect={(sel) => {
                    const t = String(sel.tick || '');
                    const selectedDescriptor = sel.chainId ? chainRegistry.get(sel.chainId) : null;
                    const selectedCoin = selectedDescriptor
                        ? { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[selectedDescriptor.coin]
                        : coinTicker;
                    const item = tickCoinSupported ? qualifyTickItem(selectedCoin, t, coinTicker) : t;
                    if (item) setTicksText((prev) => (prev.trim() ? `${prev}\n${item}` : item));
                    setFormError(null);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    if (contactPickerOpen) {
        return (
            <ContactAddressPickerScreen
                variant={variant}
                messaging={messaging}
                chainCoin={descriptor?.coin}
                addedAddresses={pasteText.split(/[\s,;]+/).filter(Boolean)}
                onAdd={(address) => {
                    setPasteText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${address}` : address));
                    setFormError(null);
                    setContactPickerOpen(false);
                }}
                onBack={() => setContactPickerOpen(false)}
            />
        );
    }

    // stage === 'form'
    // Which section holds the form error, so that section reopens on
    // every Publish attempt even after the user closed it.
    const errorSection = feeStopped ? 'fee'
        : !formError ? null
            : /memo/i.test(formError) ? 'memo'
                : /name and description/i.test(formError) ? 'details'
                    : /signing address/i.test(formError) ? 'from'
                        : 'list';
    const sectionErrorKey = (id) => (errorSection === id ? reviewAttempt + 1 : 0);
    const listSummary = joinSummary(
        listType === '2' ? 'Address list' : 'Token list',
        `${items.length} item${items.length === 1 ? '' : 's'}`,
    );
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Create list"
            onSubmit={handleReview}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            status={[formError ? <StatusMessage key="error" variant="error">{formError}</StatusMessage> : null]}
            action={(
                <FormAction
                    icon={singleEncode ? <Icon.UploadIcon /> : <Icon.DocumentIcon />}
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing}
                >
                    {actionConfirm.composing ? 'Preparing Review…' : singleEncode ? 'Publish List' : 'Create Unsigned Transaction'}
                </FormAction>
            )}
            /* From (closed) holds Network and the From address. With
               no address on the network it opens and says so. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(cid) => { setChainId(cid); setFromAddressId(null); setFormError(null); }}
                    networkHelp="The chain the list is published on. Your From address and the fee are on this network, and the list holds addresses or tokens of this chain."
                    address={fromAddress?.address || null}
                    addressLabel="From"
                    addressHelp={t('routes.listCreate.fromHelp')}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                    // Only when the network truly has no address; the
                    // default pick lands one render after the list loads.
                    missing={(addressesByChain?.[chainId] || []).length === 0
                        ? <FormNotice variant="error">No address on this network. Use Receive to generate one first.</FormNotice>
                        : null}
                />
            )}
            /* The one Fees section: the speed slider, the network and
               protocol fee lines and the native-fee switch. */
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        // A new list is never shared, and only sharing or
                        // editing a shared list pays a protocol fee
                        // (listFeeSchedule.js), so it reads Free from the start.
                        free: true,
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker },
                    }}
                />
            )}
        >
            <FormSection
                id="list"
                title="List"
                icon={Icon.TokenListIcon}
                {...formSections.bind('list')}
                revealKey={sectionErrorKey('list')}
                summary={listSummary}
            >
            {actionField}
            <ListTypeField
                value={listType}
                autoFocus={focusTypeOnMount}
                onFocused={onTypeFocused}
                onChange={(value) => {
                    onListTypeChange(value);
                    setFormError(null);
                }}
            />

            {listType === '2' ? (
                <>
                    <div
                        {...recipientsDrop.rootProps}
                        data-drop-active={recipientsDrop.isDragOver ? 'true' : 'false'}
                    >
                        <Textarea
                            id="list-addresses"
                            label="Addresses"
                            help={`These addresses become permanent public on-chain data once the list is published.${editResolutionActive === true
                                ? ' You can change who is on the list later with Fork & edit, and everything that references this list then uses the edited membership, but the addresses published here stay in the network\'s history.'
                                : editResolutionActive === false
                                    ? ' There\'s no way to edit or delete an address out of a list later; forking (Fork & edit) only creates a new list at a new index.'
                                    : ' Fork & edit can change who is on the list later: where list-edit resolution is active, everything that references this list follows your newest edit; before that, a fork is a separate list at a new index. Either way, the addresses published here stay in the network\'s history.'} If you later point a token's allow-list or block-list at this list, that token can never be bridged to another network, and the binding itself can never be cleared once set. Each address adds to the transaction size and increases the network fee; the exact fee is set when you broadcast.`}
                            value={pasteText}
                            onChange={(e) => { setPasteText(e.target.value); setFormError(null); }}
                            placeholder={recipientsDrop.isDragOver
                                ? 'Drop the CSV / TXT file here'
                                : 'Paste addresses, one per line or comma-separated.'}
                            rows={8}
                            spellCheck={false}
                            autoCapitalize="off"
                            autoCorrect="off"
                            autoComplete="off"
                        />
                    </div>
                    {/* The standard file field; the drop-zone hook keeps its
                        size cap, type check and read for both the dialog and
                        a drop on the field. */}
                    <FileField
                        label={t('routes.listCreate.addressesFile')}
                        help={t('routes.listCreate.addressesFileHelp')}
                        optional
                        inputLabel={t('routes.listCreate.addressesFileInput')}
                        fileName={recipientsFileName}
                        drop={recipientsDrop}
                        onClear={clearRecipientsFile}
                    />
                    <div className={styles.importActions}>
                        <Button type="button" variant="ghost" onClick={() => setContactPickerOpen(true)}>
                            Add from Contacts
                        </Button>
                    </div>
                    {pasteText.trim() ? (
                        <p className={styles.hint}>
                            {recipients.valid.length} valid address{recipients.valid.length === 1 ? '' : 'es'}
                            {recipients.duplicates > 0 ? ` · ${recipients.duplicates} duplicate${recipients.duplicates === 1 ? '' : 's'} removed` : ''}
                            {recipients.invalid.length > 0 ? ` · ${recipients.invalid.length} invalid` : ''}
                        </p>
                    ) : null}
                    {recipients.invalid.length > 0 ? (
                        <div className={styles.hint}>
                            <Button type="button" className={styles.back} icon={showInvalid ? <Icon.EyeOffIcon /> : <Icon.EyeIcon />} onClick={() => setShowInvalid((s) => !s)}>
                                {showInvalid ? 'Hide' : 'Show'} {recipients.invalid.length} Invalid
                            </Button>
                            {showInvalid ? (
                                <ul>{recipients.invalid.map((a, i) => (<li key={i}><code>{a}</code></li>))}</ul>
                            ) : null}
                        </div>
                    ) : null}
                    {/* A real address for a different chain is not a typo;
                        say which chain this list is being published to. */}
                    {recipients.wrongNetwork.length > 0 ? (
                        <FieldNote variant="warning" role="alert">
                            <p>
                                {recipients.wrongNetwork.length} address
                                {recipients.wrongNetwork.length === 1 ? ' is' : 'es are'} for another
                                network. This list is published on the selected network, so remove
                                {recipients.wrongNetwork.length === 1 ? ' it' : ' them'} to continue.
                            </p>
                            <DiagnosticDetails
                                summary={`Skipped addresses (${recipients.wrongNetwork.length})`}
                                keepAddresses
                                items={recipients.wrongNetwork.map((address) => ({
                                    subject: address,
                                    message: 'Does not belong to the selected network.',
                                }))}
                            />
                        </FieldNote>
                    ) : null}
                    {/* A ^<index> entry is an address reference, not a typo; this
                        form needs the address itself, so say that instead. */}
                    {recipients.addressRefs.length > 0 ? (
                        <FieldNote variant="warning" role="alert">
                            <p>{addressReferenceNote(recipients.addressRefs.length)}</p>
                            <DiagnosticDetails
                                summary={`Address references (${recipients.addressRefs.length})`}
                                keepAddresses
                                items={recipients.addressRefs.map((ref) => ({
                                    subject: ref,
                                    message: ADDRESS_REFERENCE_ITEM_MESSAGE,
                                }))}
                            />
                        </FieldNote>
                    ) : null}
                </>
            ) : (
                <TickItemsEditor
                    value={ticksText}
                    onChange={(value) => { setTicksText(value); setFormError(null); }}
                    items={tickItems}
                    chainId={chainId}
                    chainLabel="the selected network"
                    listCoin={coinTicker}
                    coinQualified={tickCoinSupported}
                    messaging={messaging}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                    status={tickStatus}
                    onStatusChange={setTickStatus}
                    fileField={(
                        <FileField
                            label={t('routes.listCreate.tickersFile')}
                            help={t('routes.listCreate.tickersFileHelp')}
                            optional
                            inputLabel={t('routes.listCreate.tickersFileInput')}
                            fileName={ticksFileName}
                            drop={ticksDrop}
                            onClear={clearTicksFile}
                        />
                    )}
                />
            )}
            {/* The action size describes the list, so it closes the List section. */}
            {reachedEightyPercent(actionSize.compiledBytes, actionSize.maxBytes) ? (
                <p className={styles.hint}>
                    Action size: {formatBytes(actionSize.compiledBytes)} of {formatBytes(actionSize.maxBytes)}.
                </p>
            ) : null}
            </FormSection>

            {/* Name and Description are one optional Details section;
                inside it the fields drop their own Optional tags. */}
            {metaSupported ? (
                <FormSection
                    id="details"
                    title="Details"
                    icon={Icon.DocumentIcon}
                    optional
                    {...formSections.bind('details')}
                    revealKey={sectionErrorKey('details')}
                    summary={joinSummary(trimmedName, trimmedDescription ? 'description' : null) || 'None'}
                >
                    <Input
                        label="Name"
                        help={`A public on-chain name for this list, up to ${LIST_META_NAME_MAX_BYTES} UTF-8 bytes.`}
                        hint={`${utf8ByteLength(trimmedName)} / ${LIST_META_NAME_MAX_BYTES} bytes`}
                        error={nameError || undefined}
                        value={listName}
                        onChange={(e) => { setListName(e.target.value); setFormError(null); }}
                        autoComplete="off"
                    />
                    <Input
                        label="Description"
                        help={`A public on-chain description of this list, up to ${LIST_META_DESCRIPTION_MAX_BYTES} UTF-8 bytes.`}
                        hint={`${utf8ByteLength(trimmedDescription)} / ${LIST_META_DESCRIPTION_MAX_BYTES} bytes`}
                        error={descriptionError || undefined}
                        value={listDescription}
                        onChange={(e) => { setListDescription(e.target.value); setFormError(null); }}
                        autoComplete="off"
                    />
                </FormSection>
            ) : null}
            {/* Memo is its own optional section, closed until used, holding
                only the memo: the title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                summary={trimmedMemo || 'None'}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => { setMemo(e.target.value); setFormError(null); }}
            />
        </FormFrame>,
    );
}

/**
 * Full-screen tap-to-add picker over the wallet's saved contacts,
 * filtered to entries on the create form's current chain (when known).
 * Rows look like the Contacts page rows (initials tile, name, address,
 * chevron). Tapping one hands its address to the caller, which appends
 * it to the paste textarea and returns to the form. An address already
 * in the list is muted and marked Added, and cannot be added twice.
 *
 * @param {object} props
 * @param {'full' | 'compact'} props.variant
 * @param {{ listContacts: () => Promise<any[]> }} props.messaging
 * @param {string} [props.chainCoin]   e.g. 'bitcoin'; unset shows every entry
 * @param {string[]} [props.addedAddresses]   addresses already in the list
 * @param {(address: string) => void} props.onAdd
 * @param {() => void} props.onBack
 */
function ContactAddressPickerScreen({ variant, messaging, chainCoin, addedAddresses = [], onAdd, onBack }) {
    const [contacts, setContacts] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [query, setQuery] = useState('');
    const added = useMemo(() => new Set(addedAddresses), [addedAddresses]);

    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(Array.isArray(rows) ? rows : []); })
            .catch((err) => { if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load contacts.')); });
        return () => { cancelled = true; };
    }, [messaging]);

    const rows = useMemo(() => {
        if (!contacts) return [];
        /** @type {{ key: string, name: string, address: string, label: string }[]} */
        const out = [];
        for (const c of contacts) {
            for (const e of (c?.entries || [])) {
                if (!e?.address) continue;
                if (chainCoin && e.chain !== chainCoin) continue;
                out.push({
                    key: `${c.id}:${e.address}`, name: c.name, address: e.address, label: e.label || '',
                    contactId: c.id, avatarSeed: c.avatarSeed, look: c.look,
                });
            }
        }
        return out;
    }, [contacts, chainCoin]);

    // The Contacts page's own filter: a search box in the title bar menu.
    const header = (
        <PageHeader
            // A picker inside the list form: Back closes it in place.
            nested
            onBack={onBack}
            title="Add from Contacts"
            trailing={contacts && !loadError ? (
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    label="Filter contacts"
                    searchPlaceholder="Search"
                    searchLabel="Search contacts"
                />
            ) : null}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );
    const q = query.trim().toLowerCase();
    const shown = q
        ? rows.filter((r) => `${r.name} ${r.address} ${r.label}`.toLowerCase().includes(q))
        : rows;

    if (loadError) return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    if (!contacts) return wrap(<p className={styles.hint}>Loading contacts…</p>);
    if (rows.length === 0) {
        return wrap(<EmptyState title="No matching contact addresses" body="Matching contact addresses on this network appear here." />);
    }

    return wrap(
        <>
            {shown.length === 0 ? (
                <EmptyState title="No results" body="No contact address matches this search." />
            ) : (
                <ul className={contactsStyles.list} aria-label="Contacts">
                    {shown.map((r, index) => {
                        const isAdded = added.has(r.address);
                        return (
                            <li
                                key={r.key}
                                style={{ borderTop: index === 0 ? 'none' : '1px solid var(--xc-border)' }}
                            >
                                {/* Same row as the Contacts page. An added address is a
                                    display-only muted row, so it cannot be added twice. */}
                                <ListRow
                                    className={contactsStyles.row}
                                    {...(isAdded
                                        ? { style: { opacity: 0.6 }, trailing: <span>Added</span> }
                                        : { onClick: () => onAdd(r.address), chevron: true, 'aria-label': r.name })}
                                    leading={<ContactAvatar contact={{ id: r.contactId, name: r.name, avatarSeed: r.avatarSeed, look: r.look }} context="list" />}
                                    title={<span className={contactsStyles.rowName}>{r.name}</span>}
                                    subtitle={<AddressText address={r.address} />}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </>,
    );
}

// ---------------------------------------------------------------------------
// Union (TYPE=3): a one-level union of the wallet's lists and shared-list
// mirrors, LIST format 0 TYPE 3, built and signed through the owner-action
// lane. Its own body because its compose lane, fixed fee and FormPage state
// panels differ from the address and token lists.
// ---------------------------------------------------------------------------

const UNION_FROM_HELP = 'The address that publishes the union list and pays its network fee. It becomes the list\'s owner.';
const UNION_SDK_REASON = listActionUnavailableMessage('union');
const UNION_CHECK_FAILED_REASON = listActionCheckFailedMessage('union');

function unionResponseRows(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.rows)) return response.rows;
    return [];
}

function unionListIndex(row) {
    const value = row?.action_index ?? row?.actionIndex;
    return value == null || value === '' ? null : String(value);
}

function unionRowName(row) {
    return typeof row?.name === 'string' && row.name !== '' ? row.name : null;
}

function unionLocalCandidate(row) {
    const actionIndex = unionListIndex(row);
    if (!actionIndex) return null;
    return {
        actionIndex,
        type: String(row.type ?? ''),
        name: unionRowName(row),
        members: Array.isArray(row.members) ? row.members : undefined,
        shared: false,
    };
}

function unionSharedCandidate(row) {
    const value = row?.bindTarget;
    if (value == null || value === '') return null;
    return {
        actionIndex: String(value),
        type: String(row.type ?? ''),
        name: unionRowName(row),
        members: Array.isArray(row.members) ? row.members : undefined,
        shared: true,
        homeChain: String(row.home_chain ?? ''),
        homeListIndex: String(row.home_list_index ?? ''),
    };
}

function mergeUnionCandidates(localRows, sharedRows) {
    const seen = new Set();
    return [...localRows.map(unionLocalCandidate), ...sharedRows.map(unionSharedCandidate)]
        .filter((candidate) => {
            if (!candidate || !['1', '2'].includes(candidate.type) || seen.has(candidate.actionIndex)) return false;
            seen.add(candidate.actionIndex);
            return true;
        });
}

function unionCandidateLabel(candidate) {
    const kind = candidate.type === '1' ? 'Token' : 'Address';
    if (!candidate.shared) return `${kind} list #${candidate.actionIndex}`;
    const origin = candidate.homeChain && candidate.homeListIndex
        ? ` from ${candidate.homeChain} list #${candidate.homeListIndex}`
        : '';
    return `Shared ${kind.toLowerCase()} list #${candidate.actionIndex}${origin}`;
}

function unionCandidateName(candidate) {
    const label = unionCandidateLabel(candidate);
    const name = candidate.name ? neutralizeControlText(candidate.name) : '';
    return name ? `${name} (${label})` : label;
}

async function readUnionCandidates({ messaging, chainId, addresses }) {
    const [ownedResults, sharedResult] = await Promise.all([
        Promise.all((addresses || []).map((record) => (
            messaging.getListsForSource({ chainId, address: record.address })
        ))),
        messaging.getSharedLists({ chainId }),
    ]);
    const candidates = mergeUnionCandidates(
        ownedResults.flatMap(unionResponseRows),
        Array.isArray(sharedResult?.lists) ? sharedResult.lists : unionResponseRows(sharedResult),
    );
    return Promise.all(candidates.map(async (candidate) => {
        if (Array.isArray(candidate.members) || typeof messaging.getListByActionIndex !== 'function') return candidate;
        try {
            const detail = await messaging.getListByActionIndex({
                chainId,
                actionIndex: candidate.actionIndex,
            });
            const members = currentListItems(detail);
            return Array.isArray(members) ? { ...candidate, members } : candidate;
        } catch {
            return candidate;
        }
    }));
}

/**
 * The union body. The host keys it by wallet, requested network and
 * account, so a new context never shows the old one's lists.
 */
function UnionListBody({
    walletId,
    chainId: initialChainId,
    activeAccountId,
    listType,
    onListTypeChange,
    shared,
    onSharedChange,
    focusTypeOnMount,
    onTypeFocused,
    actionField = null,
    onBack,
    onDone = onBack,
}) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);
    const signerReady = useSignerReady(walletId);
    const [chainId, setChainId] = useState(shared?.chainId || initialChainId || null);
    const [addressesByChain, setAddressesByChain] = useState(null);
    const [activeByChain, setActiveByChain] = useState(null);
    const [fromAddressId, setFromAddressId] = useState(shared?.fromAddressId || null);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [candidates, setCandidates] = useState(null);
    const [picked, setPicked] = useState([]);
    const [memo, setMemo] = useState(shared?.memo || '');
    const [sdkSupported, setSdkSupported] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [formError, setFormError] = useState(null);
    const formErrors = useFormErrors();
    const [result, setResult] = useState(null);
    // The standard sections' open state, held above the picker
    // early return so it survives it; a counter of Create attempts reopens
    // the section that holds the error on every attempt.
    const formSections = useFormSections({ from: false, union: true, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);

    // Hand the shared fields to the host so a switch back keeps them.
    useEffect(() => {
        onSharedChange({ chainId, fromAddressId, memo });
    }, [chainId, fromAddressId, memo, onSharedChange]);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            Promise.resolve().then(() => messaging.getAddressesByChain(walletId, activeAccountId)),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve().then(() => messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve().then(() => messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ]).then(([byChain, active, settings]) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            setActiveByChain(active || {});
            setChainId((current) => pickDefaultChainId(byChain, {
                explicitChainId: current || initialChainId,
                settings,
            }));
        }).catch((error) => {
            if (!cancelled) setLoadError(userFacingMessage(error, 'Failed to load addresses.'));
        });
        return () => { cancelled = true; };
    }, [walletId, activeAccountId, initialChainId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return undefined;
        let cancelled = false;
        setCandidates(null);
        setPicked([]);
        setLoadError(null);
        readUnionCandidates({ messaging, chainId, addresses: addressesByChain[chainId] || [] })
            .then((rows) => { if (!cancelled) setCandidates(rows); })
            .catch((error) => {
                if (!cancelled) setLoadError(userFacingMessage(error, 'Failed to load lists.'));
            });
        return () => { cancelled = true; };
    }, [addressesByChain, chainId, messaging]);

    useEffect(() => {
        if (!chainId) return undefined;
        let cancelled = false;
        setSdkSupported(null);
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listFormatSupport({ sdkRegistry, chainId }))
            .then((support) => { if (!cancelled) setSdkSupported(support?.union === true); })
            .catch(() => { if (!cancelled) setSdkSupported('error'); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain) return;
        const addresses = addressesByChain[chainId] || [];
        const selected = addresses.some((record) => record.id === fromAddressId);
        if (selected) return;
        setFromAddressId(preferredSourceId(addresses, activeByChain[chainId]) || addresses[0]?.id || null);
    }, [addressesByChain, activeByChain, chainId, fromAddressId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    // The standard's Network fee row, display only: the union lane
    // takes no fee pick, so the row shows the normal-rate estimate the other
    // list forms show, and the exact fee is set at review.
    const coinTicker = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor?.coin] || '';
    const feeEstimate = useMemo(() => (chainId ? estimateNativeSendFee({ chainId, chainRegistry }) : null), [chainId]);
    const fromAddress = useMemo(() => (
        (addressesByChain?.[chainId] || []).find((record) => record.id === fromAddressId) || null
    ), [addressesByChain, chainId, fromAddressId]);
    const pickState = useMemo(() => unionPickState({
        picked,
        candidates: candidates || [],
    }), [picked, candidates]);
    const rowState = useMemo(() => new Map(
        pickState.rows.map((row) => [row.actionIndex, row]),
    ), [pickState.rows]);
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId: chainId || '',
        owner: fromAddress,
        software: 'createList',
        hardware: 'createListHw',
    });

    function toggleCandidate(actionIndex) {
        const state = rowState.get(actionIndex);
        if (!state || (state.disabled && !state.picked)) return;
        setPicked((current) => (
            current.includes(actionIndex)
                ? current.filter((value) => value !== actionIndex)
                : [...current, actionIndex]
        ));
        setFormError(null);
        formErrors.clear('list-union-members');
    }

    async function handleReview(event) {
        event.preventDefault();
        setReviewAttempt((n) => n + 1); // Reopens the section holding an error.
        const trimmedMemo = memo.trim();
        const memoTooLong = memoLengthError(trimmedMemo);
        const problems = {
            'form:sdk': sdkSupported !== true
                ? (sdkSupported === 'error' ? UNION_CHECK_FAILED_REASON : UNION_SDK_REASON) : null,
            'list-union-from': !fromAddress ? 'No signing address available on this network.' : null,
            'list-union-members': !pickState.canReview
                ? (pickState.overLimit
                ? 'The estimated merged membership is over 10,000.'
                    : 'Choose at least one member list.') : null,
            'list-union-memo': /[|;]/.test(memo)
                ? 'Memo cannot contain | or ; characters.' : memoTooLong,
        };
        if (!formErrors.validate(problems)) {
            setFormError(null);
            return;
        }
        const params = { VERSION: '0', TYPE: '3', MEMO: trimmedMemo, ITEM: picked };
        try {
            setFormError(null);
            const next = await lane.run({
                actionData: { action: 'LIST', params },
                submitExtra: { params },
            });
            setResult(next || {});
        } catch (error) {
            if (isUserRejection(error)) return;
            setFormError(submitFailureMessage(error, {
                chainId,
                fallback: error?.message || 'Create union list failed.',
            }));
        }
    }

    const header = <PageHeader onBack={onBack} title="Create List" />;
    const buildAnother = () => {
        setResult(null);
        setPicked([]);
        setMemo('');
        setFormError(null);
    };
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                summary={{
                    verb: t('components.confirmSummary.verbCreateUnionList'),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                walletId={walletId}
                screenVariant={variant}
                feeEstimate={feeEstimate}
                chainLabel={descriptor?.displayName || chainId}
                signerReady={signerReady}
            />
        );
    }
    // The load error, the loading line and the result panels lay out through
    // FormPage like the form itself, so no state draws straight into Screen.
    // None of them submits anything, so each is the div form of the template.
    // The load error is the template's body, not its status slot, so it draws
    // its own box and the shell's "Some balances may be out of date" steps
    // aside: one message per page.
    if (loadError) {
        return wrap(
            <FormPage as="div" label="Create list">
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </FormPage>,
        );
    }
    if (!addressesByChain || !chainId || candidates === null || sdkSupported === null) {
        return wrap(<FormPage as="div" label="Create list"><p className={styles.hint}>Loading...</p></FormPage>);
    }
    if (result) {
        // Signed but held in the broadcast queue: nothing is on the network yet.
        if (result.queued) {
            return wrap(
                <FormPage as="div" label="Queued union list">
                    <ResultScreen state="signed-not-broadcast" onDone={onDone} what="union list" unsaved={result.unsaved} />
                </FormPage>,
            );
        }
        if (result.psbtHex && !result.txid) {
            return wrap(
                <FormPage as="div" label="Unsigned union list">
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={buildAnother}
                        onDone={onDone}
                    />
                </FormPage>,
            );
        }
        return wrap(
            <FormPage
                as="div"
                label="Union list submitted"
                title="Union list submitted"
                headingAs="h2"
                actions={<Button type="button" variant="success" icon={<Icon.CheckIcon />} onClick={onDone}>Done</Button>}
            />,
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                accountId={activeAccountId}
                chainId={chainId}
                onChainChange={(value) => { setChainId(value); setFromAddressId(null); }}
                onPick={(record) => { setFromAddressId(record.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Which section holds the form error, so that section reopens on
    // every Create attempt even after the user closed it.
    const errorSection = !formError ? null
        : /memo/i.test(formError) ? 'memo'
            : /signing address/i.test(formError) ? 'from'
                : 'union';
    const sectionErrorKey = (id) => (errorSection === id ? reviewAttempt + 1 : 0);
    const trimmedMemoText = memo.trim();
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Create list"
            onSubmit={handleReview}
            errors={formErrors}
            status={[
                sdkSupported === false ? <StatusMessage key="sdk" variant="error">{UNION_SDK_REASON}</StatusMessage> : null,
                sdkSupported === 'error' ? <StatusMessage key="sdk-check" variant="error">{UNION_CHECK_FAILED_REASON}</StatusMessage> : null,
                formError ? <StatusMessage key="error" variant="error">{formError}</StatusMessage> : null,
            ]}
            action={(
                <FormAction
                    icon={<Icon.PlusIcon />}
                    loading={lane.composing}
                    disabled={sdkSupported !== true}
                >
                    {lane.isWatcherMode ? 'Create Unsigned Transaction' : 'Create Union List'}
                </FormAction>
            )}
            /* From (closed) holds Network (locked while the SDK cannot build a
               union here) and the From address. With no address on the
               network it opens and says so. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={Object.keys(addressesByChain)}
                    chainRegistry={chainRegistry}
                    onNetworkChange={sdkSupported === true
                        ? (value) => { setChainId(value); setFromAddressId(null); }
                        : undefined}
                    networkHelp="The chain the union list is published on. Only your lists on this network can be combined."
                    address={fromAddress?.address || null}
                    addressId="list-union-from"
                    addressLabel="From"
                    addressHelp={UNION_FROM_HELP}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                    formErrorKey="list-union-from"
                    // Only when the network truly has no address; the
                    // default pick lands one render after the list loads, and
                    // that gap must not open From for good.
                    missing={(addressesByChain[chainId] || []).length === 0
                        ? <FormNotice variant="error">No address on this network. Use Receive to generate one first.</FormNotice>
                        : null}
                />
            )}
            fee={feeEstimate ? (
                // FeeSection's fixed-fee mode (no speed pick on this lane).
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    fixedFee={feeEstimate.coinAmount}
                >
                    <p className={styles.hint}>An estimate. The exact fee is set when the union list is built for review.</p>
                </FeeSection>
            ) : null}
        >
            {/* The List section (open) leads with the List type, then the
                member lists; the estimate sits under the picks. */}
            <FormSection
                id="union"
                title="List"
                icon={Icon.TokenListIcon}
                {...formSections.bind('union')}
                revealKey={sectionErrorKey('union')}
                summary={joinSummary(
                    'Union',
                    picked.length ? `${picked.length} member list${picked.length === 1 ? '' : 's'}` : 'No member lists',
                    picked.length && pickState.mergedCount !== null ? `about ${pickState.mergedCount.toLocaleString()} members` : null,
                )}
            >
            {actionField}
            <ListTypeField
                value={listType}
                autoFocus={focusTypeOnMount}
                onFocused={onTypeFocused}
                onChange={(value) => { onListTypeChange(value); setFormError(null); }}
            />
            <fieldset className={styles.flatFieldset} disabled={sdkSupported !== true}>
                <legend>
                    {t('components.unionList.memberLists')}
                    <InfoTip
                        aria={t('ui.field.about', { label: t('components.unionList.memberLists') })}
                        label={t('components.unionList.memberListsHelp')}
                    />
                </legend>
                {candidates.length === 0 ? (
                    <EmptyState
                        title="No usable lists"
                        body="Local and shared lists available on this network appear here."
                        titleAs="p"
                    />
                ) : null}
                {candidates.map((candidate, index) => {
                    const state = rowState.get(candidate.actionIndex);
                    const reason = state?.reason || null;
                    return (
                        <div key={candidate.actionIndex}>
                            <Checkbox
                                id={index === 0 ? 'list-union-members' : undefined}
                                label={unionCandidateName(candidate)}
                                checked={state?.picked === true}
                                disabled={sdkSupported !== true || state?.disabled === true}
                                error={index === 0 ? formErrors.errorFor('list-union-members') : undefined}
                                onChange={() => toggleCandidate(candidate.actionIndex)}
                            />
                            {reason ? <p className={styles.hint}>{reason}</p> : null}
                        </div>
                    );
                })}
            </fieldset>

            {picked.length > 0 ? (
                <div>
                    <p>
                        {pickState.mergedCount === null
                            ? 'Estimated merged membership: unavailable'
                            : `Estimated merged membership: ${pickState.mergedCount.toLocaleString()}`}
                    </p>
                </div>
            ) : null}
            </FormSection>

            {/* Memo is its own optional section holding only the memo: the
                section title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                summary={trimmedMemoText || 'None'}
                inputId="list-union-memo"
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                disabled={sdkSupported !== true}
            />
        </FormFrame>,
    );
}

// ---------------------------------------------------------------------------
// Helpers the list actions share: the shared-list lookup, short addresses
// and the name and description checks of an existing list.
// ---------------------------------------------------------------------------

const EMPTY_ITEMS = Object.freeze(/** @type {string[]} */ ([]));

const EDIT_META_ERROR_TEXT = {
    pipe: 'Cannot contain the | character.',
    semicolon: 'Cannot contain the ; character.',
    unsafe: 'Cannot contain control, text-direction, or zero-width characters.',
    length: 'Too long.',
    format: 'Invalid format.',
};

/** An existing list's name or description; '-' is the clear sentinel there. */
function editMetaFieldError(field, value) {
    const code = listMetaInputError(field, value, { isCreate: false });
    return code ? EDIT_META_ERROR_TEXT[code] : null;
}

function rowsFromSharedLists(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.lists)) return value.lists;
    if (Array.isArray(value?.data)) return value.data;
    return [];
}

function isHomeRowForList(row, listActionIndex, descriptor, chainId) {
    if (row?.kind !== 'home') return false;
    const rowIndex = row.home_list_index ?? row.local_list_index ?? row.bindTarget;
    if (String(rowIndex) !== String(listActionIndex)) return false;
    if (row.home_chain == null || row.home_chain === '') return true;
    const homes = new Set([
        String(chainId).toUpperCase(),
        String(descriptor?.coin || '').toUpperCase(),
        String(TICKER_BY_COIN[descriptor?.coin] || '').toUpperCase(),
    ]);
    return homes.has(String(row.home_chain).toUpperCase());
}

/** An owner address as named in a notice: whole, since the notice wraps (G99). */
function ownerText(value) {
    return String(value || '');
}

// ---------------------------------------------------------------------------
// Edit and Fork: LIST v1 edits of the members, and in Edit the VERSION 5
// name and description.
// ---------------------------------------------------------------------------

// 30 s: BTC blocks are 10 min apart, so an index check changes at most once per block.
const POLL_INTERVAL_MS = 30_000;

// PC-10 fork-repoint rail (spec §3): the three consumer classes with an
// edit screen that can point them at a different list index. AIRDROP isn't
// here: an airdrop is a one-shot distribution against whatever list existed
// when it was signed, so there's nothing on an already-broadcast airdrop to
// repoint. Each row opens its screen through the shell's `repointHandlers`.
const REPOINT_TARGETS = [
    { id: 'issue-lists', label: 'Token allow/block lists', pcItem: 'PC-04', built: true },
    { id: 'dispenser-lists', label: 'Dispenser allow/block lists', pcItem: 'PC-19', built: true },
    { id: 'order-lists', label: 'Order allow/block lists', pcItem: 'PC-17', built: true },
];

/**
 * PC-10 "Fork & edit" (LIST v1): edit an existing list with ADD and/or
 * REMOVE deltas. Each v1 action gets its own list index, and under
 * list-edit resolution (below) it also becomes what every reference to
 * the original list resolves to.
 *
 * The protocol only lets one v1 action carry ONE edit direction
 * (EDIT=1 add, or EDIT=2 remove; LIST.md's format is
 * VERSION|EDIT|LIST_ACTION_INDEX|ITEM, singular EDIT). A fork that
 * both adds and removes members is therefore two chained v1
 * transactions: an ADD forking the OLD index, then a REMOVE forking
 * the ADD's newly-assigned index. That inter-tx dependency needs the
 * same index-wait AirdropForm uses between its LIST and AIRDROP legs,
 * so it gets the same treatment: no crash-safe resume (mirrors
 * ProjectRosterForm's choice - the first tx is already on-chain if the
 * wallet closes mid-flow; finish the second leg later from My Lists),
 * and watcher mode is blocked only for the two-leg case, since a
 * watcher wallet can't observe the first leg landing on-chain to build
 * the second.
 *
 * What a fork does to the OLD index depends on list-edit resolution
 * (LIST_EDIT_RESOLUTION_ACTIVATION, read from the explorer's
 * `state.edit_resolution_active` and carried in `listRef`). After it,
 * every reference to the list resolves to its newest valid edit, so the
 * edit changes what every gate, dispenser, order, airdrop and callback
 * sees, and repointing is optional. Before it, the old index keeps its
 * own membership until each consumer is repointed by hand, and the
 * "stays live" warning is unconditional. When the flag is unknown (an
 * explorer that does not report it) the copy names both rules.
 *
 * Ends on a "now referenced by" step (§3) listing the consumer classes
 * that can repoint, each opening its edit screen when the shell passes a
 * handler for it.
 *
 * FROM defaults to the list's owner, the creator of the root of its edit
 * chain, whenever this wallet holds that address: once LIST_OWNER_ACTIVATION
 * is armed on a chain, an edit from any other address is invalid there. When
 * the wallet does not hold it, the form warns instead, because today such an
 * edit is still accepted on chains where that rule is not armed yet.
 *
 * Edit adds the list's name and description (LIST format 5, where the
 * wallet's SDK can build it), signed through the owner-action lane. There
 * is no combined transaction: a press that changes both the members and the
 * name or description is refused with "publish one change at a time".
 *
 * A list opened without its members (the rename route passes only the
 * chain and index) reads its type and members from the list itself.
 *
 * @param {object} props
 * @param {'edit' | 'fork'} props.mode
 * @param {typeof LIST_ACTIONS.edit} props.cfg
 * @param {string} props.walletId
 * @param {{ chainId: string, actionIndex: string | number, type?: '1' | '2', items?: string[], editResolutionActive?: boolean | null, source?: string | null, parentIndex?: string | null }} props.listRef
 * @param {import('react').ReactNode} props.actionField
 * @param {SharedListFields} [props.shared]
 * @param {(values: SharedListFields) => void} [props.onSharedChange]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 * @param {Partial<Record<'issue-lists' | 'dispenser-lists' | 'order-lists', () => void>>} [props.repointHandlers]
 */
function ListMembersBody({
    mode,
    cfg,
    walletId,
    listRef,
    actionField = null,
    shared,
    onSharedChange,
    onBack,
    onDone = onBack,
    repointHandlers,
}) {
    const isEdit = mode === 'edit';
    const repoint = repointHandlers || {};
    const { chainId, actionIndex: oldIndex } = listRef;
    const listActionIndexValid = /^[1-9][0-9]*$/.test(String(oldIndex));
    // The members the list was opened with, or (when the route passed none)
    // the ones read from the list itself.
    const suppliedItems = Array.isArray(listRef.items) ? listRef.items : null;
    const itemsSupplied = suppliedItems !== null;
    const [loadedList, setLoadedList] = useState(
        /** @type {{ items: string[], type: string, resolution: boolean | null } | null} */ (null),
    );
    const currentItems = suppliedItems || loadedList?.items || EMPTY_ITEMS;
    const listType = listRef.type != null ? String(listRef.type) : (loadedList?.type || '2');
    // true / false from the explorer, null when it does not say.
    const resolution = typeof listRef.editResolutionActive === 'boolean'
        ? listRef.editResolutionActive
        : (loadedList?.resolution ?? null);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isTick = String(listType) === '1';
    const isUnion = String(listType) === '3';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    // A From carried over from another action is kept when it is on this
    // list's network; the owner still wins once it is known.
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (shared?.chainId === chainId ? shared?.fromAddressId || null : null),
    );
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // The form holds the changes only: items typed or pasted under Add are
    // ADDs, items under Remove are REMOVEs (each must be on the list).
    const [addText, setAddText] = useState('');
    const [removeText, setRemoveText] = useState('');
    // Which one the field holds; switching clears both so one press only ever
    // adds or only ever removes.
    const [direction, setDirection] = useState(/** @type {'add' | 'remove'} */ ('add'));
    function changeDirection(next) {
        if (next === direction) return;
        setDirection(next);
        setAddText('');
        setRemoveText('');
        setFormError(null);
    }
    const [memo, setMemo] = useState(shared?.memo || '');
    const [password, setPassword] = useState('');
    // Edit's name and description (format 5), empty while unchanged.
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [listDetail, setListDetail] = useState(/** @type {any | null} */ (null));
    const [metaSupported, setMetaSupported] = useState(/** @type {boolean | 'error' | null} */ (isEdit ? null : false));
    // Null until read: Edit and an owner's Fork both edit the list itself,
    // and a shared list's edit pays the shared-edit fee.
    const [sharedRows, setSharedRows] = useState(/** @type {any[] | null} */ (null));
    const [metaResult, setMetaResult] = useState(/** @type {any | null} */ (null));
    const metaInFlightRef = useRef(false);

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-1' | 'wait-index' | 'review-2' | 'repoint'} */ ('compose'),
    );
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    // A leg that was SIGNED but never reached the network. The confirm
    // lane resolves that case rather than throwing, and the next leg is
    // keyed on this one's action index, so the flow stops here.
    const [queuedResult, setQueuedResult] = useState(
        /** @type {{ unsaved?: boolean } | null} */ (null),
    );
    const [tx1Txid, setTx1Txid] = useState(/** @type {string | null} */ (null));
    const [intermediateIndex, setIntermediateIndex] = useState(/** @type {string | null} */ (null));
    const [tx2Txid, setTx2Txid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    // Close re-entry before React renders the visible submitting state.
    const firstLegInFlightRef = useRef(false);
    const secondLegInFlightRef = useRef(false);
    // The list's owner: undefined while resolving, null when it cannot be read.
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [listName, setListName] = useState(/** @type {string | null} */ (null));
    const [tickCoinSupported, setTickCoinSupported] = useState(false);
    const [anyCoins, setAnyCoins] = useState(/** @type {string[]} */ ([]));
    // The standard sections' open state, held above the picker and
    // review early returns so it survives them; a counter of Publish attempts
    // reopens the section that holds the error on every attempt.
    const formSections = useFormSections({ from: false, edit: true, details: false, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [feeStopped, setFeeStopped] = useState(false);

    // Prefer the explorer's current owner, then walk to the root create for
    // older explorers that do not report one.
    useEffect(() => {
        let cancelled = false;
        // An older host build without the list read falls back to the row data
        // that ListDetail supplied.
        const readList = (idx) => (typeof messaging.getListByActionIndex === 'function'
            ? messaging.getListByActionIndex({ chainId, actionIndex: idx })
            : Promise.reject(new Error('list read unavailable')));
        const supplied = { source: listRef.source, list_action_index: listRef.parentIndex };
        const canRead = typeof messaging.getListByActionIndex === 'function';
        const start = canRead
            ? Promise.resolve().then(() => readList(String(oldIndex))).then((detail) => detail || (itemsSupplied ? supplied : null))
            : Promise.resolve(supplied);
        start
            .then((detail) => {
                if (cancelled) return detail;
                if (!detail) {
                    setLoadError(`List #${oldIndex} could not be read.`);
                    return detail;
                }
                setListName(typeof detail?.name === 'string' && detail.name.length > 0 ? detail.name : null);
                setListDetail(detail);
                if (!itemsSupplied) {
                    const members = currentListItems(detail);
                    setLoadedList({
                        items: Array.isArray(members) ? members.map(String) : [],
                        type: detail?.type != null ? String(detail.type) : '2',
                        resolution: typeof detail?.state?.edit_resolution_active === 'boolean'
                            ? detail.state.edit_resolution_active
                            : null,
                    });
                }
                return detail;
            })
            .then((detail) => (detail ? findListOwner({ detail, readList }) : undefined))
            .then((o) => { if (!cancelled && o !== undefined) setOwner(o); })
            .catch((err) => {
                if (!cancelled) {
                    setLoadError(
                        explorerReadFailure(err, `load list #${oldIndex}`)?.message
                        || `Couldn't load list #${oldIndex}. Try again.`,
                    );
                }
            });
        return () => { cancelled = true; };
    }, [chainId, oldIndex, listRef.source, listRef.parentIndex, itemsSupplied, messaging]);

    // Edit only: whether the SDK can build the name and description
    // (format 5). Then, for Edit and Fork, whether the list is shared (an
    // edit or rename of a shared list pays the shared-list edit fee).
    useEffect(() => {
        if (!isEdit) return undefined;
        let cancelled = false;
        setMetaSupported(null);
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listMetaSupported({ sdkRegistry, chainId }))
            .then((supported) => { if (!cancelled) setMetaSupported(supported === true); })
            .catch(() => { if (!cancelled) setMetaSupported('error'); });
        return () => { cancelled = true; };
    }, [isEdit, chainId, messaging]);
    useEffect(() => {
        let cancelled = false;
        Promise.resolve()
            .then(() => (typeof messaging.getSharedLists === 'function' ? messaging.getSharedLists({ chainId }) : []))
            .then((value) => { if (!cancelled) setSharedRows(rowsFromSharedLists(value)); })
            .catch(() => { if (!cancelled) setSharedRows([]); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    // The active map is best-effort: a host without `getActiveAddresses`, or
    // one whose call fails, still yields a usable form (newest-HD fallback).
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                if (!(byChain?.[chainId] || []).length) {
                    setLoadError('No address on this network yet. Use Receive to generate one first.');
                }
            })
            .catch(() => { if (!cancelled) setLoadError('Failed to load addresses.'); });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    // Hand the shared fields to the host so a switch keeps them.
    useEffect(() => {
        onSharedChange?.({ chainId, fromAddressId, memo });
    }, [chainId, fromAddressId, memo, onSharedChange]);

    useEffect(() => {
        if (stage === 'review-1' || stage === 'review-2') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // Wait-index polling between the ADD and REMOVE legs (only reached
    // when both are needed): same shape as AirdropForm / ProjectRosterForm.
    useEffect(() => {
        if (stage !== 'wait-index' || !tx1Txid) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: tx1Txid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setIntermediateIndex(idx);
                    setStage('review-2');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick();
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, tx1Txid, chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    useEffect(() => {
        let cancelled = false;
        setTickCoinSupported(false);
        if (!isTick) return () => { cancelled = true; };
        const sdkRegistry = {
            get: () => ({
                isListTickCoinActive: () => (typeof messaging.isListTickCoinActive === 'function'
                    ? messaging.isListTickCoinActive({ chainId })
                    : false),
            }),
        };
        listTickCoinSupport({ sdkRegistry, chainId })
            .then((supported) => { if (!cancelled) setTickCoinSupported(supported); })
            .catch(() => { if (!cancelled) setTickCoinSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, isTick, messaging]);

    // Once token-policy inheritance is active the indexer takes an address item
    // for any configured coin on this network; the explorer's flag says when, so
    // the form never offers an item the chain would drop into list_items_invalid.
    useEffect(() => {
        let cancelled = false;
        setAnyCoins([]);
        if (isTick || !chainId || !descriptor?.coin || !descriptor?.networkKind) return () => { cancelled = true; };
        Promise.resolve()
            .then(() => (typeof messaging.listAnyCoinItems === 'function'
                ? messaging.listAnyCoinItems({
                    chainId, coin: descriptor?.coin, networkKind: descriptor?.networkKind,
                })
                : []))
            .then((coins) => { if (!cancelled) setAnyCoins(Array.isArray(coins) ? coins : []); })
            .catch(() => { if (!cancelled) setAnyCoins([]); });
        return () => { cancelled = true; };
    }, [chainId, isTick, descriptor?.coin, descriptor?.networkKind, messaging]);

    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Same default as Send and every other spend-from-balance form: the
    // chain's active address, else the newest HD external, else the first
    // remaining record (a hardware-only wallet). A dispenser-delegated
    // address is never the default; it vends rather than funds.
    useEffect(() => {
        if (!addressesByChain || !activeByChain) return;
        const all = addressesByChain[chainId] || [];
        if (fromAddressId && all.some((a) => a.id === fromAddressId)) return;
        const funding = all.filter((a) => a.role !== 'dispenser');
        const picked = preferredSourceId(funding, activeByChain[chainId]) || funding[0]?.id || all[0]?.id;
        if (picked) setFromAddressId(picked);
    }, [addressesByChain, activeByChain, chainId, fromAddressId]);

    // Once the owner is known, sign from it whenever this wallet holds it:
    // it is the one address whose edit stays valid under owner-only edits.
    const ownerRecord = useMemo(() => {
        if (!owner || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.address === owner) || null;
    }, [owner, addressesByChain, chainId]);
    useEffect(() => {
        if (stage === 'compose' && ownerRecord) setFromAddressId(ownerRecord.id);
    }, [ownerRecord, stage]);
    const ownershipText = owner
        ? `List #${oldIndex} is owned by ${ownerText(owner)}, which is not an address in this wallet. This wallet cannot edit it.`
        : null;
    // Fork of a list this wallet does not own: no edit of it is valid from
    // here, so the fork is a new list (LIST format 0) of the resulting members,
    // owned by the From address.
    const forkCopy = mode === 'fork' && Boolean(owner) && Boolean(addressesByChain) && !ownerRecord;
    const ownershipReason = owner && !ownerRecord && !forkCopy ? ownershipText : null;
    // The user may pick another of this wallet's addresses as From; only the
    // owner can sign a valid edit, so any other pick carries the same blocker.
    const notOwnerPick = !forkCopy && owner && fromAddress && fromAddress.address !== owner ? ownershipText : null;

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    const coinTicker = descriptor ? TICKER_BY_COIN[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (LIST is quotable; both fork
    // legs are LIST creates so the opt-in rides both). Authoritative price
    // check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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

    // New items to add: same paste parsing as ListCreateForm/AirdropForm
    // for addresses, or the ProjectRosterForm-style tick split for ticks.
    // Anything already on the list is dropped (it's a member either way).
    const classifyEntries = useCallback((text) => {
        // A union's members are the action indexes of its source lists.
        if (isUnion) {
            const seen = new Set();
            const valid = [];
            const invalid = [];
            let duplicates = 0;
            for (const part of text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
                if (!/^[1-9][0-9]*$/.test(part)) { invalid.push(part); continue; }
                if (seen.has(part)) { duplicates += 1; continue; }
                seen.add(part);
                valid.push(part);
            }
            return { valid, invalid, duplicates, addressRefs: [] };
        }
        if (isTick) {
            const parsed = classifyTickItems(text, { coinQualified: tickCoinSupported });
            // Fork edit wire items use uppercase token normalization.
            return { ...parsed, valid: parsed.valid.map((item) => item.toUpperCase()) };
        }
        // Validate entries against the chain this fork is published
        // to, not just against address shape, so a wrong-network paste cannot
        // ride into the new list and be dropped by the indexer afterwards.
        const parts = airdropLib.parsePaste(text);
        return airdropLib.classifyRecipients(parts, {
            coin: descriptor?.coin || null,
            network: descriptor?.networkKind || null,
        }, { anyCoins });
    }, [isUnion, isTick, tickCoinSupported, descriptor?.coin, descriptor?.networkKind, anyCoins]);
    const additions = useMemo(() => classifyEntries(addText), [classifyEntries, addText]);

    const itemIdentity = useCallback((item) => {
        const value = String(item);
        if (isUnion) return value;
        if (isTick) return value.toLowerCase();
        // Match address case variants with the same rule the recipient parser uses.
        return airdropLib.bech32IdentityKey(value);
    }, [isUnion, isTick]);

    const currentItemKeys = useMemo(
        () => new Set(currentItems.map(itemIdentity)),
        [currentItems, itemIdentity],
    );
    const toAdd = useMemo(
        () => additions.valid.filter((item) => !currentItemKeys.has(itemIdentity(item))),
        [additions.valid, currentItemKeys, itemIdentity],
    );
    const alreadyPresent = additions.valid.length - toAdd.length;

    // Entries to remove: parsed like the Add field, each matched against the
    // list's own members. Anything not on the list is refused with a field
    // error, as is an entry that is also being added.
    // An entry the list really holds is removable even when it would fail the
    // Add field's shape check (the list is the authority on what it contains).
    const removals = useMemo(() => {
        const parsed = classifyEntries(removeText);
        const held = parsed.invalid.filter((v) => currentItemKeys.has(itemIdentity(v)));
        if (held.length === 0) return parsed;
        return { ...parsed, valid: [...parsed.valid, ...held], invalid: parsed.invalid.filter((v) => !held.includes(v)) };
    }, [classifyEntries, removeText, currentItemKeys, itemIdentity]);
    const toRemove = useMemo(() => {
        const wanted = new Set(removals.valid.map(itemIdentity));
        return currentItems.filter((i) => wanted.has(itemIdentity(i)));
    }, [currentItems, removals.valid, itemIdentity]);
    const removeFieldError = useMemo(() => {
        if (removals.invalid.length > 0) {
            return `Not a valid ${isUnion ? 'list index' : isTick ? 'token name' : 'address'}: ${removals.invalid.join(', ')}.`;
        }
        const notOnList = removals.valid.filter((v) => !currentItemKeys.has(itemIdentity(v)));
        if (notOnList.length > 0) {
            return `Not on list #${oldIndex}, so it cannot be removed: ${notOnList.join(', ')}.`;
        }
        const addKeys = new Set(additions.valid.map(itemIdentity));
        const both = removals.valid.filter((v) => addKeys.has(itemIdentity(v)));
        if (both.length > 0) {
            return `Also entered under Add: ${both.join(', ')}. Enter each only once.`;
        }
        return null;
    }, [removals, currentItemKeys, additions.valid, itemIdentity, isUnion, isTick, oldIndex]);

    const needsAdd = toAdd.length > 0;
    const needsRemove = toRemove.length > 0;
    // A copy is one transaction whatever it adds or removes.
    const twoPhase = needsAdd && needsRemove && !forkCopy;
    // The members a copy publishes: the kept ones, then the additions.
    const copyMembers = useMemo(
        () => [...currentItems.filter((i) => !toRemove.includes(i)), ...toAdd],
        [currentItems, toRemove, toAdd],
    );
    // Edit's name and description: a change to either is its own format 5
    // transaction, never ridden on a member edit.
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const detailsChanged = isEdit && (trimmedName !== '' || trimmedDescription !== '');
    const membersChanged = needsAdd || needsRemove;
    const detailsOnly = detailsChanged && !membersChanged;
    const nameError = isEdit && metaSupported === true ? editMetaFieldError('name', trimmedName) : null;
    const descriptionError = isEdit && metaSupported === true ? editMetaFieldError('description', trimmedDescription) : null;
    // A memo with no member change is one valid edit (the chain records a new
    // version of the list with the same members); a tester was refused it.
    // With a new name or description the memo rides that change instead.
    const memoOnly = !needsAdd && !needsRemove && memo.trim() !== '' && !detailsChanged;
    const firstTransactionLabel = twoPhase
        ? 'First transaction (add)'
        : needsRemove ? 'Fork transaction (remove)' : 'Fork transaction';

    // MEMO is optional and rides both legs; it sits before the ITEM tail.
    const trimmedMemo = memo.trim();
    const firstParams = useMemo(() => (forkCopy ? {
        VERSION: '0',
        TYPE: String(listType),
        ...(trimmedMemo ? { MEMO: trimmedMemo } : {}),
        ITEM: copyMembers,
    } : {
        VERSION: '1',
        EDIT: needsRemove && !needsAdd ? '2' : '1',
        LIST_ACTION_INDEX: String(oldIndex),
        ...(trimmedMemo ? { MEMO: trimmedMemo } : {}),
        ITEM: needsAdd ? toAdd : toRemove,
    }), [forkCopy, listType, copyMembers, needsAdd, toAdd, toRemove, oldIndex, trimmedMemo]);

    const secondParams = useMemo(() => ({
        VERSION: '1',
        EDIT: '2',
        LIST_ACTION_INDEX: intermediateIndex || '',
        ...(trimmedMemo ? { MEMO: trimmedMemo } : {}),
        ITEM: toRemove,
    }), [intermediateIndex, toRemove, trimmedMemo]);
    // Edit's name and description, the format 5 rename: '-' clears a field.
    const metaParams = useMemo(() => ({
        VERSION: '5',
        LIST_ACTION_INDEX: String(oldIndex),
        NAME: trimmedName,
        DESCRIPTION: trimmedDescription,
        MEMO: trimmedMemo,
    }), [oldIndex, trimmedName, trimmedDescription, trimmedMemo]);
    const firstActionSize = useMemo(
        () => listActionSize(firstParams),
        [firstParams],
    );
    const secondActionSize = useMemo(
        () => listActionSize(secondParams),
        [secondParams],
    );
    const secondReviewActionSize = useMemo(() => listActionSize({
        ...secondParams,
        // The first leg's index does not exist yet. Reserve a full uint64-width
        // decimal index so the add leg cannot strand an oversized remove leg.
        LIST_ACTION_INDEX: '9'.repeat(20),
    }), [secondParams]);
    const resultingCount = currentItems.length - toRemove.length + toAdd.length;
    const quoteActionString = !detailsChanged && (forkCopy ? copyMembers.length > 0 : (needsAdd || needsRemove || memoOnly))
        ? firstActionSize.actionString
        : null;
    const {
        quote: protocolFeeQuote, pending: protocolFeePending, waiting: protocolFeeWaiting,
    } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionString: quoteActionString,
        enabled: true,
    });
    const alreadyShared = useMemo(() => (
        (sharedRows || []).some((row) => isHomeRowForList(row, String(oldIndex), descriptor, chainId))
    ), [sharedRows, oldIndex, descriptor, chainId]);
    // Only a shared list's rename is quoted (the shared-list edit fee).
    const metaQuoteActionData = useMemo(() => {
        if (!isEdit) return undefined;
        const memoValid = !/[|;]/.test(memo) && !memoLengthError(trimmedMemo);
        if (!detailsOnly || !alreadyShared || !listActionIndexValid || metaSupported !== true || !fromAddress
            || nameError || descriptionError || !memoValid) return null;
        return { action: 'LIST', params: metaParams };
    }, [isEdit, memo, trimmedMemo, detailsOnly, alreadyShared, listActionIndexValid, metaSupported,
        fromAddress, nameError, descriptionError, metaParams]);
    const { quote: metaFeeQuote, pending: metaFeePending, waiting: metaFeeWaiting } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: metaQuoteActionData,
        enabled: isEdit,
    });
    // What this press costs is known before review (listFeeSchedule.js): a
    // fork copy is a new list and an edit of an unshared list is free; an
    // edit of a shared list pays the shared-edit base plus the per-item gas
    // for each member it adds or removes, priced from the chain's fee
    // schedule (read once per chain). Only an edit naming the shared list's
    // own index pays (actions/list/fees.js isListShared(LIST_ACTION_INDEX)),
    // so an add-then-remove's second transaction, which names the first
    // one's new index, is free: the fee is the first transaction's. The live
    // quote, which prices that same transaction, keeps the last word.
    const { schedule: feeSchedule, loading: feeScheduleLoading } = useFeeScheduleState({ messaging, chainId });
    const membersFee = useMemo(() => {
        if (forkCopy) return { free: true, quote: null };
        if (sharedRows === null) return null; // shared or not is still loading
        if (!alreadyShared) return { free: true, quote: null };
        const items = detailsOnly ? 0 : (needsAdd ? toAdd.length : toRemove.length);
        return { free: false, quote: listSharedEditFeeFromSchedule(feeSchedule, [items]) };
    }, [forkCopy, sharedRows, alreadyShared, detailsOnly, toAdd.length, toRemove.length,
        needsAdd, feeSchedule]);
    const liveQuote = detailsOnly ? metaFeeQuote : protocolFeeQuote;
    const livePending = detailsOnly ? metaFeePending : protocolFeePending;
    const liveWaiting = detailsOnly ? metaFeeWaiting : protocolFeeWaiting;
    const liveKnown = normalizeProtocolFee(liveQuote).known;
    /** @type {{ quote: any, pending: boolean, waiting?: boolean, free?: boolean }} */
    let membersFees;
    if (membersFee?.free) {
        membersFees = { quote: liveQuote, pending: false, free: true };
    } else if (membersFee?.quote && !liveKnown) {
        membersFees = { quote: membersFee.quote, pending: false };
    } else if (!liveKnown && (membersFee === null || feeScheduleLoading)) {
        // The shared state or the schedule is still on its way.
        membersFees = { quote: null, pending: true };
    } else {
        membersFees = { quote: liveQuote, pending: livePending, waiting: liveWaiting };
    }
    const metaLane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: fromAddress,
        software: 'createList',
        hardware: 'createListHw',
    });

    const firstDecoded = useMemo(() => (
        stage === 'review-1' || stage === 'wait-index'
            ? decoderLib.decodeAction({ action: 'LIST', params: firstParams, chainId: chainId || undefined, chainRegistry })
            : null
    ), [stage, firstParams, chainId]);

    const secondDecoded = useMemo(() => (
        stage === 'review-2'
            ? decoderLib.decodeAction({ action: 'LIST', params: secondParams, chainId: chainId || undefined, chainRegistry })
            : null
    ), [stage, secondParams, chainId]);
    const firstLegacyDecoded = useMemo(() => (firstDecoded ? {
        ...firstDecoded,
        warnings: [
            ...(firstDecoded.warnings || []),
            ...(twoPhase ? ['This edit uses two transactions. Approve this add first, then approve the remove after the add is indexed.'] : []),
        ],
    } : null), [firstDecoded, twoPhase]);
    const memberQuotedProtocolFee = normalizeProtocolFee(membersFees.quote);
    const firstLegacyComposed = useMemo(() => (firstLegacyDecoded ? {
        action: 'LIST',
        chainId,
        decoded: firstLegacyDecoded,
        quote: membersFees.quote,
        protocolFeeKnownFree: Boolean(membersFees.free)
            || (memberQuotedProtocolFee.known && memberQuotedProtocolFee.free),
    } : null), [chainId, firstLegacyDecoded, memberQuotedProtocolFee.free,
        memberQuotedProtocolFee.known, membersFees.free, membersFees.quote]);
    const secondLegacyComposed = useMemo(() => (secondDecoded ? {
        action: 'LIST',
        chainId,
        decoded: secondDecoded,
        protocolFeeKnownFree: true,
    } : null), [chainId, secondDecoded]);

    function sourceDescriptor() {
        return {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
    }

    // §5.6: BOTH fork legs sign through the shared confirm lane, the way
    // the create body and AirdropForm's LIST leg already do. Migrating one
    // leg and not the other would leave the form half legacy, which is the
    // drift this migration exists to end.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'createList',
        hardware: 'createListHw',
    });

    /**
     * Compose one leg host-side, approve it on the shared confirm page, and
     * sign those exact bytes. `onBroadcast` carries the leg's own
     * post-broadcast bookkeeping, which the shared screen knows nothing of.
     *
     * @param {object} params            wire params for this leg
     * @param {(res: any) => void} onBroadcast
     */
    async function runLegThroughConfirm(params, onBroadcast) {
        const from = sourceDescriptor();
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LIST', params },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId, chainId, from, params,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            // Signed but never broadcast: the next leg is keyed on this
            // one's action index, so the chain cannot continue and telling
            // the user it did would be the worse of the two wrong answers.
            if (res?.queued) { setQueuedResult(res); return; }
            onBroadcast(res);
        } catch (err) {
            if (isUserRejection(err)) return;
            setSubmitError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || cfg.failText,
            }));
        }
    }

    /**
     * Re-read the list and say so when its members differ from the ones this
     * screen was opened with, else null. The network applies the edit to the
     * list's newest valid edit at that moment, so a change made in between
     * would be carried into this edit without the user ever seeing it.
     * An unreadable list blocks review because the form cannot establish the
     * membership that this edit will change.
     *
     * @returns {Promise<string | null>}
     */
    async function membershipChangedMessage() {
        if (typeof messaging.getListByActionIndex !== 'function') return null;
        let fresh;
        try {
            // Fresh, so the screen's own read of the list never answers this check.
            fresh = currentListItems(await messaging.getListByActionIndex({
                chainId, actionIndex: String(oldIndex), fresh: true,
            }));
        } catch (err) {
            return explorerReadFailure(err, `check list #${oldIndex}`)?.message
                || `Couldn't check list #${oldIndex}. Try again.`;
        }
        if (!Array.isArray(fresh)) return null;
        const asKey = (xs) => xs.map(String).sort().join('\n');
        if (asKey(fresh) === asKey(currentItems)) return null;
        return `List #${oldIndex} changed since this screen loaded: it now has ${fresh.length} member${fresh.length === 1 ? '' : 's'}, not ${currentItems.length}. `
            + 'Go back and open the list again so this edit starts from its current members.';
    }

    /**
     * Edit's name and description: one format 5 transaction through the
     * owner-action lane, after the same owner recheck the members take.
     */
    async function publishDetails() {
        if (metaSupported !== true) {
            setFormError(metaSupported === 'error' ? cfg.sdkCheckFailedReason : cfg.sdkReason);
            return;
        }
        if (nameError || descriptionError) { setFormError('Fix the list name and description first.'); return; }
        if (/[|;]/.test(memo)) { setFormError('Memo cannot contain | or ; characters.'); return; }
        const memoTooLong = memoLengthError(trimmedMemo);
        if (memoTooLong) { setFormError(memoTooLong); return; }
        if (metaInFlightRef.current) return;
        metaInFlightRef.current = true;
        setFormError(null);
        try {
            if (typeof owner === 'string' && owner) {
                const ownerCheck = await recheckListOwner({
                    readList: (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex }),
                    actionIndex: String(oldIndex),
                    owner,
                });
                if (!ownerCheck.ok) {
                    setOwner(ownerCheck.owner);
                    setFormError(ownerCheck.message);
                    return;
                }
            }
            const feeOpts = feePerKb != null ? { feePerKb } : {};
            const next = await metaLane.run({
                actionData: { action: 'LIST', params: metaParams },
                encoderOpts: { payFeeInNativeCoin: nativeFee.flag || undefined, ...feeOpts },
                submitExtra: { params: metaParams, payFeeInNativeCoin: nativeFee.flag, ...feeOpts },
            });
            setMetaResult(next || {});
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || cfg.metaFailText,
            }));
        } finally {
            metaInFlightRef.current = false;
        }
    }

    async function handleReview(event) {
        event.preventDefault();
        // Each attempt reopens the section holding the error; a
        // custom fee stop opens the Network fee row even when the fee field
        // shows the error itself.
        setReviewAttempt((n) => n + 1);
        setFeeStopped(false);
        if (!listActionIndexValid) { setFormError('List reference must be a positive whole number.'); return; }
        if (ownershipReason) { setFormError(ownershipReason); return; }
        if (notOwnerPick) { setFormError(notOwnerPick); return; }
        if (!fromAddress) { setFormError('No signing address available on this network.'); return; }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        setFeeStopped(Boolean(feeStop));
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (removeFieldError) { setFormError(removeFieldError); return; }
        if (additions.invalid.length > 0) {
            const noun = isUnion
                ? (additions.invalid.length === 1 ? 'list index' : 'list indexes')
                : isTick
                ? (additions.invalid.length === 1 ? 'token name' : 'token names')
                : (additions.invalid.length === 1 ? 'address' : 'addresses');
            setFormError(`Remove ${additions.invalid.length} invalid ${noun} before reviewing.`);
            return;
        }
        // No invented combined transaction: the members and the name or
        // description are two transactions, published one at a time.
        if (detailsChanged && membersChanged) {
            setFormError('Publish one change at a time: change the members, or the name and description, then publish the other as a second edit.');
            return;
        }
        if (detailsOnly) { await publishDetails(); return; }
        if (forkCopy && copyMembers.length === 0) {
            setFormError('Nothing to fork: keep or add at least one member.');
            return;
        }
        if (!forkCopy && !needsAdd && !needsRemove && !memoOnly) {
            setFormError(isEdit
                ? 'No change entered. Add or remove a member, change the name or description, or write a memo.'
                : 'Nothing changed: add or remove an item, or write a memo.');
            return;
        }
        // Verify no pipe or semicolon in MEMO (both are protocol delimiters)
        if (/[|;]/.test(memo)) { setFormError('Memo cannot contain | or ; characters.'); return; }
        // Verify MEMO fits the chain's length limit, measured as sent (trimmed)
        const memoTooLong = memoLengthError(trimmedMemo);
        if (memoTooLong) { setFormError(memoTooLong); return; }
        const sizeError = listActionSizeError(firstActionSize)
            || (twoPhase ? listActionSizeError(secondReviewActionSize) : null);
        if (sizeError) { setFormError(sizeError); return; }
        // Verify the list has not changed since this screen loaded it
        const changed = await membershipChangedMessage();
        if (changed) { setFormError(changed); return; }
        setFormError(null);
        if (singleEncode) {
            await signFirst();
            return;
        }
        setStage('review-1');
    }

    async function signFirst(sharedApproved = false) {
        // Verify again at signing: the list may have changed while this sat on review
        const changed = await membershipChangedMessage();
        if (changed) { setSubmitError(changed); return; }
        if (singleEncode && !sharedApproved) {
            await runLegThroughConfirm(firstParams, (res) => {
                const txid = res?.txid || res?.broadcast?.txid;
                if (!txid) throw new Error('List fork broadcast did not return a txid.');
                setTx1Txid(txid);
                setPassword('');
                setStage(twoPhase ? 'wait-index' : 'repoint');
            });
            return;
        }
        try {
            const from = sourceDescriptor();
            const base = { walletId, chainId, from, params: firstParams, payFeeInNativeCoin: nativeFee.flag, ...(feePerKb != null ? { feePerKb } : {}) };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    actionData: { action: 'LIST', params: firstParams },
                });
            } else {
                res = hw
                    ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                    : await messaging.createList({ ...base, password });
            }
            const txid = res?.txid || res?.broadcast?.txid;
            if (isWatcherMode) {
                // A watcher wallet can only build this leg unsigned; the
                // two-leg fork's index-wait needs a Full-mode wallet to
                // finish, same limitation as Airdrop/ProjectRoster.
                setSubmitError(null);
                setTx1Txid(null);
                setStage('repoint');
                setPassword('');
                return;
            }
            if (!txid) throw new Error('List fork broadcast did not return a txid.');
            setTx1Txid(txid);
            setPassword('');
            setStage(twoPhase ? 'wait-index' : 'repoint');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || cfg.failText,
            }));
            if (!hw && !isWatcherMode) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    async function handleSignFirst(event, sharedApproved = false) {
        event.preventDefault();
        if (submitting || firstLegInFlightRef.current) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        firstLegInFlightRef.current = true;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await signFirst(sharedApproved);
        } finally {
            firstLegInFlightRef.current = false;
            setSubmitting(false);
        }
    }

    async function handleSignSecond(event, sharedApproved = false) {
        event.preventDefault();
        if (submitting || secondLegInFlightRef.current || !intermediateIndex) return;
        const sizeError = listActionSizeError(secondActionSize);
        if (sizeError) { setSubmitError(sizeError); return; }
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        secondLegInFlightRef.current = true;
        setSubmitting(true);
        setSubmitError(null);
        try {
            if (singleEncode && !sharedApproved) {
                await runLegThroughConfirm(secondParams, (res) => {
                    const txid = res?.txid || res?.broadcast?.txid;
                    if (!txid) throw new Error('List fork broadcast did not return a txid.');
                    setTx2Txid(txid);
                    setPassword('');
                    setStage('repoint');
                });
                return;
            }
            const from = sourceDescriptor();
            const base = { walletId, chainId, from, params: secondParams, payFeeInNativeCoin: nativeFee.flag, ...(feePerKb != null ? { feePerKb } : {}) };
            const res = hw
                ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.createList({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('List fork broadcast did not return a txid.');
            setTx2Txid(txid);
            setPassword('');
            setStage('repoint');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || cfg.failText,
            }));
            if (!hw) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        } finally {
            secondLegInFlightRef.current = false;
            setSubmitting(false);
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review-1' ? 'Review List Edit'
                : stage === 'wait-index' ? 'Waiting for Fork to Be Indexed'
                    : stage === 'review-2' ? 'Review Remove'
                        : stage === 'repoint' ? 'Edit Published'
                            : cfg.title}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={stage !== 'review-1' && stage !== 'review-2'}>{children}</Screen>
    );

    // The name and description's own confirm page (the owner-action lane).
    if (metaLane.open) {
        return (
            <ActionConfirmScreen
                {...metaLane.confirmProps}
                summary={{
                    verb: t('components.confirmSummary.verbRenameList'),
                    target: listLabel(String(oldIndex), listDetail?.name),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                walletId={walletId}
                screenVariant={variant}
                feeEstimate={feeEstimate}
                chainLabel={null}
                chainId={chainId}
                coinTicker={coinTicker}
                signerReady={signerReady}
                credentialsReady={metaLane.hw
                    ? metaLane.confirmProps.hwStatus === 'available'
                    : (signerReady || metaLane.confirmProps.password.length > 0)}
                hintClassName={styles.hint}
            />
        );
    }

    // The load error, the loading line, the ownership warning and the
    // non-signing stages lay out through FormPage like the form itself, so no
    // state draws straight into Screen. None of them submits anything, so each
    // is the div form of the template. The load error is the template's body,
    // not its status slot, so it draws its own box and the shell's
    // "Some balances may be out of date" steps aside: one message per page.
    if (loadError) {
        return wrap(
            <FormPage as="div" label={cfg.formLabel}>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </FormPage>,
        );
    }
    if (!addressesByChain || owner === undefined || (!itemsSupplied && !loadedList)
        || (isEdit && (metaSupported === null || sharedRows === null))) {
        return wrap(<FormPage as="div" label={cfg.formLabel}><p className={styles.hint}>Loading…</p></FormPage>);
    }
    if (ownershipReason) {
        return wrap(
            // The Action field stays, so a list the wallet cannot edit can
            // still switch to Fork (a fork of its own) or Create.
            <FormPage as="div" label={cfg.formLabel} status={<StatusMessage variant="warning">{ownershipReason}</StatusMessage>}>
                {actionField}
            </FormPage>,
        );
    }

    // Edit's name and description result.
    if (metaResult) {
        // Signed but held in the broadcast queue: nothing is on the network yet.
        if (metaResult.queued) return wrap(<ResultScreen state="signed-not-broadcast" onDone={onDone} what={cfg.metaResultWhat} unsaved={metaResult.unsaved} />);
        if (metaResult.psbtHex && !metaResult.txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={metaResult}
                    onBuildAnother={() => setMetaResult(null)}
                    onDone={onDone}
                />,
            );
        }
        return wrap(
            <FormPage
                as="div"
                label={cfg.formLabel}
                title="List rename submitted"
                headingAs="h2"
                actions={<Button type="button" variant="success" icon={<Icon.CheckIcon />} onClick={onDone}>Done</Button>}
            >
                <p className={styles.hint}>The new list details appear when this transaction confirms.</p>
                {metaResult.txid ? (
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Transaction ID</dt>
                        <dd className={styles.detailsValue}><code className={styles.txid}>{String(metaResult.txid)}</code></dd>
                    </dl>
                ) : null}
            </FormPage>,
        );
    }

    // A leg signed but not broadcast stops the chain: the shared panel
    // says so and deliberately offers no retry (re-signing while a signed
    // copy is queued is the double-broadcast trap).
    if (queuedResult) {
        return wrap(
            <ResultScreen state="signed-not-broadcast" onDone={onBack} what={cfg.resultWhat} unsaved={queuedResult.unsaved} />,
        );
    }

    // Confirm page for whichever leg is in flight, rendered in place of the
    // review stage; the stage machine stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: mode === 'fork'
                        ? t('components.confirmSummary.verbForkList')
                        : t('components.confirmSummary.verbEditList'),
                    target: listName ? listLabel(oldIndex, listName) : `#${oldIndex}`,
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: stage === 'review-2' ? [
                        ...(listName ? [{ label: 'List', value: listLabel(intermediateIndex, listName) }] : []),
                        { label: 'Removing', value: `${toRemove.length} item${toRemove.length === 1 ? '' : 's'}` },
                        { label: 'Members after edit', value: String(resultingCount) },
                        { label: 'Action size', value: `${secondActionSize.compiledBytes.toLocaleString('en-US')} / ${secondActionSize.maxBytes.toLocaleString('en-US')} bytes` },
                    ] : [
                        ...(listName ? [{ label: 'List', value: listLabel(oldIndex, listName) }] : []),
                        ...(memoOnly ? [{ label: 'Members', value: `Unchanged (${currentItems.length})` }] : []),
                        ...(needsAdd ? [{ label: 'Adding', value: `${toAdd.length} item${toAdd.length === 1 ? '' : 's'}` }] : []),
                        ...(needsRemove ? [{ label: 'Removing', value: `${toRemove.length} item${toRemove.length === 1 ? '' : 's'}` }] : []),
                        ...(!memoOnly ? [{ label: 'Members after edit', value: String(resultingCount) }] : []),
                        { label: 'Action size', value: `${firstActionSize.compiledBytes.toLocaleString('en-US')} / ${firstActionSize.maxBytes.toLocaleString('en-US')} bytes` },
                    ],
                }}
                screenVariant={variant}
                chainLabel={null}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                coinTicker={coinTicker || ''}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'repoint') {
        return wrap(
            <FormPage
                as="div"
                label="Edit published"
                actions={<Button variant="success" icon={<Icon.CheckIcon />} onClick={onDone}>Done</Button>}
            >
                <h2 className={styles.successTitle}>Fork submitted</h2>
                {tx1Txid ? (
                    <>
                        <p className={styles.successLabel}>{firstTransactionLabel}</p>
                        <code className={styles.txid}>{tx1Txid}</code>
                    </>
                ) : null}
                {tx2Txid ? (
                    <>
                        <p className={styles.successLabel}>Second transaction (remove)</p>
                        <code className={styles.txid}>{tx2Txid}</code>
                    </>
                ) : null}
                {forkCopy ? (
                    <p className={styles.hint}>
                        Your fork is a new list owned by your From address. It gets its
                        own index once indexed (check My Lists to find it); list
                        #{oldIndex} itself is unchanged.
                    </p>
                ) : resolution === true ? (
                    <p className={styles.hint}>
                        Once indexed, this edit is list #{oldIndex}&apos;s current
                        membership: every gate, dispenser, order, airdrop and
                        callback that references #{oldIndex} uses it. The edit
                        also has its own index, shown in My Lists.
                    </p>
                ) : resolution === false ? (
                    <p className={styles.hint}>
                        This fork gets a brand-new list index once indexed (check My
                        Lists to find it). List #{oldIndex} itself is unchanged and
                        keeps working exactly as before.
                    </p>
                ) : (
                    <p className={styles.hint}>
                        This edit gets its own index once indexed (check My Lists
                        to find it). Where list-edit resolution is active, everything
                        that references #{oldIndex} uses the edited membership;
                        before that, #{oldIndex} keeps its old membership until each
                        consumer is repointed.
                    </p>
                )}

                {resolution === true || forkCopy ? null : (
                    <>
                        <h3 className={styles.successLabel}>Now referenced by</h3>
                        <p className={styles.hint}>
                            Every gate, dispenser, and order that references list #{oldIndex} keeps using its
                            membership until someone repoints it at the new fork. Repoint from each consumer&apos;s
                            own edit screen:
                        </p>
                        <ul className={styles.detailsList} style={{ display: 'block', listStyle: 'none' }}>
                            {REPOINT_TARGETS.map((target) => {
                                const open = target.built ? repoint[target.id] : undefined;
                                return (
                                    <li key={target.id} style={{ padding: '4px 0' }}>
                                        <Button type="button" variant="ghost" icon={<Icon.TokenListIcon />} disabled={!open} onClick={open}>
                                            {target.label}
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                        <StatusMessage variant="warning" role="alert">
                            <p>
                                {resolution === false
                                    ? `List #${oldIndex} stays live everywhere it is referenced until you repoint each consumer by hand. The wallet has no way to confirm whether that has happened, so this warning shows regardless of what you do next.`
                                    : `Unless list-edit resolution is active on this network, list #${oldIndex} stays live everywhere it is referenced until you repoint each consumer by hand.`}
                            </p>
                        </StatusMessage>
                    </>
                )}
            </FormPage>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <FormPage
                as="div"
                label="Waiting for fork to be indexed"
                actions={<Button variant="ghost" icon={<Icon.XIcon />} onClick={onBack}>Close (Keep Waiting)</Button>}
            >
                <p className={styles.summary}>{firstDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>{firstTransactionLabel}</dt>
                    <dd className={styles.detailsValue}><code className={styles.txid}>{tx1Txid}</code></dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>{minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}</dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the add-transaction to be indexed so the
                    remove-transaction can reference its new list index. Safe to
                    close the wallet; the add is already on-chain, and you can
                    finish the remove step later from My Lists.
                </p>
                {slow ? (
                    <p className={styles.hint}>This is taking longer than usual. Typical wait is 1-2 block confirmations.</p>
                ) : null}
            </FormPage>,
        );
    }

    if (stage === 'review-2' && fromAddress) {
        return (
            <ConfirmActionModal
                phase={submitting ? 'signing' : 'ready'}
                composed={secondLegacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={!submitting}
                onApprove={() => handleSignSecond({ preventDefault() {} }, true)}
                onReject={onBack}
                decoded={secondDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress.address}
                nativeTicker={coinTicker}
                credentialsReady={hw ? hwStatus === 'available' : (signerReady || password.length > 0)}
                credentials={(
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(value) => { setPassword(value); if (submitError) setSubmitError(null); }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                summary={{
                    verb: t('components.confirmSummary.verbEditList'),
                    target: listName ? listLabel(intermediateIndex, listName) : `List #${intermediateIndex}`,
                    direction: 'none',
                    chainId,
                    address: fromAddress.address,
                    facts: [
                        { label: 'Removing', value: `${toRemove.length} item${toRemove.length === 1 ? '' : 's'}` },
                        { label: 'Members after edit', value: String(resultingCount) },
                        { label: 'Action size', value: `${secondActionSize.compiledBytes.toLocaleString('en-US')} / ${secondActionSize.maxBytes.toLocaleString('en-US')} bytes` },
                    ],
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    if (stage === 'review-1' && fromAddress) {
        if (isWatcherMode && twoPhase) {
            return wrap(
                <FormPage
                    as="div"
                    label="Not available when another phone signs"
                    actions={<Button variant="ghost" icon={<Icon.BackIcon />} onClick={() => setStage('compose')}>Back</Button>}
                >
                    <h2 className={styles.successTitle}>Not available when another phone signs</h2>
                    <p className={styles.hint}>
                        Adding and removing in the same fork is two chained
                        transactions: the wallet has to see the add land on-chain
                        before it can build the remove. Another phone signs for
                        this wallet, so it can't see that, and this combination
                        can't be split across two phones today.
                    </p>
                    <p className={styles.hint}>
                        Use a wallet that signs on this device, or fork with only
                        an add or only a remove (each of those is a single
                        transaction and works when another phone signs).
                    </p>
                </FormPage>,
            );
        }
        return (
            <ConfirmActionModal
                phase={submitting ? 'signing' : 'ready'}
                composed={firstLegacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={!submitting}
                onApprove={() => handleSignFirst({ preventDefault() {} }, true)}
                onReject={() => { setSubmitError(null); setStage('compose'); }}
                decoded={firstLegacyDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress.address}
                nativeTicker={coinTicker}
                credentialsReady={isWatcherMode || (hw ? hwStatus === 'available' : (signerReady || password.length > 0))}
                credentials={isWatcherMode ? (
                    <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(value) => { setPassword(value); if (submitError) setSubmitError(null); }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                summary={{
                    verb: mode === 'fork'
                        ? t('components.confirmSummary.verbForkList')
                        : t('components.confirmSummary.verbEditList'),
                    target: listLabel(oldIndex, listName),
                    direction: 'none',
                    chainId,
                    address: fromAddress.address,
                    facts: [
                        ...(listName ? [{ label: 'List', value: listLabel(oldIndex, listName) }] : []),
                        ...(memoOnly ? [{ label: 'Members', value: `Unchanged (${currentItems.length})` }] : []),
                        ...(needsAdd ? [{ label: 'Adding', value: `${toAdd.length} item${toAdd.length === 1 ? '' : 's'}` }] : []),
                        ...(needsRemove ? [{ label: 'Removing', value: `${toRemove.length} item${toRemove.length === 1 ? '' : 's'}` }] : []),
                        ...(!memoOnly ? [{ label: 'Members after edit', value: String(resultingCount) }] : []),
                        { label: 'Action size', value: `${firstActionSize.compiledBytes.toLocaleString('en-US')} / ${firstActionSize.maxBytes.toLocaleString('en-US')} bytes` },
                    ],
                    ...(!nativeFee.flag && memberQuotedProtocolFee.known ? {
                        protocolFee: {
                            amount: memberQuotedProtocolFee.free ? '0' : String(memberQuotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // stage === 'compose'
    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); setFormError(null); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    const itemNoun = isUnion ? 'source list index' : isTick ? 'token' : 'address';
    const resolutionHelp = forkCopy
        ? `You do not own list #${oldIndex}, so the fork is a new list of these members, owned by your From address; #${oldIndex} itself never changes.`
        : resolution === true
        ? `This edit becomes list #${oldIndex}'s current membership: everything that references #${oldIndex} will use it once it is indexed.`
        : resolution === false
            ? `This publishes a new list at a new index; #${oldIndex} itself never changes.`
            : `This publishes an edit at a new index. Where list-edit resolution is active, everything that references #${oldIndex} follows it; before that, #${oldIndex} keeps its old membership.`;
    const addHelp = `Enter one ${itemNoun} per line. ${resolutionHelp}`
        + (isTick || isUnion ? '' : ' Added addresses become permanent public on-chain data once the fork is published, the same as creating a new list.');
    const entriesLabel = isUnion ? 'Source lists' : isTick ? 'Tokens' : 'Addresses';
    const removeHelp = `Enter one ${itemNoun} per line, or separate them with commas. Each must already be on list #${oldIndex}; it is removed when you publish the edit.`;

    // Which section holds the form error, so that section reopens on
    // every Publish attempt even after the user closed it.
    const errorSection = feeStopped ? 'fee'
        : !formError ? null
            : /^(Nothing changed|No change entered|Publish one change)/i.test(formError) ? 'edit'
                : /memo/i.test(formError) ? 'memo'
                    : /signing address|is owned by/i.test(formError) ? 'from'
                        : isEdit && /name and description|list rename|renaming lists/i.test(formError) ? 'details'
                            : 'edit';
    const sectionErrorKey = (id) => (errorSection === id ? reviewAttempt + 1 : 0);
    const detailsDisabled = metaSupported !== true;
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={cfg.formLabel}
            onSubmit={handleReview}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            noValidate
            status={[formError
                ? <StatusMessage key="error" variant="error">{formError}</StatusMessage>
                : notOwnerPick ? <StatusMessage key="owner" variant="warning">{notOwnerPick}</StatusMessage> : null]}
            action={(
                <FormAction
                    icon={<Icon.UploadIcon />}
                    loading={metaLane.composing}
                    disabled={metaLane.composing}
                >
                    {/* Edit names what a watcher wallet makes, as Rename did;
                        Fork keeps its label and names it on its review page. */}
                    {isEdit && isWatcherMode
                        ? 'Create Unsigned Transaction'
                        : isEdit && !detailsChanged
                            ? (direction === 'remove' ? 'Remove from List' : 'Add to List')
                            : cfg.actionLabel}
                </FormAction>
            )}
            /* From (closed) holds the list's locked network and the
               signing address, which starts as the owner's. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={t('routes.listFork.networkHelp')}
                    address={fromAddress?.address || null}
                    addressLabel="From"
                    addressHelp={forkCopy
                        ? 'The address that publishes your fork and pays its fee. It becomes the owner of the new list.'
                        : "Only the list's owner can edit it, and the network refuses an edit signed from any other address. This starts as the owner's address."}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                />
            )}
            /* The one Fees section: the speed slider, the network and
               protocol fee lines and the native-fee switch. A name and
               description change quotes its own format 5 action. */
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                    // A name and description change on an unshared list pays no
                    // protocol fee, so it shows no fee lines (as Rename did).
                    fees={detailsOnly && !alreadyShared ? undefined : {
                        ...membersFees,
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker },
                    }}
                />
            )}
        >
            <FormSection
                id="edit"
                title="List Edit"
                icon={Icon.TokenListIcon}
                {...formSections.bind('edit')}
                revealKey={sectionErrorKey('edit')}
                summary={joinSummary(`List #${oldIndex}`, `${toAdd.length} to add`, `${toRemove.length} to remove`)}
            >
            {actionField}
            {/* Edit and Fork share one entries control: one direction per
                press, Add or Remove, over one field of entries. */}
            <SegmentedControl
                aria-label="Change type"
                value={direction}
                onChange={changeDirection}
                items={[
                    { id: 'add', label: <><Icon.PlusIcon aria-hidden="true" /><span>Add</span></> },
                    { id: 'remove', label: <><Icon.TrashIcon aria-hidden="true" /><span>Remove</span></> },
                ]}
            />
            <Textarea
                id="fork-items"
                label={entriesLabel}
                help={direction === 'remove' ? removeHelp : addHelp}
                value={direction === 'remove' ? removeText : addText}
                onChange={(e) => (direction === 'remove' ? setRemoveText(e.target.value) : setAddText(e.target.value))}
                rows={6}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize={isTick ? 'characters' : 'off'}
                autoCorrect="off"
                aria-required="false"
                error={direction === 'remove' ? removeFieldError : undefined}
            />
            <p className={styles.hint}>
                {direction === 'remove' ? `${toRemove.length} to remove` : `${toAdd.length} to add`}
                {removals.duplicates > 0 ? ` · ${removals.duplicates} duplicate${removals.duplicates === 1 ? '' : 's'} removed` : ''}
                {additions.duplicates > 0 ? ` · ${additions.duplicates} duplicate${additions.duplicates === 1 ? '' : 's'} removed` : ''}
                {alreadyPresent > 0 ? ` · ${alreadyPresent} already on the list` : ''}
                {additions.invalid.length > 0 ? ` · ${additions.invalid.length} invalid` : ''}
                {toRemove.length + toAdd.length === 0 ? ' (no changes yet)' : ''}
            </p>
            {additions.invalid.length > 0 ? (
                <FieldNote variant="warning" role="alert">
                    Invalid {isUnion ? 'list indexes' : isTick ? 'token names' : 'addresses'}: {additions.invalid.join(', ')}
                    {/* Say why a ^<index> address reference is in that list: it is not a typo. */}
                    {!isTick && additions.addressRefs?.length > 0
                        ? ` ${addressReferenceNote(additions.addressRefs.length)}`
                        : null}
                </FieldNote>
            ) : null}
            {/* The action size describes the edit, so it closes the Edit section. */}
            {reachedEightyPercent(firstActionSize.compiledBytes, firstActionSize.maxBytes) ? (
                <p className={styles.hint}>
                    Action size: {formatBytes(firstActionSize.compiledBytes)} of {formatBytes(firstActionSize.maxBytes)}.
                </p>
            ) : null}
            </FormSection>

            {/* Edit's name and description: their own format 5 transaction,
                so the section says what the list carries today. */}
            {isEdit ? (
                <FormSection
                    id="details"
                    title="Details"
                    icon={Icon.DocumentIcon}
                    optional
                    {...formSections.bind('details')}
                    revealKey={sectionErrorKey('details')}
                    summary={joinSummary(
                        trimmedName ? `name ${trimmedName === '-' ? 'cleared' : trimmedName}` : null,
                        trimmedDescription ? `description ${trimmedDescription === '-' ? 'cleared' : 'changed'}` : null,
                    ) || 'Unchanged'}
                >
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Current name</dt>
                        <dd className={styles.detailsValue}>
                            {listDetail?.name ? neutralizeControlText(listDetail.name) : 'Not set'}
                        </dd>
                        <dt className={styles.detailsLabel}>Current description</dt>
                        <dd className={styles.detailsValue}>
                            {listDetail?.description ? neutralizeControlText(listDetail.description) : 'Not set'}
                        </dd>
                    </dl>
                    {metaSupported === false ? (
                        <FieldNote variant="warning">{cfg.sdkReason}</FieldNote>
                    ) : null}
                    {metaSupported === 'error' ? (
                        <FieldNote variant="warning">{cfg.sdkCheckFailedReason}</FieldNote>
                    ) : null}
                    {alreadyShared ? (
                        <p className={styles.hint}>Renaming this shared list pays the shared-list edit fee.</p>
                    ) : null}
                    <Input
                        label="Name"
                        help={`Leave this empty to keep the current name. The X sets the name to nothing on the chain. The name is public and can be at most ${LIST_META_NAME_MAX_BYTES} bytes. A new name is its own transaction, published apart from a member change.`}
                        counter={`${utf8ByteLength(trimmedName)} / ${LIST_META_NAME_MAX_BYTES} bytes`}
                        error={nameError || undefined}
                        value={name}
                        onChange={(event) => { setName(event.target.value); setFormError(null); }}
                        clearable
                        onClear={() => { setName(name === '-' ? '' : '-'); setFormError(null); }}
                        autoComplete="off"
                        disabled={detailsDisabled}
                    />
                    <Textarea
                        label="Description"
                        help={`Leave this empty to keep the current description. The X sets the description to nothing on the chain. The description is public and can be at most ${LIST_META_DESCRIPTION_MAX_BYTES} bytes.`}
                        counter={`${utf8ByteLength(trimmedDescription)} / ${LIST_META_DESCRIPTION_MAX_BYTES} bytes`}
                        error={descriptionError || undefined}
                        value={description}
                        onChange={(event) => { setDescription(event.target.value.replace(/[\r\n]+/g, ' ')); setFormError(null); }}
                        clearable
                        onClear={() => { setDescription(description === '-' ? '' : '-'); setFormError(null); }}
                        autoGrow
                        maxRows={3}
                        autoComplete="off"
                        disabled={detailsDisabled}
                    />
                </FormSection>
            ) : null}

            {/* Memo is its own optional section, closed until used, holding
                only the memo: the title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                summary={trimmedMemo || 'None'}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}

// ---------------------------------------------------------------------------
// Share: LIST format 2, through the owner-action lane.
// ---------------------------------------------------------------------------

/**
 * Share an existing token or address list with LIST format 2.
 *
 * @param {object} props
 * @param {typeof LIST_ACTIONS.share} props.cfg
 * @param {string} props.walletId
 * @param {{ chainId: string, actionIndex: string | number }} props.listRef
 * @param {import('react').ReactNode} props.actionField
 * @param {SharedListFields} [props.shared]
 * @param {(values: SharedListFields) => void} [props.onSharedChange]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
function ListShareBody({ cfg, walletId, listRef, actionField = null, shared, onSharedChange, onBack, onDone = onBack }) {
    const chainId = listRef.chainId;
    const listActionIndex = String(listRef.actionIndex);
    const listActionIndexValid = /^[1-9][0-9]*$/.test(listActionIndex);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);
    const descriptor = chainRegistry.get(chainId);
    const coinTicker = TICKER_BY_COIN[descriptor?.coin] || '';
    const signerReady = useSignerReady(walletId);
    const nativeFee = useNativeFee(coinTicker);
    // Speed and Fees is the standard slider (G20, G113): the share is an
    // ordinary transaction whose network fee sets how fast it confirms, and
    // the pick rides the lane as feePerKb, as Edit's does.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const [feeStopped, setFeeStopped] = useState(false);
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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
    // Sharing is one flat fee (GAS_SCHEDULE.LIST_SHARE), so the form prices
    // it from the chain's fee schedule the moment it opens, read once per
    // chain; the fiat value comes from the same price source the Fees section
    // uses, read once here and handed to it.
    const { schedule: feeSchedule, loading: feeScheduleLoading } = useFeeScheduleState({ messaging, chainId });
    const scheduleShareFee = useMemo(() => listShareFeeFromSchedule(feeSchedule), [feeSchedule]);
    const { settings } = useSettings();
    const feeFiat = useFeeFiat({
        chainId,
        chainCoin: descriptor?.coin,
        nativeTicker: protocolCoinTickerFor(descriptor),
        settings,
    });

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [detail, setDetail] = useState(/** @type {any | null} */ (null));
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [sharedRows, setSharedRows] = useState(/** @type {any[] | null} */ (null));
    const [sdkSupported, setSdkSupported] = useState(/** @type {boolean | 'error' | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [memo, setMemo] = useState(shared?.memo || '');
    const [selectedFromAddress, setSelectedFromAddress] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const formErrors = useFormErrors();
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const submitInFlightRef = useRef(false);
    // The standard sections' open state, held above the picker
    // early returns so it survives them; a counter of Share attempts reopens
    // the section that holds the error on every attempt.
    const formSections = useFormSections({ from: false, share: true, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId).then((byChain) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            if (!(byChain?.[chainId] || []).length) {
                setLoadError('No address on this network yet. Use Receive to generate one first.');
            }
        }).catch((err) => {
            if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        let cancelled = false;
        const readList = (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex });
        Promise.all([
            readList(listActionIndex),
            messaging.getSharedLists({ chainId }),
        ]).then(async ([nextDetail, sharedLists]) => {
            const nextOwner = await findListOwner({ detail: nextDetail, readList });
            if (cancelled) return;
            if (!nextDetail) {
                setLoadError(`List #${listActionIndex} could not be read.`);
                return;
            }
            setDetail(nextDetail);
            setSharedRows(rowsFromSharedLists(sharedLists));
            setOwner(nextOwner);
        }).catch((err) => {
            if (!cancelled) setLoadError(
                explorerReadFailure(err, `load list #${listActionIndex}`)?.message
                || `Couldn't load list #${listActionIndex}. Try again.`,
            );
        });
        return () => { cancelled = true; };
    }, [chainId, listActionIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listFormatSupport({ sdkRegistry, chainId }))
            .then((support) => {
                if (!cancelled) setSdkSupported(support?.share === true);
            })
            .catch(() => { if (!cancelled) setSdkSupported('error'); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const walletOwnerRecord = useMemo(() => {
        if (!owner || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((record) => record.address === owner) || null;
    }, [owner, addressesByChain, chainId]);
    const fromRecord = useMemo(() => {
        if (!selectedFromAddress) return walletOwnerRecord;
        return (addressesByChain?.[chainId] || [])
            .find((record) => record.address === selectedFromAddress) || null;
    }, [addressesByChain, chainId, selectedFromAddress, walletOwnerRecord]);
    const selectedOwner = Boolean(fromRecord && owner && fromRecord.address === owner);

    // Hand the shared fields to the host so a switch keeps them.
    const fromRecordId = fromRecord?.id || null;
    useEffect(() => {
        onSharedChange?.({ chainId, fromAddressId: fromRecordId, memo });
    }, [chainId, fromRecordId, memo, onSharedChange]);

    const alreadyShared = useMemo(() => (
        (sharedRows || []).some((row) => isHomeRowForList(
            row, listActionIndex, descriptor, chainId,
        ))
    ), [sharedRows, listActionIndex, descriptor, chainId]);
    const memberCount = currentListMemberCount(detail);
    const eligibility = listShareEligibility({
        type: detail?.type,
        memberCount,
        isShared: alreadyShared,
    });
    const trimmedMemo = memo.trim();
    const actionParams = useMemo(() => ({
        VERSION: '2',
        LIST_ACTION_INDEX: listActionIndex,
        MEMO: trimmedMemo,
    }), [listActionIndex, trimmedMemo]);
    const quoteActionData = useMemo(() => {
        const memoValid = !/[|;]/.test(memo) && !memoLengthError(trimmedMemo);
        if (!listActionIndexValid || sdkSupported !== true || !eligibility.ok
            || !fromRecord || !memoValid) return null;
        return { action: 'LIST', params: actionParams };
    }, [actionParams, eligibility.ok, listActionIndexValid, memo, fromRecord,
        sdkSupported, trimmedMemo]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromRecord?.address,
        actionData: quoteActionData,
    });
    // The live quote has the last word once it answers; until then (or when
    // the form cannot quote yet: not the owner, list not loaded) the
    // schedule's flat figure stands, since the share fee does not depend on
    // anything the form is still waiting for.
    const liveShareFeeKnown = normalizeProtocolFee(protocolFeeQuote).known;
    const shareFeeQuote = liveShareFeeKnown ? protocolFeeQuote : (scheduleShareFee || protocolFeeQuote);
    const shareFeePending = liveShareFeeKnown || scheduleShareFee
        ? false
        : (protocolFeePending || feeScheduleLoading);
    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: fromRecord,
        software: 'createList',
        hardware: 'createListHw',
    });

    function validate() {
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        setFeeStopped(Boolean(feeStop));
        const memoTooLong = memoLengthError(trimmedMemo);
        const problems = {
            'form:list': !listActionIndexValid ? 'List reference must be a positive whole number.' : null,
            'form:sdk': sdkSupported !== true
                ? (sdkSupported === 'error' ? cfg.sdkCheckFailedReason : cfg.sdkReason) : null,
            'form:fee': feeStop?.formError || null,
            'form:eligibility': !eligibility.ok ? eligibility.reasons[0].text : null,
            'list-share-from': !selectedOwner ? (owner
                ? 'This list is owned by an address that is not in this wallet, so this wallet cannot share it.'
                : 'The current owner could not be verified, so this wallet cannot share this list.') : null,
            'list-share-memo': /[|;]/.test(memo)
                ? 'Memo cannot contain | or ; characters.' : memoTooLong,
        };
        const valid = formErrors.validate(problems) && !feeStop;
        if (!valid) setFormError(null);
        return valid;
    }

    async function handleReview(event) {
        event.preventDefault();
        if (submitInFlightRef.current) return;
        setReviewAttempt((n) => n + 1); // Reopens the section holding an error.
        if (!validate()) return;
        submitInFlightRef.current = true;
        setFormError(null);
        try {
            const ownerCheck = await recheckListOwner({
                readList: (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex }),
                actionIndex: listActionIndex,
                owner,
            });
            if (!ownerCheck.ok) {
                setOwner(ownerCheck.owner);
                setFormError(ownerCheck.message);
                return;
            }
            const feeOpts = feePerKb != null ? { feePerKb } : {};
            const next = await lane.run({
                actionData: { action: 'LIST', params: actionParams },
                encoderOpts: { payFeeInNativeCoin: nativeFee.flag || undefined, ...feeOpts },
                submitExtra: { params: actionParams, payFeeInNativeCoin: nativeFee.flag, ...feeOpts },
            });
            setResult(next || {});
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || cfg.failText,
            }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    const header = <PageHeader onBack={onBack} title={cfg.title} />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                summary={{
                    verb: t('components.confirmSummary.verbShareList'),
                    target: listLabel(listActionIndex, detail?.name),
                    direction: 'none',
                    chainId,
                    address: fromRecord?.address,
                }}
                walletId={walletId}
                screenVariant={variant}
                feeEstimate={feeEstimate}
                chainLabel={null}
                chainId={chainId}
                coinTicker={coinTicker}
                signerReady={signerReady}
                credentialsReady={(lane.hw
                    ? lane.confirmProps.hwStatus === 'available'
                    : (signerReady || lane.confirmProps.password.length > 0))}
                hintClassName={styles.hint}
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
                lockNetwork
                onPick={(address) => {
                    setSelectedFromAddress(address.address);
                    setFormError(null);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain || !detail || owner === undefined || !sharedRows || sdkSupported === null) {
        return wrap(
            <ListPage>
                <p className={styles.hint}>Loading...</p>
            </ListPage>,
        );
    }

    if (result) {
        // Signed but held in the broadcast queue: nothing is on the network yet.
        if (result.queued) {
            return wrap(
                <ListPage>
                    <ResultScreen state="signed-not-broadcast" onDone={onDone} what={cfg.resultWhat} unsaved={result.unsaved} />
                </ListPage>,
            );
        }
        if (result.psbtHex && !result.txid) {
            return wrap(
                <ListPage>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={() => setResult(null)}
                        onDone={onDone}
                    />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <StatusMessage variant="success">
                    {result.psbtHex && !result.txid ? 'Unsigned list share created.' : 'List share submitted.'}
                </StatusMessage>
                <p className={styles.hint}>The list becomes shared when this transaction confirms.</p>
                <div className={styles.actions}>
                    <Button type="button" variant="success" icon={<Icon.CheckIcon />} onClick={onDone}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    const ownershipReason = !owner
        ? 'The current owner could not be verified, so this wallet cannot share this list.'
        : !selectedOwner
            ? `The current owner, ${ownerText(owner)}, is not an address in this wallet. A share signed by another address will be refused by the network, so this wallet cannot share it.`
            : null;
    // Why the form cannot be submitted, in one notice: the owner first, then the list itself.
    const blockers = [ownershipReason, ...eligibility.reasons.map((reason) => reason.text)].filter(Boolean);
    const formDisabled = sdkSupported !== true || !eligibility.ok || Boolean(ownershipReason);
    // Which section holds the form error, so that section reopens on
    // every Share attempt even after the user closed it.
    const errorSection = feeStopped ? 'fee'
        : !formError ? null
            : /memo/i.test(formError) ? 'memo'
                : /owned by|owner could not be verified/i.test(formError) ? 'from'
                    : null;
    const sectionErrorKey = (id) => (errorSection === id ? reviewAttempt + 1 : 0);
    const fromHelp = "Only this list's owner can share it. The network refuses a share signed by any other address.";
    const shareFeeText = shareFeeRowText({
        quote: shareFeeQuote,
        pending: shareFeePending,
        formatFiat: feeFiat.formatProtocolFee,
    });
    const shareIntro = (
        <p className={styles.hint}>
            {`This list now lives only on ${descriptor?.displayName || chainId}. Sharing makes it a shared list that lives on every network, so other chains can use it, and sharing is permanent. The share fee pays the hubs and validators that carry and store the list on every chain.`}
        </p>
    );
    const listName = typeof detail.name === 'string' && detail.name ? neutralizeControlText(detail.name) : null;
    const shareFacts = (
        <dl className={styles.detailsList} aria-label="List to share">
            <dt className={styles.detailsLabel}>List</dt>
            <dd className={styles.detailsValue}>{listName ? `${listName} (List #${listActionIndex})` : `List #${listActionIndex}`}</dd>
            <dt className={styles.detailsLabel}>Type</dt>
            <dd className={styles.detailsValue}>{String(detail.type) === '2' ? 'Address list' : String(detail.type) === '1' ? 'Token list' : 'Other list'}</dd>
            <dt className={styles.detailsLabel}>Members</dt>
            <dd className={styles.detailsValue}>{typeof memberCount === 'number' ? memberCount.toLocaleString('en-US') : 'Unknown'}</dd>
            <dt className={styles.detailsLabel}>Share fee</dt>
            <dd className={styles.detailsValue} data-share-fee="">{shareFeeText}</dd>
        </dl>
    );
    if (alreadyShared) {
        return wrap(
            <ListPage>
                <FormSection
                    id="share"
                    title="Share"
                    icon={Icon.UsersIcon}
                    {...formSections.bind('share')}
                    summary={joinSummary(`List #${listActionIndex}`, listName)}
                >
                    {actionField}
                    {shareFacts}
                    <StatusMessage variant="success">This list is already shared to every network. It cannot be shared again.</StatusMessage>
                </FormSection>
            </ListPage>,
        );
    }
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={cfg.formLabel}
            onSubmit={handleReview}
            errors={formErrors}
            status={[
                sdkSupported === false ? <StatusMessage key="sdk" variant="error">{cfg.sdkReason}</StatusMessage> : null,
                sdkSupported === 'error' ? <StatusMessage key="sdk-check" variant="error">{cfg.sdkCheckFailedReason}</StatusMessage> : null,
                formError ? <StatusMessage key="error" variant="error">{formError}</StatusMessage> : null,
            ]}
            action={(
                <FormAction
                    // The action always carries an icon, watcher mode included.
                    icon={lane.isWatcherMode ? <Icon.SignIcon /> : <Icon.UsersIcon />}
                    loading={lane.composing}
                >
                    {lane.isWatcherMode ? 'Create Unsigned Transaction' : cfg.actionLabel}
                </FormAction>
            )}
            /* From (closed) holds the list's locked network and the
               owner address; with no wallet-held owner it opens and keeps the
               empty field and its picker. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={t('routes.listShare.networkHelp')}
                    address={fromRecord?.address || null}
                    addressId="list-share-from"
                    addressLabel="From"
                    addressHelp={fromHelp}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                    formErrorKey="list-share-from"
                    missing={(
                        <AddressField
                            id="list-share-from"
                            label="From"
                            icon="addresses"
                            help={fromHelp}
                            value=""
                            readOnly
                            onChange={() => {}}
                            onIconClick={() => setSourcePickerOpen(true)}
                            iconLabel="Choose source address"
                        />
                    )}
                />
            )}
            /* The one Fees section: the speed slider, the network fee line,
               the share's protocol fee (known before review: one flat fee)
               and the pay-in-coin switch. */
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={(next) => { setFeePick(next); setFeeStopped(false); }}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                    formErrorKey="form:fee"
                    disabled={formDisabled}
                    fees={{
                        quote: shareFeeQuote,
                        pending: shareFeePending,
                        fiat: feeFiat,
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker, disabled: formDisabled },
                    }}
                />
            )}
        >
            <FormSection
                id="share"
                title="Share"
                icon={Icon.UsersIcon}
                {...formSections.bind('share')}
                summary={joinSummary(`List #${listActionIndex}`, listName)}
            >
                {actionField}
                {shareIntro}
                {shareFacts}
                {blockers.length > 0 ? (
                    <FormNotice variant="warning" role="alert" lines={blockers} />
                ) : null}
                {/* The review's warnings card (actionWarnings LIST_SHARE) holds the
                    full warnings; a watcher build has no review, so it shows here. */}
                {lane.isWatcherMode ? <ActionWarningsCard ids={['LIST_SHARE']} /> : null}
            </FormSection>

            {/* Memo is its own optional section, closed until used, holding
                only the memo: the title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                summary={trimmedMemo || 'None'}
                inputId="list-share-memo"
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                disabled={formDisabled}
            />
        </FormFrame>,
    );
}

// ---------------------------------------------------------------------------
// Transfer: LIST format 3, through the owner-action lane.
// ---------------------------------------------------------------------------

/**
 * Transfer ownership of an existing list with LIST format 3.
 *
 * @param {object} props
 * @param {typeof LIST_ACTIONS.transfer} props.cfg
 * @param {string} props.walletId
 * @param {{ chainId: string, actionIndex: string | number, source?: string | null, parentIndex?: string | number | null, state?: { owner?: string | null } }} props.listRef
 * @param {import('react').ReactNode} props.actionField
 * @param {SharedListFields} [props.shared]
 * @param {(values: SharedListFields) => void} [props.onSharedChange]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
function ListTransferBody({ cfg, walletId, listRef, actionField = null, shared, onSharedChange, onBack, onDone = onBack }) {
    const chainId = listRef.chainId;
    const listActionIndex = String(listRef.actionIndex);
    const listActionIndexValid = /^[1-9][0-9]*$/.test(listActionIndex);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);
    const descriptor = chainRegistry.get(chainId);
    const signerReady = useSignerReady(walletId);
    // The standard's Network fee row, display only: the transfer
    // lane takes no fee pick, so the row shows the normal-rate estimate the
    // other list forms show, and the exact fee is set at review.
    const coinTicker = TICKER_BY_COIN[descriptor?.coin] || '';
    const feeEstimate = useMemo(() => estimateNativeSendFee({ chainId, chainRegistry }), [chainId]);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [sdkSupported, setSdkSupported] = useState(/** @type {boolean | 'error' | null} */ (null));
    const [destination, setDestination] = useState('');
    const [memo, setMemo] = useState(shared?.memo || '');
    const [selectedFromAddress, setSelectedFromAddress] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const formErrors = useFormErrors();
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const submitInFlightRef = useRef(false);
    // The standard sections' open state, held above the picker
    // early returns so it survives them; a counter of Transfer attempts
    // reopens the section that holds the error on every attempt.
    const formSections = useFormSections({ from: false, transfer: true, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [listDetail, setListDetail] = useState(/** @type {any | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId).then((byChain) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            if (!(byChain?.[chainId] || []).length) {
                setLoadError('No address on this network yet. Use Receive to generate one first.');
            }
        }).catch((err) => {
            if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        let cancelled = false;
        const readList = (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex });
        const supplied = {
            source: listRef.source,
            list_action_index: listRef.parentIndex,
            state: listRef.state,
        };
        const initial = typeof messaging.getListByActionIndex === 'function'
            ? Promise.resolve().then(() => readList(listActionIndex)).then((detail) => detail || supplied)
            : Promise.resolve(supplied);
        initial
            .then((detail) => {
                // Kept for the confirm page, which names the list and its
                // member count rather than its raw id.
                if (!cancelled) setListDetail(detail && detail !== supplied ? detail : null);
                return findListOwner({ detail, readList });
            })
            .then((value) => { if (!cancelled) setOwner(value); })
            .catch((err) => {
                if (!cancelled) setLoadError(
                    explorerReadFailure(err, `load list #${listActionIndex}`)?.message
                    || `Couldn't load list #${listActionIndex}. Try again.`,
                );
            });
        return () => { cancelled = true; };
    }, [chainId, listActionIndex, listRef.source, listRef.parentIndex, listRef.state, messaging]);

    useEffect(() => {
        let cancelled = false;
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listFormatSupport({ sdkRegistry, chainId }))
            .then((support) => {
                if (!cancelled) setSdkSupported(support?.transfer === true);
            })
            .catch(() => { if (!cancelled) setSdkSupported('error'); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const walletOwnerRecord = useMemo(() => {
        if (!owner || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((record) => record.address === owner) || null;
    }, [owner, addressesByChain, chainId]);
    const fromRecord = useMemo(() => {
        if (!selectedFromAddress) return walletOwnerRecord;
        return (addressesByChain?.[chainId] || [])
            .find((record) => record.address === selectedFromAddress) || null;
    }, [addressesByChain, chainId, selectedFromAddress, walletOwnerRecord]);
    const selectedOwner = Boolean(fromRecord && owner && fromRecord.address === owner);

    // Hand the shared fields to the host so a switch keeps them.
    const fromRecordId = fromRecord?.id || null;
    useEffect(() => {
        onSharedChange?.({ chainId, fromAddressId: fromRecordId, memo });
    }, [chainId, fromRecordId, memo, onSharedChange]);

    const lane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: fromRecord,
        software: 'createList',
        hardware: 'createListHw',
    });
    const trimmedDestination = destination.trim();
    const trimmedMemo = memo.trim();
    const transferListName = typeof listDetail?.name === 'string' && listDetail.name
        ? neutralizeControlText(listDetail.name, { maxLength: 64 })
        : '';
    const transferMemberCount = listDetail ? currentListMemberCount(listDetail) : null;

    function validate() {
        const candidates = airdropLib.parsePaste(trimmedDestination);
        const classified = airdropLib.classifyRecipients(candidates, descriptor);
        const destinationError = candidates.length !== 1 || classified.valid.length !== 1
            ? 'Destination must be one valid address for the selected network.'
            : owner && trimmedDestination.toLowerCase() === owner.toLowerCase()
                ? 'Destination must be different from the current owner.' : null;
        const memoTooLong = memoLengthError(trimmedMemo);
        const problems = {
            'form:list': !listActionIndexValid ? 'List reference must be a positive whole number.' : null,
            'form:sdk': sdkSupported !== true
                ? (sdkSupported === 'error' ? cfg.sdkCheckFailedReason : cfg.sdkReason) : null,
            'list-transfer-from': !selectedOwner ? (owner
                ? 'This list is owned by an address that is not in this wallet, so this wallet cannot transfer it.'
                : 'The current owner could not be verified, so this wallet cannot transfer this list.') : null,
            'list-transfer-destination': destinationError,
            'list-transfer-memo': /[|;]/.test(memo)
                ? 'Memo cannot contain | or ; characters.' : memoTooLong,
        };
        const valid = formErrors.validate(problems);
        if (!valid) setFormError(null);
        return valid;
    }

    async function handleReview(event) {
        event.preventDefault();
        if (submitInFlightRef.current) return;
        setReviewAttempt((n) => n + 1); // Reopens the section holding an error.
        if (!validate()) return;
        submitInFlightRef.current = true;
        setFormError(null);
        const params = {
            VERSION: '3',
            LIST_ACTION_INDEX: listActionIndex,
            DESTINATION: trimmedDestination,
            MEMO: trimmedMemo,
        };
        try {
            if (typeof messaging.getListByActionIndex === 'function') {
                const ownerCheck = await recheckListOwner({
                    readList: (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex }),
                    actionIndex: listActionIndex,
                    owner,
                });
                if (!ownerCheck.ok) {
                    setOwner(ownerCheck.owner);
                    setFormError(ownerCheck.message);
                    return;
                }
            }
            const next = await lane.run({
                actionData: { action: 'LIST', params },
                submitExtra: { params },
            });
            setResult(next || {});
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                fallback: err?.message || cfg.failText,
            }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    async function openContactsPicker() {
        let nextContacts = [];
        if (typeof messaging.listContacts === 'function') {
            try {
                nextContacts = await messaging.listContacts();
            } catch {
                nextContacts = [];
            }
        }
        setContacts(Array.isArray(nextContacts) ? nextContacts : []);
        setContactsPickerOpen(true);
    }

    const header = <PageHeader onBack={onBack} title={cfg.title} />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (lane.open) {
        return (
            <ActionConfirmScreen
                {...lane.confirmProps}
                summary={{
                    // The kind is named so the page reads "Transfer list
                    // <name> to the new owner" over the new owner's address
                    // whatever the host decoded; the list's name and member
                    // count are the facts, and the id shows only when the
                    // list has no name.
                    kind: 'listTransfer',
                    verb: t('components.confirmSummary.verbTransferList'),
                    target: listLabel(listActionIndex),
                    listName: transferListName || '',
                    listIndex: listActionIndex,
                    direction: 'none',
                    chainId: listRef.chainId,
                    address: fromRecord?.address,
                    ...(trimmedDestination ? { recipient: trimmedDestination } : {}),
                    // Only sharing or editing a shared list pays a protocol
                    // fee (listFeeSchedule.js), so a transfer's is known: none.
                    protocolFee: { amount: '0', ticker: 'XCHAIN' },
                    facts: [
                        { label: t('confirmStandard.fact.list'), value: transferListName || `#${listActionIndex}` },
                        ...(typeof transferMemberCount === 'number'
                            ? [{ label: t('confirmStandard.fact.members'), value: transferMemberCount.toLocaleString('en-US') }]
                            : []),
                    ],
                }}
                walletId={walletId}
                screenVariant={variant}
                feeEstimate={feeEstimate}
                chainLabel={null}
                signerReady={signerReady}
                credentialsReady={(lane.hw
                    ? lane.confirmProps.hwStatus === 'available'
                    : (signerReady || lane.confirmProps.password.length > 0))}
                hintClassName={styles.hint}
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
                lockNetwork
                onPick={(address) => {
                    setSelectedFromAddress(address.address);
                    setFormError(null);
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
                    setDestination(entry.address);
                    setFormError(null);
                    setContactsPickerOpen(false);
                }}
                onBack={() => setContactsPickerOpen(false)}
            />
        );
    }

    // The load error, the loading line and the submitted panel lay out through
    // FormPage like the form itself, so no state draws straight into Screen.
    // None of them submits anything, so each is the div form of the template.
    // The load error is the template's body, not its status slot, so it draws
    // its own box and the shell's "Some balances may be out of date" steps
    // aside: one message per page.
    if (loadError) {
        return wrap(
            <FormPage as="div" label={cfg.formLabel}>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </FormPage>,
        );
    }
    if (!addressesByChain || owner === undefined || sdkSupported === null) {
        return wrap(<FormPage as="div" label={cfg.formLabel}><p className={styles.hint}>Loading...</p></FormPage>);
    }

    if (result) {
        // Signed but held in the broadcast queue: nothing is on the network yet.
        if (result.queued) return wrap(<ResultScreen state="signed-not-broadcast" onDone={onDone} what={cfg.resultWhat} unsaved={result.unsaved} />);
        if (result.psbtHex && !result.txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={() => setResult(null)}
                    onDone={onDone}
                />,
            );
        }
        return wrap(
            <FormPage
                as="div"
                label="List transfer submitted"
                title="List transfer submitted"
                headingAs="h2"
                actions={<Button type="button" variant="success" icon={<Icon.CheckIcon />} onClick={onDone}>Done</Button>}
            >
                <p className={styles.hint}>The new owner takes control when the transfer confirms.</p>
                {result.txid ? (
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Transaction ID</dt>
                        <dd className={styles.detailsValue}><code className={styles.txid}>{String(result.txid)}</code></dd>
                    </dl>
                ) : null}
            </FormPage>,
        );
    }

    const ownershipReason = !owner
        ? 'The current owner could not be verified, so this wallet cannot transfer this list.'
        : !selectedOwner
            ? `The current owner, ${ownerText(owner)}, is not an address in this wallet. A transfer signed by another address will be refused by the network, so this wallet cannot transfer it.`
            : null;
    // Which section holds the form error, so that section reopens on
    // every Transfer attempt even after the user closed it.
    const errorSection = !formError ? null
        : /memo/i.test(formError) ? 'memo'
            : /owned by|owner could not be verified/i.test(formError) ? 'from'
                : 'transfer';
    const sectionErrorKey = (id) => (errorSection === id ? reviewAttempt + 1 : 0);
    const fromHelp = "Only this list's owner can transfer it. The network refuses a transfer signed by any other address.";
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={cfg.formLabel}
            onSubmit={handleReview}
            errors={formErrors}
            status={[
                sdkSupported === false ? <StatusMessage key="sdk" variant="error">{cfg.sdkReason}</StatusMessage> : null,
                sdkSupported === 'error' ? <StatusMessage key="sdk-check" variant="error">{cfg.sdkCheckFailedReason}</StatusMessage> : null,
                formError ? <StatusMessage key="error" variant="error">{formError}</StatusMessage> : null,
            ]}
            action={(
                <FormAction
                    // The action always carries an icon, watcher mode included.
                    icon={lane.isWatcherMode ? <Icon.SignIcon /> : <Icon.HandshakeIcon />}
                    loading={lane.composing}
                    disabled={sdkSupported !== true}
                >
                    {lane.isWatcherMode ? 'Create Unsigned Transaction' : cfg.actionLabel}
                </FormAction>
            )}
            /* From (closed) holds the list's locked network and the
               owner address; with no wallet-held owner it opens and keeps the
               empty field and its picker. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainRegistry={chainRegistry}
                    lockNetwork
                    networkHelp={t('routes.listTransfer.networkHelp')}
                    address={fromRecord?.address || null}
                    addressId="list-transfer-from"
                    addressLabel="From"
                    addressHelp={fromHelp}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey('from')}
                    formErrorKey="list-transfer-from"
                    missing={(
                        <AddressField
                            id="list-transfer-from"
                            label="From"
                            icon="addresses"
                            help={fromHelp}
                            value=""
                            readOnly
                            onChange={() => {}}
                            onIconClick={() => setSourcePickerOpen(true)}
                            iconLabel="Choose source address"
                        />
                    )}
                />
            )}
            fee={feeEstimate ? (
                // FeeSection's fixed-fee mode (no speed pick on this lane).
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    fixedFee={feeEstimate.coinAmount}
                >
                    <p className={styles.hint}>An estimate. The exact fee is set when the transfer is built for review.</p>
                </FeeSection>
            ) : null}
        >
            <FormSection
                id="transfer"
                title="Transfer"
                icon={Icon.HandshakeIcon}
                {...formSections.bind('transfer')}
                revealKey={sectionErrorKey('transfer')}
                summary={joinSummaryParts([`List #${listActionIndex}`, trimmedDestination ? <>to <SummaryAddress address={trimmedDestination} /></> : null])}
            >
            {actionField}
            {ownershipReason ? (
                <FormNotice variant="warning" role="alert">{ownershipReason}</FormNotice>
            ) : null}

            <AddressField
                id="list-transfer-destination"
                label="New owner"
                icon="contacts"
                // The explanation the confirm page no longer carries (its
                // notice is a title and two short lines, 2026-11-16).
                help="The address that becomes this list's owner, valid on the list's network. Only it can edit, share or transfer the list once the transfer confirms. A shared list keeps working on every chain, because its versions carry members, never the owner."
                value={destination}
                onChange={(event) => { setDestination(event.target.value); setFormError(null); }}
                onIconClick={openContactsPicker}
                iconLabel="Choose new owner from contacts"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={sdkSupported !== true || Boolean(ownershipReason)}
            />

            </FormSection>

            {/* Memo is its own optional section, closed until used, holding
                only the memo: the title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                summary={trimmedMemo || 'None'}
                inputId="list-transfer-memo"
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(event) => { setMemo(event.target.value); setFormError(null); }}
                disabled={sdkSupported !== true || Boolean(ownershipReason)}
            />
        </FormFrame>,
    );
}
