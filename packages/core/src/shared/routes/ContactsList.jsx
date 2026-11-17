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
import { AddressField, AddressText, Button, ChainBadge, EmptyState, FormPage, Icon, Input, ListPage, ListRow, NetworkField, PageHeader, Screen, Select, Skeleton, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { copyText } from '../clipboard.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useToast } from '../components/ToastHost.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { LIST_DETAIL_MIN_WIDTH, ListDetailSplit, listDetailStyles, useWideContent } from '../components/PanelSplit.jsx';
import { NETWORK_OPTIONS, NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { ContactAvatar, contactDefaultTone } from '../components/WalletIdentity.jsx';
// The look editor Edit Wallet and Edit Account use (colour, shape, image).
import { TileLookFields } from '../components/TileLookFields.jsx';
import { readContactLook, sameContactLook } from '../utils/contactLook.js';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { useFormLeaveGuard } from '../hooks/useFormLeaveGuard.js';
import { isValidAddressAnyNetwork, detectAddressChain } from '../utils/addressValidation.js';
import { coinFamilyFor as chainFor, contactEntryChain as resolvedChain } from '../utils/contactChain.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { shareOrCopy, ShareOutcome } from '../share.js';
import { ScanRoute } from './ScanRoute.jsx';
import {
    compareContactsByName,
    compareContactsByNewest,
    duplicateNameGroups,
    findContactByName,
    mergeContactGroup,
} from '../utils/contactMerge.js';
import picker from './ContactsList.module.css';
// The detail pages' facts card (G14): label and value on one line per fact.
import facts from './FactRows.module.css';
import { BIDI_CONTROLS } from '../utils/textHardening.js';

// A right-to-left override typed into the name would reverse the text shown in
// the field while the stored name (cleaned on save) reads in order, so the
// field never holds one: what it shows is what is saved.
const stripBidiControls = (value) => value.replace(BIDI_CONTROLS, '');

// The contacts store refuses a save whose expected version is not the stored
// one, with this message (core flows/contacts.js assertExpectedVersion).
const isVersionConflict = (err) => /changed since this screen loaded/i.test(String(err?.message || err || ''));

const chainRegistry = registryLib.defaultRegistry();

// Field help for the contact forms (U57): written for these fields, shown in
// the label's help tip instead of a hint line under the field.
const CONTACT_NAME_HELP = 'The name shown in place of this contact\'s addresses across the inbox and history.';
const CONTACT_ADDRESS_HELP = 'Any address on a supported network. The network is read from the address itself; if it cannot be, you choose it below.';
const CONTACT_NOTES_HELP = 'Your own notes about this contact, for example how you know them. Search in Contacts matches them too.';
const CONTACT_LABEL_HELP = 'A short name for this address, such as Savings or Tips jar, shown in its row in place of the network name.';
const CONTACTS_SORT_STORAGE_KEY = 'xc:contacts:sort';

function contactsSortStorageKey(walletId) {
    return `${CONTACTS_SORT_STORAGE_KEY}:${walletId || 'none'}`;
}

function readContactsSort(walletId) {
    try {
        return globalThis.localStorage?.getItem(contactsSortStorageKey(walletId)) === 'newest'
            ? 'newest'
            : 'name';
    } catch {
        return 'name';
    }
}

function persistContactsSort(walletId, value) {
    try {
        globalThis.localStorage?.setItem(contactsSortStorageKey(walletId), value);
    } catch {
        // Storage can be unavailable in privacy-restricted shells.
    }
}

/**
 * Chain icon for a contact entry. The address selects the matching descriptor,
 * while unknown formats keep the question-mark fallback.
 */
function ChainCoinIcon({ chain, address, size = 'sm' }) {
    const chainId = chainIdFor(chain, address);
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    if (descriptor) return <ChainBadge descriptor={descriptor} size={size} />;
    return (
        <span className={picker.unknownIcon} aria-label="Unknown network" title="Unknown network">?</span>
    );
}

/** The network's name for a contact entry ("Bitcoin"), or "Unknown network". */
function networkNameFor(entry) {
    const chain = resolvedChain(entry);
    return NETWORK_OPTIONS.find((option) => option.value === chain)?.label || 'Unknown network';
}

/** The networks a contact's addresses are on, each named once ("Bitcoin, Litecoin"). */
function contactNetworks(contact) {
    return [...new Set((contact?.entries || []).map(networkNameFor))].join(', ');
}

/** The day a contact was saved ("12 Oct 2026"), or "Unknown" for a bad stamp. */
function addedOn(createdAt) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * §41.7.4 Contacts. List + detail + create/edit in one route; the
 * UX is read-heavy enough that a separate detail route isn't worth
 * the navigation overhead. Modes:
 *   - 'list'        - table of contacts + Add button
 *   - 'detail'      - View Contact: Actions, Addresses and Details tabs
 *   - 'edit'        - form for new or existing contact
 *   - 'scan'        - QR scanner, launched from the list, the edit form or
 *                     Add Address
 *   - 'add-address' - Add Address page: the address (typed, pasted or
 *                     scanned; its network read from it) and a Label
 *
 * On send-message the parent App.jsx navigates to ComposeMessage with
 * the contact's primary entry pre-filled.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(prefill: { chainId?: string, address?: string }) => void} [props.onSend]
 *   Navigate to the Send flow pre-filled with the contact's primary address.
 * @param {(prefill: { chainId?: string, toAddress?: string }) => void} [props.onSendMessage]
 * @param {() => void} props.onBack
 * @param {{ address: string, chainId?: string } | null} [props.scanPrefill] Address
 *   scanned via the global AppHeader QR button while this route is mounted.
 *   When set, the component opens the new-contact edit form with the address
 *   pre-filled, then calls onScanPrefillConsumed to clear it in the parent.
 * @param {() => void} [props.onScanPrefillConsumed]
 * @param {{ address: string, chainId?: string, edit?: boolean } | null} [props.openTarget]
 *   Opens the route on one address (from a conversation's menu): the edit
 *   form of the contact that holds it when `edit`, else a pre-filled new
 *   contact. Cleared through onOpenTargetConsumed.
 * @param {() => void} [props.onOpenTargetConsumed]
 */
export function ContactsList({ walletId, onSend, onSendMessage, onBack, scanPrefill, onScanPrefillConsumed, onOpenBackup, openTarget, onOpenTargetConsumed }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { showToast } = useToast();
    const confirmDialog = useConfirmModal();
    const [layoutRef, wideContent] = useWideContent(LIST_DETAIL_MIN_WIDTH, true);

    // §19.5.2 publish nudge. Contacts live only in this device's vault, and
    // the on-chain copy that survives a re-import is written only when the
    // user publishes from Settings > Backup. Nothing on this screen said so,
    // and a tester who added contacts, quit a browser that purges site data,
    // and re-imported found them gone. The host's scheduler already counts
    // unpublished edits; this reads that count and says it where the edits
    // happen. Dismissal lasts for this visit only: the edits stay unpublished.
    const [unpublished, setUnpublished] = useState(0);
    const [nudgeDismissed, setNudgeDismissed] = useState(false);
    const unpublishedRequestRef = useRef(0);
    const refreshUnpublished = useCallback(async (isCurrent = () => true) => {
        if (typeof messaging?.labelSyncStatusRequest !== 'function') return;
        const request = ++unpublishedRequestRef.current;
        try {
            const s = await messaging.labelSyncStatusRequest();
            if (unpublishedRequestRef.current !== request || !isCurrent()) return;
            const count = Number(s?.batch?.changeCount ?? s?.changeCount ?? 0);
            setUnpublished(s?.due || s?.pending ? Math.max(1, count) : 0);
        } catch {
            // Locked or not wired: leave the nudge hidden rather than guess.
        }
    }, [messaging]);

    const [contacts, setContacts] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [mode, setMode] = useState(
        /** @type {'list' | 'detail' | 'edit' | 'scan' | 'add-address'} */ ('list'),
    );
    const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));
    // View Contact's chosen tab; Add Address returns to the Addresses tab it
    // opened from.
    const [detailView, setDetailView] = useState('actions');

    // Tracks whether the QR scanner was launched from the edit form, so
    // handleScanned knows to merge the address into the current form state
    // rather than resetting it.
    const [scanFromEdit, setScanFromEdit] = useState(false);
    // The scanner was opened from Add Address: a scanned address fills its field.
    const [scanForAddress, setScanForAddress] = useState(false);

    // List-view filters. `query` is a free-text match over name / notes /
    // any entry address or label; `networkFilter` keeps only contacts that
    // hold at least one address on that chain.
    const [query, setQuery] = useState('');
    const [networkFilter, setNetworkFilter] = useState(/** @type {'all' | string} */ ('all'));
    // A long address book was unsorted (storage order); name is the default.
    const [sortBy, setSortBy] = useState(
        /** @type {'name' | 'newest'} */ (() => readContactsSort(walletId)),
    );
    // One-line "Added to <name>" shown on the detail view after a save that
    // joined an existing contact instead of creating a second one.
    const [notice, setNotice] = useState(/** @type {string | null} */ (null));
    const [merging, setMerging] = useState(false);

    const [formName, setFormName] = useState('');
    const [formNotes, setFormNotes] = useState('');
    const [formEntries, setFormEntries] = useState(
        /** @type {{ chain: string, address: string, label: string }[]} */ ([
            { chain: 'bitcoin', address: '', label: '' },
        ]),
    );
    // The tile look being edited, as readContactLook returns it: a null field
    // keeps the default, so a contact saved before looks existed keeps its
    // colour when only its name or notes change.
    const [formLook, setFormLook] = useState(
        /** @type {{ colour: string | null, shape: 'circle' | 'rounded' | null, image: string | null }} */ (readContactLook(null)),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [deleting, setDeleting] = useState(/** @type {string | null} */ (null));
    const [editVersion, setEditVersion] = useState(/** @type {string | null} */ (null));
    // An error answers the last Save; once the user edits the form it no
    // longer describes it ("Name is required." stayed up under a typed name).
    useEffect(() => { setSubmitError(null); }, [formName, formNotes, formEntries, formLook]);

    // The Add Address page (the Addresses tab's Add Address button): no
    // modal, since nothing is edited in one (G104).
    const [addAddrValue, setAddAddrValue] = useState('');
    const [addAddrLabel, setAddAddrLabel] = useState('');
    const [addAddrError, setAddAddrError] = useState(/** @type {string | null} */ (null));
    const [addAddrSaving, setAddAddrSaving] = useState(false);
    // The user's answer when the typed address's network cannot be read from
    // its bytes (shared testnet/regtest version bytes); null until they pick.
    const [addAddrChain, setAddAddrChain] = useState(/** @type {string | null} */ (null));

    // Address-picker dropdown shown when a multi-address contact's Send or
    // Message action needs the user to choose which address to use.
    const [addrPicker, setAddrPicker] = useState(/** @type {'send' | 'message' | null} */ (null));
    const actionsRef = useRef(null);
    const walletScopeRef = useRef(walletId);
    const contactsRequestRef = useRef(0);
    walletScopeRef.current = walletId;

    // Resolves to the rows it read, or null when the read fails, the wallet
    // changes underneath it, or a newer request supersedes it.
    const loadContacts = useCallback(async () => {
        const scope = walletId;
        const request = ++contactsRequestRef.current;
        const isCurrent = () => walletScopeRef.current === scope
            && contactsRequestRef.current === request;
        let loaded = null;
        setLoadError(null);
        try {
            const rows = await messaging.listContacts();
            if (!isCurrent()) return null;
            loaded = Array.isArray(rows) ? rows : [];
            setContacts(loaded);
        } catch (err) {
            if (!isCurrent()) return null;
            setLoadError(userFacingMessage(err, 'Failed to load contacts.'));
        }
        // Every mutation on this screen ends in a reload, so this is the one
        // place the unpublished count needs refreshing.
        if (isCurrent()) {
            await refreshUnpublished(isCurrent);
        }
        return loaded;
    }, [messaging, refreshUnpublished, walletId]);

    useEffect(() => {
        setContacts(null);
        setLoadError(null);
        setMode('list');
        setActiveId(null);
        setSortBy(readContactsSort(walletId));
        setUnpublished(0);
        setNudgeDismissed(false);
        loadContacts();
    }, [loadContacts, walletId]);

    const active = useMemo(() => {
        if (!activeId || !contacts) return null;
        return contacts.find((c) => c.id === activeId) || null;
    }, [activeId, contacts]);

    // Each contact opens on its Actions tab.
    useEffect(() => { setDetailView('actions'); }, [activeId]);

    // A contact deleted in another window leaves its pages for the list.
    useEffect(() => {
        if (contacts && (mode === 'detail' || mode === 'add-address') && !active) setMode('list');
    }, [contacts, mode, active]);

    const contactFormDirty = useMemo(() => {
        if (active) {
            const originalEntries = Array.isArray(active.entries) ? active.entries : [];
            return formName !== String(active.name || '')
                || formNotes !== String(active.notes || '')
                || !sameContactLook(formLook, readContactLook(active))
                || JSON.stringify(formEntries) !== JSON.stringify(originalEntries.map((entry) => ({
                    chain: entry.chain,
                    address: entry.address,
                    label: entry.label || '',
                })));
        }
        return [formName, formNotes].some((value) => value.trim().length > 0)
            || formEntries.some((entry) => (
                String(entry.address || '').trim().length > 0
                || String(entry.label || '').trim().length > 0
            ));
    }, [active, formName, formNotes, formEntries, formLook]);
    const leaveEdit = useCallback(() => {
        setMode(active ? 'detail' : 'list');
        if (!active) setActiveId(null);
    }, [active]);
    const leaveGuard = useFormLeaveGuard({
        dirty: (mode === 'edit' || (mode === 'scan' && scanFromEdit)) && contactFormDirty,
        onLeave: leaveEdit,
    });

    const filteredContacts = useMemo(() => {
        if (!contacts) return [];
        const q = query.trim().toLowerCase();
        return contacts.filter((c) => {
            const entries = Array.isArray(c.entries) ? c.entries : [];
            if (networkFilter !== 'all' && !entries.some((e) => resolvedChain(e) === networkFilter)) {
                return false;
            }
            if (!q) return true;
            if (c.name?.toLowerCase().includes(q)) return true;
            if (c.notes?.toLowerCase().includes(q)) return true;
            return entries.some((e) =>
                e.address?.toLowerCase().includes(q) || e.label?.toLowerCase().includes(q),
            );
        }).sort(sortBy === 'newest' ? compareContactsByNewest : compareContactsByName);
    }, [contacts, query, networkFilter, sortBy]);

    // Wide Contacts always has a detail beside the list. Keep the selected
    // contact inside the filtered rows, choosing the first row when the page
    // opens or a filter removes the previous selection. Narrow Contacts keeps
    // the existing list-then-detail flow.
    useEffect(() => {
        if (!wideContent || !contacts || (mode !== 'list' && mode !== 'detail')) return;
        const first = filteredContacts[0] || null;
        if (!first) {
            if (activeId !== null) setActiveId(null);
            return;
        }
        if (!filteredContacts.some((contact) => contact.id === activeId)) setActiveId(first.id);
    }, [activeId, contacts, filteredContacts, mode, wideContent]);

    const twoPanel = wideContent
        && contacts !== null
        && !loadError
        && (mode === 'list' || mode === 'detail')
        && filteredContacts.length > 0;

    const openContact = (contact) => {
        setActiveId(contact.id);
        if (!twoPanel) setMode('detail');
    };

    const duplicateGroups = useMemo(() => duplicateNameGroups(contacts), [contacts]);

    useEffect(() => { if (mode !== 'detail') setNotice(null); }, [mode]);

    // Fold contacts that share a name into the oldest of each group. Not
    // atomic: each group saves, then deletes the rest, so a failure partway
    // leaves the earlier groups merged and the later ones untouched, and a
    // retry picks up where it stopped (nothing is lost, only not yet folded).
    async function handleMergeDuplicates() {
        if (merging || duplicateGroups.length === 0) return;
        setMerging(true);
        try {
            for (const group of duplicateGroups) {
                const { keep, dropIds } = mergeContactGroup(group);
                // eslint-disable-next-line no-await-in-loop
                await messaging.saveContact({
                    record: keep,
                    replaceIds: dropIds,
                    expectedUpdatedAt: keep.updatedAt,
                });
                for (const id of dropIds) {
                    const dropped = group.find((contact) => contact.id === id);
                    // eslint-disable-next-line no-await-in-loop
                    await messaging.deleteContact({ id, expectedUpdatedAt: dropped?.updatedAt });
                }
            }
            await loadContacts();
        } catch (err) {
            setLoadError(userFacingMessage(err, 'Could not merge these contacts. Try again.'));
        } finally {
            setMerging(false);
        }
    }

    // When the global AppHeader QR scanner produces an address while this
    // route is active, App.jsx sets scanPrefill. If the address already
    // belongs to a contact we open that contact's detail view; otherwise we
    // open the new-contact form with the address pre-filled.
    useEffect(() => {
        if (!scanPrefill) return;
        const existing = findContactByAddress(contacts, scanPrefill.address);
        if (existing) {
            setActiveId(existing.id);
            setMode('detail');
            onScanPrefillConsumed?.();
            return;
        }
        const chain = coinFamilyFromChainId(scanPrefill.chainId) || chainFor(scanPrefill.address);
        setActiveId(null);
        setFormName('');
        setFormNotes('');
        setFormEntries([{ chain, address: scanPrefill.address, label: '' }]);
        setSubmitError(null);
        setMode('edit');
        onScanPrefillConsumed?.();
    }, [scanPrefill, contacts, onScanPrefillConsumed]);

    // A thread's overflow menu opens this route aimed at one address: the
    // contact that holds it opens in the edit form (edit), otherwise the
    // new-contact form opens with the address pre-filled.
    useEffect(() => {
        if (!openTarget || !contacts) return;
        const existing = findContactByAddress(contacts, openTarget.address);
        if (existing && openTarget.edit) {
            setActiveId(existing.id);
            startEdit(existing);
        } else if (existing) {
            setActiveId(existing.id);
            setMode('detail');
        } else {
            const chain = coinFamilyFromChainId(openTarget.chainId) || chainFor(openTarget.address);
            setActiveId(null);
            setEditVersion(null);
            setFormName('');
            setFormNotes('');
            setFormEntries([{ chain, address: openTarget.address, label: '' }]);
            setSubmitError(null);
            setMode('edit');
        }
        onOpenTargetConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openTarget, contacts]);

    // Dismiss the address-picker dropdown on outside click or Escape.
    useEffect(() => {
        if (!addrPicker) return undefined;
        const onDown = (e) => {
            if (actionsRef.current?.contains(e.target)) return;
            setAddrPicker(null);
        };
        const onKey = (e) => { if (e.key === 'Escape') setAddrPicker(null); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [addrPicker]);

    function startEdit(contact) {
        if (contact) {
            setEditVersion(contact.updatedAt);
            setFormName(contact.name);
            setFormNotes(contact.notes || '');
            setFormEntries(contact.entries.length
                ? contact.entries.map((e) => ({ chain: e.chain, address: e.address, label: e.label || '' }))
                : [{ chain: 'bitcoin', address: '', label: '' }]);
        } else {
            setEditVersion(null);
            setFormName('');
            setFormNotes('');
            setFormEntries([{ chain: 'bitcoin', address: '', label: '' }]);
        }
        setFormLook(readContactLook(contact));
        setSubmitError(null);
        setMode('edit');
    }

    function handleScanned(outcome) {
        // ScanRoute fires { kind: 'send', address, chainId? } for plain
        // addresses, BIP21, and xchain: send URIs.
        if (scanForAddress) {
            // Add Address: a scanned address fills its field, and its
            // network is read from it as if it were typed.
            setScanForAddress(false);
            setMode('add-address');
            if (outcome && outcome.kind === 'send' && outcome.address) {
                setAddAddrValue(outcome.address);
                setAddAddrChain(coinFamilyFromChainId(outcome.chainId));
                setAddAddrError(null);
            } else {
                showToast({ message: 'No address detected in that QR code.', variant: 'error' });
            }
            return;
        }
        if (outcome && outcome.kind === 'send' && outcome.address) {
            const chain = coinFamilyFromChainId(outcome.chainId) || chainFor(outcome.address);
            if (scanFromEdit) {
                // Merge into the edit form: fill the first entry whose
                // address is blank, or overwrite entry[0] if all are filled.
                setFormEntries((prev) => {
                    const idx = prev.findIndex((e) => !e.address.trim());
                    const next = [...prev];
                    const target = idx >= 0 ? idx : 0;
                    next[target] = { ...next[target], chain, address: outcome.address };
                    return next;
                });
                setScanFromEdit(false);
                setMode('edit');
            } else {
                // Standalone scan (not merging into an open form): jump to the
                // matching contact's detail view when the address is already
                // saved, else open a fresh new-contact form.
                const existing = findContactByAddress(contacts, outcome.address);
                if (existing) {
                    setActiveId(existing.id);
                    setMode('detail');
                } else {
                    setActiveId(null);
                    setFormName('');
                    setFormNotes('');
                    setFormEntries([{ chain, address: outcome.address, label: '' }]);
                    setSubmitError(null);
                    setMode('edit');
                }
            }
        } else {
            setScanFromEdit(false);
            setMode(scanFromEdit ? 'edit' : 'list');
            showToast({ message: 'No address detected in that QR code.', variant: 'error' });
        }
    }

    async function handleSave(event) {
        event.preventDefault();
        if (submittingRef.current) return;
        if (!formName.trim()) {
            setSubmitError('Name is required.');
            return;
        }
        const cleanedEntries = formEntries
            .map((e) => ({ chain: chainFor(e.address, e.chain), address: e.address.trim(), label: e.label }))
            .filter((e) => e.chain && e.address);
        if (cleanedEntries.length === 0) {
            setSubmitError('At least one address entry is required.');
            return;
        }
        const nameOwner = findContactByName(contacts, formName);
        if (nameOwner && nameOwner.id !== active?.id) {
            setSubmitError(`A contact named "${nameOwner.name}" already exists.`);
            return;
        }
        // An address whose network cannot be read from its bytes (the shared
        // testnet/regtest version bytes) needs the user's word for it. Saving it
        // as 'unknown' is what put a question mark on every such contact and
        // hid it from the network filter.
        const undecided = cleanedEntries.find((e) => e.chain === 'unknown' && isValidAddressAnyNetwork(e.address));
        if (undecided) {
            setSubmitError(`Pick the network for "${undecided.address}"; it cannot be read from the address.`);
            return;
        }
        // D-4: validate the address is real (checksum / bech32) before saving, so
        // a garbage string isn't stored as a "Network: Unknown" contact that only
        // fails later when picked in Send. isValidAddressAnyNetwork is the Send
        // form's own validator; it accepts a valid-but-coin-ambiguous testnet/
        // regtest address (chain stays 'unknown') but rejects non-addresses.
        const badEntry = cleanedEntries.find((e) => !isValidAddressAnyNetwork(e.address));
        if (badEntry) {
            setSubmitError(`"${badEntry.address}" is not a valid Bitcoin, Litecoin, or Dogecoin address.`);
            return;
        }
        const repeatedAddress = findRepeatedAddress(cleanedEntries);
        if (repeatedAddress) {
            setSubmitError(`"${repeatedAddress}" appears more than once in this contact.`);
            return;
        }
        const addressOwner = cleanedEntries
            .map((entry) => findContactByAddress(contacts, entry.address, entry.chain))
            .find((contact) => contact && contact.id !== active?.id);
        if (addressOwner) {
            setSubmitError(`This address is already saved for ${addressOwner.name}.`);
            return;
        }
        submittingRef.current = true;
        setSubmitting(true);
        setSubmitError(null);
        try {
            if (active) {
                // The look is written only once it is changed, as the wallet
                // tile's { colour, image, shape }; an untouched contact keeps
                // what it had (no look: the default).
                const lookChanged = !sameContactLook(formLook, readContactLook(active));
                const look = lookChanged
                    ? { colour: formLook.colour, image: formLook.image, shape: formLook.shape || 'circle' }
                    : active.look;
                await messaging.saveContact({
                    record: {
                        ...active,
                        name: formName.trim(),
                        notes: formNotes,
                        entries: cleanedEntries,
                        ...(look ? { look } : {}),
                    },
                    expectedUpdatedAt: editVersion,
                });
            } else {
                await messaging.saveContact({
                    input: { name: formName.trim(), notes: formNotes, entries: cleanedEntries },
                });
            }
            await loadContacts();
            setMode(active ? 'detail' : 'list');
        } catch (err) {
            // The conflict message tells the user to try again, so the next
            // Save carries the version stored now instead of the one that
            // just lost. The form keeps what the user typed.
            if (active && isVersionConflict(err)) {
                const rows = await loadContacts();
                const fresh = rows?.find((contact) => contact.id === active.id);
                if (fresh) setEditVersion(fresh.updatedAt);
            }
            setSubmitError(userFacingMessage(err, 'Could not save this contact. Try again.'));
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }

    async function handleDelete(id) {
        if (deleting) return;
        setDeleting(`contact:${id}`);
        const snapshot = contacts ? contacts.find((c) => c.id === id) : null;
        const displayName = snapshot?.name || 'this contact';
        // Snapshot the full record before deletion so the §37.2 Undo
        // toast can re-create it via saveContact. We freeze the
        // displayed name here so the toast text doesn't change if the
        // user quickly creates another contact with the same id.
        try {
            if (!(await confirmDialog.confirm({
                title: `Delete ${displayName} from contacts?`,
                message: `${displayName} and all saved addresses will be removed. You can restore the contact with Undo.`,
                confirmLabel: 'Delete contact',
                danger: true,
            }))) return;
            await messaging.deleteContact({ id, expectedUpdatedAt: snapshot?.updatedAt });
            setActiveId(null);
            setMode('list');
            await loadContacts();
            if (snapshot) {
                // The toast host dismisses the toast as soon as Undo runs, so a
                // refused restore offers the same Undo again; the retry stays
                // bound to this snapshot instead of leaving the contact lost.
                const undoToast = {
                    message: `${displayName} deleted`,
                    actionLabel: 'Undo',
                    onAction: () => restoreContact(),
                };
                const restoreContact = async () => {
                    try {
                        await messaging.saveContact({ record: snapshot, expectedUpdatedAt: null });
                    } catch (err) {
                        setLoadError(userFacingMessage(err, 'Could not restore this contact. Try again.'));
                        showToast(undoToast);
                        return;
                    }
                    await loadContacts();
                };
                showToast(undoToast);
            }
        } catch (err) {
            setLoadError(userFacingMessage(err, 'Could not delete this contact. Try again.'));
        } finally {
            setDeleting(null);
        }
    }

    async function handleShareContact() {
        if (!active) return;
        const text = [
            active.name,
            ...active.entries.map((entry) => {
                const chain = resolvedChain(entry);
                const network = NETWORK_OPTIONS.find((option) => option.value === chain)?.label || chain;
                const label = entry.label?.trim() ? ` (${entry.label.trim()})` : '';
                return `${network}${label}: ${entry.address}`;
            }),
        ].join('\n');
        const outcome = await shareOrCopy({ title: `${active.name} contact`, text }, text);
        if (outcome === ShareOutcome.COPIED) {
            showToast({ message: 'Contact copied.' });
        } else if (outcome === ShareOutcome.UNAVAILABLE) {
            showToast({ message: 'Sharing is unavailable.' });
        }
    }

    // An address card's Remove: take that address off the active contact
    // after the standard confirm dialog, which asks only "Remove this
    // address?" with Cancel and Remove (operator 2026-11-15: no other copy).
    async function handleDeleteAddress(index) {
        if (!active || deleting) return;
        if (!active.entries[index]) return;
        setDeleting(`address:${index}`);
        const nextEntries = active.entries.filter((_, i) => i !== index);
        try {
            if (!(await confirmDialog.confirm({
                title: 'Remove this address?',
                confirmLabel: 'Remove',
                confirmIcon: <Icon.TrashIcon />,
                danger: true,
            }))) return;
            await messaging.saveContact({
                record: { ...active, entries: nextEntries },
                expectedUpdatedAt: active.updatedAt,
            });
            await loadContacts();
        } catch (err) {
            setLoadError(userFacingMessage(err, 'Could not remove this address. Try again.'));
        } finally {
            setDeleting(null);
        }
    }

    // The Addresses tab's Add Address button: a blank Add Address page.
    function startAddAddress() {
        setAddAddrValue('');
        setAddAddrLabel('');
        setAddAddrChain(null);
        setAddAddrError(null);
        setMode('add-address');
    }

    async function handleCopyAddress(address) {
        const result = await copyText(address);
        showToast(result?.ok
            ? { message: 'Address copied.' }
            : { message: 'Could not copy the address.', variant: 'error' });
    }

    // Save the address on the Add Address page to the active contact,
    // reading its coin network from the address itself.
    async function handleAddAddress(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (!active || addAddrSaving) return;
        const address = addAddrValue.trim();
        if (!address) {
            setAddAddrError('Address is required.');
            return;
        }
        // D-4: reject a non-address here rather than saving it as "Network: Unknown".
        if (!isValidAddressAnyNetwork(address)) {
            setAddAddrError('This is not a valid Bitcoin, Litecoin, or Dogecoin address.');
            return;
        }
        const chain = chainFor(address, addAddrChain);
        if (chain === 'unknown') {
            setAddAddrError('Pick the network this address belongs to.');
            return;
        }
        const addressOwner = findContactByAddress(contacts, address, chain);
        if (addressOwner) {
            setAddAddrError(`This address is already saved for ${addressOwner.name}.`);
            return;
        }
        setAddAddrSaving(true);
        setAddAddrError(null);
        const entry = { chain, address, label: stripBidiControls(addAddrLabel).trim() };
        try {
            await messaging.saveContact({
                record: { ...active, entries: [...active.entries, entry] },
                expectedUpdatedAt: active.updatedAt,
            });
            await loadContacts();
            setAddAddrValue('');
            setAddAddrLabel('');
            setDetailView('addresses');
            setMode('detail');
        } catch (err) {
            // Reloading moves `active` to the stored version, so Add again
            // appends to the current entries under the current version.
            if (isVersionConflict(err)) await loadContacts();
            setAddAddrError(userFacingMessage(err, 'Could not save this address. Try again.'));
        } finally {
            setAddAddrSaving(false);
        }
    }

    // The title bar holds the filter (search, Network, Sort) and Add contact
    // as a plain plus at the far right, as on Bet Markets and Messaging; the
    // page body is only the contact list. The filter waits for the contacts
    // to load, and it is lit while any of the three is off its default.
    const listFilter = contacts && !loadError ? (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            active={networkFilter !== 'all' || sortBy !== 'name'}
            label="Filter contacts"
            searchPlaceholder="Search"
            searchLabel="Search contacts"
        >
            <NetworkFilterDropdown
                value={networkFilter}
                onChange={setNetworkFilter}
                announceNetworkCount
                iconOnly={false}
            />
            <Select
                size="md"
                value={sortBy}
                onChange={(e) => {
                    const value = /** @type {'name' | 'newest'} */ (e.target.value);
                    setSortBy(value);
                    persistContactsSort(walletId, value);
                }}
                aria-label="Sort contacts"
            >
                <Select.Option value="name" icon={<Icon.BookIcon />}>A to Z</Select.Option>
                <Select.Option value="newest" icon={<Icon.HistoryIcon />}>Newest</Select.Option>
            </Select>
        </ListFilterMenu>
    ) : null;

    const header = (
        <PageHeader
            nested={mode !== 'list' && !twoPanel}
            backDisabled={mode === 'add-address' && addAddrSaving}
            onBack={() => {
                if (mode === 'list' || twoPanel) {
                    onBack();
                } else if (mode === 'edit') {
                    leaveGuard.guardedOnBack();
                } else if (mode === 'add-address') {
                    // Back to the Addresses tab Add Address opened from.
                    setDetailView('addresses');
                    setMode('detail');
                } else {
                    setMode('list');
                }
            }}
            title={twoPanel ? 'Contacts' : ({
                edit: active ? 'Edit Contact' : 'New Contact',
                detail: 'View Contact',
                'add-address': 'Add Address',
            })[mode] || 'Contacts'}
            trailing={mode === 'list' || twoPanel ? (
                <>
                    {listFilter}
                    <Button
                        type="button"
                        variant="secondary"
                        icon={<Icon.PlusIcon />}
                        aria-label="Add contact"
                        title="Add contact"
                        onClick={() => { setActiveId(null); startEdit(null); }}
                    >
                        {null}
                    </Button>
                </>
            ) : null}
        />
    );

    // The list keeps its own offset: a contact or the edit form swaps into
    // this same Screen, and with one key the short detail view clamped the
    // list offset to its own height, so Back returned to the top. Those
    // views open at the top.
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            scrollKey={mode === 'list' ? 'list' : mode}
            restoreScroll={mode === 'list'}
        >
            <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                {children}
            </div>
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
            {leaveGuard.confirmation}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <ListPage
                notices={(
                    <StatusMessage
                        variant="error"
                        recovery={{
                            label: 'Try again',
                            onAction: () => {
                                setContacts(null);
                                return loadContacts();
                            },
                        }}
                    >
                        {loadError}
                    </StatusMessage>
                )}
            />,
        );
    }

    if (contacts === null) {
        return wrap(
            <ListPage>
                <div role="status" aria-label="Loading contacts">
                    <Skeleton.List rows={5} />
                </div>
            </ListPage>,
        );
    }

    if (mode === 'scan') {
        return (
            <ScanRoute
                nested
                onBack={() => {
                    setScanFromEdit(false);
                    setScanForAddress(false);
                    setMode(scanForAddress ? 'add-address' : scanFromEdit ? 'edit' : 'list');
                }}
                onClassified={handleScanned}
                chainRegistry={chainRegistry}
            />
        );
    }

    if (mode === 'add-address' && active) {
        // Add Address: paste, type or scan the address (Scan sits inside the
        // field, U53); the network is read from it, asked only when the
        // address cannot say; an optional Label; Save Address.
        return wrap(
            <FormPage
                label="Add address"
                onSubmit={handleAddAddress}
                status={addAddrError ? (
                    <StatusMessage variant="error" title="Fix 1 thing to continue">
                        {addAddrError}
                    </StatusMessage>
                ) : null}
                actions={(
                    <Button type="submit" variant="success" icon={<Icon.SaveIcon />} loading={addAddrSaving}>
                        Save Address
                    </Button>
                )}
            >
                <AddressField
                    label="Address"
                    help={CONTACT_ADDRESS_HELP}
                    icon="scan"
                    onIconClick={() => { setScanForAddress(true); setMode('scan'); }}
                    value={addAddrValue}
                    onChange={(ev) => { setAddAddrValue(ev.target.value); setAddAddrChain(null); setAddAddrError(null); }}
                    error={addAddrError}
                    placeholder=""
                    autoFocus
                    autoComplete="off"
                />
                <NetworkReadout
                    address={addAddrValue}
                    chain={chainFor(addAddrValue, addAddrChain)}
                    onPick={(chain) => { setAddAddrChain(chain); setAddAddrError(null); }}
                    style={{ margin: '0.25rem 0 0.75rem' }}
                />
                <Input
                    label="Label"
                    help={CONTACT_LABEL_HELP}
                    optional
                    value={addAddrLabel}
                    onChange={(ev) => setAddAddrLabel(stripBidiControls(ev.target.value))}
                    autoComplete="off"
                />
            </FormPage>,
        );
    }

    if (mode === 'edit' && !active) {
        // Simple create form: name, address, notes. The coin network is
        // auto-detected from the address as the user types (Bitcoin /
        // Litecoin / Dogecoin / Unknown) and stored on the entry's chain.
        const entry0 = formEntries[0];
        return wrap(
            <FormPage
                label="New contact"
                onSubmit={handleSave}
                status={submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button type="submit" variant="primary" loading={submitting}>
                        Create contact
                    </Button>
                )}
            >
                <Input label="Name" help={CONTACT_NAME_HELP} value={formName} onChange={(e) => setFormName(stripBidiControls(e.target.value))} />
                <AddressField
                    label="Address"
                    help={CONTACT_ADDRESS_HELP}
                    value={entry0.address}
                    onChange={(e) => {
                        const address = e.target.value;
                        setFormEntries([{ ...entry0, address, chain: chainFor(address) }]);
                    }}
                    placeholder=""
                    autoComplete="off"
                />
                <NetworkReadout
                    address={entry0.address}
                    chain={entry0.chain}
                    onPick={(chain) => setFormEntries([{ ...entry0, chain }])}
                    style={{ margin: '0.25rem 0 0.75rem' }}
                />
                <Textarea
                    label="Notes"
                    aria-label="Notes"
                    help={CONTACT_NOTES_HELP}
                    optional
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                />
            </FormPage>,
        );
    }

    if (mode === 'edit' && active) {
        // Name, look and notes; existing addresses are preserved on save via
        // formEntries (populated from the contact by startEdit). Addresses are
        // managed from the detail view, not this form. The look sits with the
        // name the way Edit Wallet lays it out (RenameWalletForm): the current
        // tile centred on top, the name, then the shared TileLookFields.
        const previewContact = { ...active, name: formName || active.name, look: formLook };
        return wrap(
            <FormPage
                label="Edit contact"
                onSubmit={handleSave}
                status={submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button type="submit" variant="success" icon={<Icon.SaveIcon />} loading={submitting}>
                        Update Contact
                    </Button>
                )}
            >
                <div data-contact-look-preview="" style={{ display: 'flex', justifyContent: 'center' }}>
                    <ContactAvatar contact={previewContact} context="hero" />
                </div>
                <Input label="Name" help={CONTACT_NAME_HELP} value={formName} onChange={(e) => setFormName(stripBidiControls(e.target.value))} />
                <TileLookFields
                    kind="contact"
                    colour={formLook.colour || contactDefaultTone(active)}
                    onColour={(colour) => setFormLook((prev) => ({ ...prev, colour }))}
                    shape={formLook.shape || 'circle'}
                    onShape={(shape) => setFormLook((prev) => ({ ...prev, shape }))}
                    image={formLook.image}
                    onImage={(image) => setFormLook((prev) => ({ ...prev, image }))}
                />
                <Textarea
                    label="Notes"
                    aria-label="Notes"
                    help={CONTACT_NOTES_HELP}
                    optional
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                />
            </FormPage>,
        );
    }

    const contactDetail = active ? (() => {
        const primary = active.entries[0];
        const multiAddress = active.entries.length > 1;
        // Fire a Send/Message for a specific entry, then close the picker.
        const runAction = (action, entry) => {
            if (action === 'send') onSend?.({ chainId: chainIdFor(resolvedChain(entry), entry.address), address: entry.address });
            else onSendMessage?.({ chainId: chainIdFor(resolvedChain(entry), entry.address), toAddress: entry.address });
            setAddrPicker(null);
        };
        // Single-address contacts act immediately; multi-address ones toggle a
        // dropdown so the user can pick which address to use (clicking the same
        // button again closes it).
        const startAction = (action) => {
            if (!primary) return;
            if (multiAddress) setAddrPicker((cur) => (cur === action ? null : action));
            else runAction(action, primary);
        };
        return (
            <ListPage>
                {notice ? <StatusMessage variant="success">{notice}</StatusMessage> : null}
                <div className={picker.infoCard}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-3)' }}>
                        <ContactAvatar contact={active} context="hero" />
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 'var(--xc-text-lg)', fontWeight: 600, overflowWrap: 'anywhere' }}>{active.name}</div>
                        </div>
                    </div>
                </div>

                {/* G102: Actions, Addresses and Details tabs under the header,
                    Actions first and chosen (operator pick 2026-11-15, layout 2). */}
                <ActionsDetailsToggle
                    label="Contact sections"
                    view={detailView}
                    onViewChange={setDetailView}
                    extra={{
                        id: 'addresses',
                        label: 'Addresses',
                        icon: <Icon.AddressIcon />,
                        panel: (
                            <div className={picker.panelStack}>
                                {/* One card per address (layout 5) with its own
                                    Copy, Send and Remove buttons: an operator
                                    ruling for contact address cards (G124),
                                    in place of G101 and G111 here. */}
                                {active.entries.length > 0 ? (
                                    <ul className={picker.addressCards} aria-label="Addresses">
                                        {active.entries.map((e, i) => {
                                            const network = networkNameFor(e);
                                            const chainId = chainIdFor(resolvedChain(e), e.address);
                                            const ticker = chainId ? tickerForDescriptor(chainRegistry.get(chainId)) : '';
                                            const label = e.label?.trim() || '';
                                            return (
                                                <li key={`${e.chain}:${e.address}`} className={picker.addressCard} data-contact-address-card="">
                                                    <div className={picker.addressCardHead}>
                                                        <ChainCoinIcon chain={resolvedChain(e)} address={e.address} size="md" />
                                                        <strong className={picker.addressCardName}>{network}</strong>
                                                        {label ? <span className={picker.addressCardLabel}>{label}</span> : null}
                                                        {ticker ? <span className={picker.addressCardTicker}>{ticker}</span> : null}
                                                    </div>
                                                    <div className={picker.addressCardRow}>
                                                        <span className={picker.factLabel}>Address</span>
                                                        <AddressText address={e.address} truncate={false} className={picker.addressCardAddress} />
                                                    </div>
                                                    <div className={picker.addressCardActions}>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            className={picker.addressCardAction}
                                                            icon={<Icon.CopyIcon />}
                                                            aria-label={`Copy ${network} address`}
                                                            onClick={() => handleCopyAddress(e.address)}
                                                        >
                                                            Copy
                                                        </Button>
                                                        {/* Send opens the Send form with this
                                                            address in To and its network chosen. */}
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            className={picker.addressCardAction}
                                                            icon={<Icon.SendIcon />}
                                                            aria-label={`Send to ${network} address`}
                                                            onClick={() => onSend?.({ chainId, address: e.address })}
                                                            disabled={!onSend || !chainId}
                                                        >
                                                            Send
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            className={picker.addressCardAction}
                                                            icon={<Icon.TrashIcon />}
                                                            aria-label={`Remove ${network} address`}
                                                            onClick={() => handleDeleteAddress(i)}
                                                            disabled={deleting !== null}
                                                            aria-busy={deleting === `address:${i}`}
                                                        >
                                                            Remove
                                                        </Button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : null}
                                {/* The standard add row (an action list row with
                                    its one-line description). */}
                                <ActionList label="Add an address">
                                    <ActionListItem
                                        icon={<Icon.PlusIcon />}
                                        title="Add address"
                                        description="Save another address for this contact"
                                        onClick={startAddAddress}
                                    />
                                </ActionList>
                            </div>
                        ),
                    }}
                    actions={(
                        <div className={picker.actionsWrap} ref={actionsRef}>
                            {/* G101: one action list, a row per action, Delete in red. */}
                            <ActionList label="Contact actions">
                                <ActionListItem
                                    icon={<Icon.SendIcon />}
                                    title="Send"
                                    description={multiAddress ? 'Choose an address and send to it' : 'Send coins or tokens to this contact'}
                                    onClick={() => startAction('send')}
                                    disabled={!onSend || !primary}
                                    aria-haspopup={multiAddress ? 'menu' : undefined}
                                    aria-expanded={multiAddress ? (addrPicker === 'send') : undefined}
                                />
                                <ActionListItem
                                    icon={<Icon.MessageIcon />}
                                    title="Message"
                                    description={multiAddress ? 'Choose an address and message it' : 'Send this contact an on-chain message'}
                                    onClick={() => startAction('message')}
                                    disabled={!onSendMessage || !primary}
                                    aria-haspopup={multiAddress ? 'menu' : undefined}
                                    aria-expanded={multiAddress ? (addrPicker === 'message') : undefined}
                                />
                                <ActionListItem
                                    icon={<Icon.PencilIcon />}
                                    title="Edit"
                                    description="Change the name, icon or notes"
                                    onClick={() => startEdit(active)}
                                />
                                <ActionListItem
                                    icon={<Icon.UploadIcon />}
                                    title="Share"
                                    description="Share the name and every address"
                                    onClick={handleShareContact}
                                />
                                <ActionListItem
                                    icon={<Icon.TrashIcon />}
                                    title={deleting === `contact:${active.id}` ? 'Deleting…' : 'Delete'}
                                    description="Remove this contact from the wallet"
                                    tone="danger"
                                    onClick={() => handleDelete(active.id)}
                                    disabled={deleting !== null}
                                    aria-busy={deleting === `contact:${active.id}`}
                                />
                            </ActionList>
                            {addrPicker ? (
                                <ul className={picker.addrMenu} role="menu" aria-label="Choose an address">
                                    <li className={picker.addrMenuHead}>
                                        {addrPicker === 'send' ? 'Send to' : 'Message to'}
                                    </li>
                                    {active.entries.map((e, i) => (
                                        <li key={i}>
                                            <Button
                                                type="button"
                                                role="menuitem"
                                                className={picker.addrMenuItem}
                                                onClick={() => runAction(addrPicker, e)}
                                            >
                                                <ChainCoinIcon chain={resolvedChain(e)} address={e.address} />
                                                <AddressText address={e.address} className={picker.addressText} />
                                                {e.label ? <span style={{ color: 'var(--xc-fg-muted)', marginLeft: '0.25rem' }}>({e.label})</span> : null}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    )}
                    details={(
                        // G14: the facts card, then the notes (moved here out
                        // of the header, operator 2026-11-15).
                        <div className={picker.panelStack}>
                            <dl className={facts.list} data-contact-facts="">
                                <dt className={facts.label}>Name</dt>
                                <dd className={facts.value}>{active.name}</dd>
                                <dt className={facts.label}>Networks</dt>
                                <dd className={facts.value}>{contactNetworks(active) || 'None'}</dd>
                                <dt className={facts.label}>Addresses</dt>
                                <dd className={facts.value}>{active.entries.length.toLocaleString('en-US')}</dd>
                                <dt className={facts.label}>Added</dt>
                                <dd className={facts.value}>{addedOn(active.createdAt)}</dd>
                            </dl>
                            {active.notes ? (
                                <section className={`${picker.infoCard} ${picker.addressCardRow}`} aria-label="Notes" data-contact-notes="">
                                    <span className={picker.factLabel}>Notes</span>
                                    <p className={picker.notesText}>{active.notes}</p>
                                </section>
                            ) : null}
                        </div>
                    )}
                />
            </ListPage>
        );
    })() : null;

    if (mode === 'detail' && active && !twoPanel) return wrap(contactDetail);

    const contactsList = (
        <ListPage
            notices={(
                <>
                    {duplicateGroups.length > 0 ? (
                        <StatusMessage
                            id="contacts-duplicate-names"
                            recovery={{ label: merging ? 'Merging…' : 'Merge', onAction: handleMergeDuplicates }}
                        >
                            {duplicateGroups.length === 1
                                ? `${duplicateGroups[0].length} contacts are named ${duplicateGroups[0][0].name}.`
                                : `${duplicateGroups.length} names are used by more than one contact.`}
                            {' '}Merge them into one contact per person, with all of their addresses.
                        </StatusMessage>
                    ) : null}
                    {unpublished > 0 && !nudgeDismissed && contacts.length > 0 ? (
                        <StatusMessage
                            id="contacts-publish-nudge"
                            recovery={typeof onOpenBackup === 'function'
                                ? { label: 'Open Backup', onAction: onOpenBackup }
                                : { label: 'Dismiss', onAction: () => setNudgeDismissed(true) }}
                        >
                            {unpublished === 1
                                ? 'One contact change is only on this device.'
                                : `${unpublished} contact changes are only on this device.`}
                            {' '}Publish labels on-chain from Settings &gt; Backup so restoring from your seed brings them back.
                            {typeof onOpenBackup === 'function' ? (
                                <>
                                    {' '}
                                    <Button type="button" variant="link" size="sm" onClick={() => setNudgeDismissed(true)}>
                                        Not now
                                    </Button>
                                </>
                            ) : null}
                        </StatusMessage>
                    ) : null}
                </>
            )}
        >
            {/* Text only: Add contact is the title bar plus, offered once. */}
            {contacts.length === 0 ? (
                <EmptyState
                    title="No contacts yet"
                    body="Saved contacts label addresses across the inbox and history."
                />
            ) : filteredContacts.length === 0 ? (
                <EmptyState
                    title="No results for these filters"
                    body="Reset the filters to see all contacts."
                    actionLabel="Reset Filters"
                    onAction={() => {
                        setQuery('');
                        setNetworkFilter('all');
                    }}
                />
            ) : (
                <ul className={picker.list} aria-label="Contacts" data-xc-split-list={twoPanel ? '' : undefined}>
                    {filteredContacts.map((c, index) => {
                        const uniqueChains = [...new Map((c.entries || []).map((entry) => [
                            `${resolvedChain(entry)}:${chainIdFor(resolvedChain(entry), entry.address) || ''}`,
                            entry,
                        ])).values()];
                        return (
                            <li
                                key={c.id}
                                data-selected={twoPanel && activeId === c.id ? 'true' : undefined}
                                style={{ borderTop: index === 0 ? 'none' : '1px solid var(--xc-border)' }}
                            >
                                <ListRow
                                    type="button"
                                    className={picker.row}
                                    data-xc-split-row={twoPanel ? '' : undefined}
                                    onClick={() => openContact(c)}
                                    aria-label={c.name}
                                    aria-current={twoPanel && activeId === c.id ? 'true' : undefined}
                                    chevron
                                    leading={<ContactAvatar contact={c} context="list" />}
                                    title={<span className={picker.rowName}>{c.name}</span>}
                                    trailing={(
                                        <span className={picker.rowChains}>
                                            {uniqueChains.map((entry) => (
                                                <ChainCoinIcon
                                                    key={`${resolvedChain(entry)}:${entry.address}`}
                                                    chain={resolvedChain(entry)}
                                                    address={entry.address}
                                                />
                                            ))}
                                        </span>
                                    )}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </ListPage>
    );

    if (twoPanel && contactDetail) {
        return (
            <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="contacts"
                    resizeLabel="Resize the contacts list"
                    resizeHint="Drag to resize the contacts list, or press Enter to reset."
                    layoutName="two-panel"
                    list={contactsList}
                    listLabel="Contacts"
                    detail={contactDetail}
                    detailLabel={active.name}
                />
                {confirmDialog.request ? (
                    <ConfirmModal
                        {...confirmDialog.request}
                        onConfirm={confirmDialog.onConfirm}
                        onCancel={confirmDialog.onCancel}
                    />
                ) : null}
                {leaveGuard.confirmation}
            </Screen>
        );
    }

    return wrap(contactsList);
}

// Find an existing contact that already holds `address`. Bech32 comparison is
// case-insensitive by specification, while Base58 comparison remains
// case-sensitive. Returns the first match, or null.
export function findContactByAddress(contacts, address, chain) {
    const needle = contactAddressKey(address);
    if (!needle || !Array.isArray(contacts)) return null;
    return contacts.find((c) =>
        Array.isArray(c.entries)
        && c.entries.some((e) => (
            (!chain || normalizedContactChain(e.chain) === normalizedContactChain(chain))
            && contactAddressKey(e.address) === needle
        )),
    ) || null;
}

function findRepeatedAddress(entries) {
    const seen = new Set();
    for (const entry of entries || []) {
        const key = `${normalizedContactChain(entry?.chain)}|${contactAddressKey(entry?.address)}`;
        if (!key) continue;
        if (seen.has(key)) return entry.address.trim();
        seen.add(key);
    }
    return null;
}

function normalizedContactChain(chain) {
    return String(chain || '').trim().toLowerCase();
}

function contactAddressKey(address) {
    const trimmed = String(address || '').trim();
    const lower = trimmed.toLowerCase();
    return /^(bc|tb|bcrt|ltc|tltc|rltc)1/.test(lower) ? lower : trimmed;
}

/**
 * The chainId a contact entry's Send / Message prefill should open on. The
 * network is read from the address bytes when they say (a `tb1` or an
 * `n`-leading 0x71 Dogecoin address is testnet, not mainnet), and falls back
 * to mainnet when the bytes are shared across networks. A testnet contact
 * used to open the mainnet form no matter what its address said.
 *
 * @param {string} chain      coin family, 'bitcoin' | 'litecoin' | 'dogecoin' | 'unknown'
 * @param {string} [address]
 * @returns {string | null}
 */
function chainIdFor(chain, address) {
    if (chain !== 'bitcoin' && chain !== 'litecoin' && chain !== 'dogecoin') return null;
    const network = detectAddressChain(address)?.network || 'mainnet';
    const exact = `${chain}-${network}`;
    return chainRegistry.get(exact) ? exact : `${chain}-mainnet`;
}

function coinFamilyFromChainId(chainId) {
    if (typeof chainId !== 'string') return null;
    if (chainId.startsWith('bitcoin')) return 'bitcoin';
    if (chainId.startsWith('litecoin')) return 'litecoin';
    if (chainId.startsWith('dogecoin')) return 'dogecoin';
    return null;
}

/**
 * "Network: Bitcoin" under an address field, or, when the address is real
 * but its network cannot be read from its bytes, a picker offering only the
 * networks that address could belong to. Renders nothing for an empty
 * field. Garbage that is not an address at all shows "Unknown" and is left
 * to the save-time validator's message.
 *
 * @param {object} props
 * @param {string} props.address
 * @param {string} props.chain            the resolved chain ('unknown' when undecided)
 * @param {(chain: string) => void} props.onPick
 * @param {React.CSSProperties} [props.style]
 */
function NetworkReadout({ address, chain, onPick, style }) {
    const trimmed = (address || '').trim();
    if (!trimmed) return null;
    const opt = NETWORK_OPTIONS.find((n) => n.value === chain) || null;
    const decoded = detectAddressChain(trimmed);
    const undecided = !opt && decoded && decoded.candidates.length > 1;
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)', ...style };
    if (!undecided) {
        return (
            <div style={rowStyle}>
                {opt ? <img src={opt.iconUrl} alt="" className={picker.chainIcon} /> : null}
                <span>Network: {opt ? opt.label : 'Unknown'}</span>
            </div>
        );
    }
    // U59: the standard Network field opens the network picker, offering only
    // the networks this address could belong to. It stays empty until the
    // user picks; the pick is stored as the coin family.
    const choices = NETWORK_OPTIONS
        .filter((n) => decoded.candidates.includes(n.value))
        .map((n) => chainIdFor(n.value, trimmed))
        .filter(Boolean);
    return (
        <div style={{ ...style, display: 'grid', gap: 'var(--xc-space-2)' }}>
            <StatusMessage title="Choose a Network">
                The network cannot be read from this address. Which is it?
            </StatusMessage>
            <NetworkField
                label="Network"
                help="The blockchain this contact's address belongs to. The contact is saved on that network, and payments to it go there."
                value=""
                chainIds={choices}
                chainRegistry={chainRegistry}
                onChange={(chainId) => {
                    const family = coinFamilyFromChainId(chainId);
                    if (family) onPick(family);
                }}
            />
        </div>
    );
}
