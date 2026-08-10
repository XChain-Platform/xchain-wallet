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
import { Button, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useToast } from '../components/ToastHost.jsx';
import { NETWORK_OPTIONS, NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { isValidAddressAnyNetwork } from '../utils/addressValidation.js';
import { ScanRoute } from './ScanRoute.jsx';
import styles from './IssueTokenForm.module.css';
import picker from './ContactsList.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Small round coin badge for a contact entry's chain. Shows the network
 * icon when the chain is recognized, or a question-mark-in-a-circle when
 * the address format could not be matched to a known network ('unknown').
 */
function ChainCoinIcon({ chain }) {
    const opt = NETWORK_OPTIONS.find((n) => n.value === chain);
    if (opt) return <img src={opt.iconUrl} alt={opt.label} className={picker.chainIcon} />;
    return (
        <span className={picker.unknownIcon} aria-label="Unknown network" title="Unknown network">?</span>
    );
}

/**
 * §41.7.4 Contacts. List + detail + create/edit in one route; the
 * UX is read-heavy enough that a separate detail route isn't worth
 * the navigation overhead. Modes:
 *   - 'list'   - table of contacts + Add button
 *   - 'detail' - read view of one contact + Send message / Edit / Delete
 *   - 'edit'   - form for new or existing contact
 *   - 'scan'   - QR scanner, launched from either list or edit
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
 */
export function ContactsList({ walletId, onSend, onSendMessage, onBack, scanPrefill, onScanPrefillConsumed }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { showToast } = useToast();
    const confirmDialog = useConfirmModal();

    const [contacts, setContacts] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [mode, setMode] = useState(/** @type {'list' | 'detail' | 'edit' | 'scan'} */ ('list'));
    const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));

    // Tracks whether the QR scanner was launched from the edit form, so
    // handleScanned knows to merge the address into the current form state
    // rather than resetting it.
    const [scanFromEdit, setScanFromEdit] = useState(false);

    // List-view filters. `query` is a free-text match over name / notes /
    // any entry address or label; `networkFilter` keeps only contacts that
    // hold at least one address on that chain.
    const [query, setQuery] = useState('');
    const [networkFilter, setNetworkFilter] = useState(/** @type {'all' | string} */ ('all'));

    const [formName, setFormName] = useState('');
    const [formNotes, setFormNotes] = useState('');
    const [formEntries, setFormEntries] = useState(
        /** @type {{ chain: string, address: string, label: string }[]} */ ([
            { chain: 'bitcoin', address: '', label: '' },
        ]),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [submitting, setSubmitting] = useState(false);

    // Add-address modal (launched from the detail view's + button).
    const [addAddrOpen, setAddAddrOpen] = useState(false);
    const [addAddrValue, setAddAddrValue] = useState('');
    const [addAddrError, setAddAddrError] = useState(/** @type {string | null} */ (null));
    const [addAddrSaving, setAddAddrSaving] = useState(false);

    // Address-picker dropdown shown when a multi-address contact's Send or
    // Message action needs the user to choose which address to use.
    const [addrPicker, setAddrPicker] = useState(/** @type {'send' | 'message' | null} */ (null));
    const actionsRef = useRef(null);

    const loadContacts = useCallback(async () => {
        try {
            const rows = await messaging.listContacts();
            setContacts(Array.isArray(rows) ? rows : []);
        } catch (err) {
            setLoadError(err?.message || 'Failed to load contacts.');
        }
    }, [messaging]);

    useEffect(() => { loadContacts(); }, [loadContacts]);

    const active = useMemo(() => {
        if (!activeId || !contacts) return null;
        return contacts.find((c) => c.id === activeId) || null;
    }, [activeId, contacts]);

    const filteredContacts = useMemo(() => {
        if (!contacts) return [];
        const q = query.trim().toLowerCase();
        return contacts.filter((c) => {
            const entries = Array.isArray(c.entries) ? c.entries : [];
            if (networkFilter !== 'all' && !entries.some((e) => e.chain === networkFilter)) {
                return false;
            }
            if (!q) return true;
            if (c.name?.toLowerCase().includes(q)) return true;
            if (c.notes?.toLowerCase().includes(q)) return true;
            return entries.some((e) =>
                e.address?.toLowerCase().includes(q) || e.label?.toLowerCase().includes(q),
            );
        });
    }, [contacts, query, networkFilter]);

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
        const chain = coinFamilyFromChainId(scanPrefill.chainId) || 'bitcoin';
        setActiveId(null);
        setFormName('');
        setFormNotes('');
        setFormEntries([{ chain, address: scanPrefill.address, label: '' }]);
        setSubmitError(null);
        setMode('edit');
        onScanPrefillConsumed?.();
    }, [scanPrefill, contacts, onScanPrefillConsumed]);

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
            setFormName(contact.name);
            setFormNotes(contact.notes || '');
            setFormEntries(contact.entries.length
                ? contact.entries.map((e) => ({ chain: e.chain, address: e.address, label: e.label || '' }))
                : [{ chain: 'bitcoin', address: '', label: '' }]);
        } else {
            setFormName('');
            setFormNotes('');
            setFormEntries([{ chain: 'bitcoin', address: '', label: '' }]);
        }
        setSubmitError(null);
        setMode('edit');
    }

    function launchScanFromEdit() {
        setScanFromEdit(true);
        setMode('scan');
    }

    function handleScanned(outcome) {
        // ScanRoute fires { kind: 'send', address, chainId? } for plain
        // addresses, BIP21, and xchain: send URIs.
        if (outcome && outcome.kind === 'send' && outcome.address) {
            const chain = coinFamilyFromChainId(outcome.chainId) || 'bitcoin';
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
            showToast({ message: 'No address detected in that QR code.' });
        }
    }

    async function handleSave(event) {
        event.preventDefault();
        if (submitting) return;
        if (!formName.trim()) {
            setSubmitError('Name is required.');
            return;
        }
        const cleanedEntries = formEntries
            .map((e) => ({ chain: e.chain, address: e.address.trim(), label: e.label }))
            .filter((e) => e.chain && e.address);
        if (cleanedEntries.length === 0) {
            setSubmitError('At least one address entry is required.');
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
        setSubmitting(true);
        setSubmitError(null);
        try {
            if (active) {
                await messaging.saveContact({
                    record: { ...active, name: formName.trim(), notes: formNotes, entries: cleanedEntries },
                });
            } else {
                await messaging.saveContact({
                    input: { name: formName.trim(), notes: formNotes, entries: cleanedEntries },
                });
            }
            await loadContacts();
            setMode(active ? 'detail' : 'list');
        } catch (err) {
            setSubmitError(err?.message || 'Save failed.');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id) {
        if (!(await confirmDialog.confirm({ title: 'Delete this contact?', confirmLabel: 'Delete', danger: true }))) return;
        // Snapshot the full record before deletion so the §37.2 Undo
        // toast can re-create it via saveContact. We freeze the
        // displayed name here so the toast text doesn't change if the
        // user quickly creates another contact with the same id.
        const snapshot = contacts ? contacts.find((c) => c.id === id) : null;
        const displayName = snapshot?.name || 'Contact';
        try {
            await messaging.deleteContact({ id });
            setActiveId(null);
            setMode('list');
            await loadContacts();
            if (snapshot) {
                showToast({
                    message: `${displayName} deleted`,
                    actionLabel: 'Undo',
                    onAction: async () => {
                        try {
                            await messaging.saveContact({ record: snapshot });
                            await loadContacts();
                        } catch (err) {
                            setLoadError(err?.message || 'Restore failed.');
                        }
                    },
                });
            }
        } catch (err) {
            setLoadError(err?.message || 'Delete failed.');
        }
    }

    // Remove a single address entry from the active contact, after a
    // confirmation that mirrors the delete-contact prompt.
    async function handleDeleteAddress(index) {
        if (!active) return;
        if (!(await confirmDialog.confirm({ title: 'Delete this address?', confirmLabel: 'Delete', danger: true }))) return;
        const nextEntries = active.entries.filter((_, i) => i !== index);
        try {
            await messaging.saveContact({ record: { ...active, entries: nextEntries } });
            await loadContacts();
        } catch (err) {
            setLoadError(err?.message || 'Delete failed.');
        }
    }

    // Append the address typed in the add-address modal to the active
    // contact, auto-detecting its coin network.
    async function handleAddAddress() {
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
        setAddAddrSaving(true);
        setAddAddrError(null);
        const entry = { chain: detectAddressCoin(address), address, label: '' };
        try {
            await messaging.saveContact({ record: { ...active, entries: [...active.entries, entry] } });
            await loadContacts();
            setAddAddrOpen(false);
            setAddAddrValue('');
        } catch (err) {
            setAddAddrError(err?.message || 'Save failed.');
        } finally {
            setAddAddrSaving(false);
        }
    }

    const header = (
        <PageHeader
            onBack={() => {
                if (mode !== 'list') {
                    setMode(mode === 'edit' && active ? 'detail' : 'list');
                    if (mode === 'edit' && !active) setActiveId(null);
                } else {
                    onBack();
                }
            }}
            title={mode === 'edit'
                ? (active ? 'Edit Contact' : 'New contact')
                : mode === 'detail' ? 'View Contact' : 'Contacts'}
            titleIcon={
                mode === 'list' ? <Icon.UsersIcon />
                    : mode === 'detail' ? <Icon.UserIcon />
                    : (mode === 'edit' && active) ? <Icon.PencilIcon />
                    : (mode === 'edit' && !active) ? <Icon.PlusIcon />
                    : undefined
            }
            trailing={mode === 'list' ? (
                <button
                    type="button"
                    className={picker.addButton}
                    onClick={() => { setActiveId(null); startEdit(null); }}
                    aria-label="Add contact"
                    title="Add contact"
                >
                    <Icon.PlusIcon />
                </button>
            ) : null}
        />
    );

    // `card` controls the raised inner card used by the form/detail views
    // in the full (desktop) variant. The list view passes card=false so its
    // contacts card sits directly on the screen background, exactly like the
    // Home balances list (no card-in-card).
    const wrap = (children, { card = true } = {}) => (
        <Screen variant={variant} header={header}>
            {isFull && card ? <div className={styles.card}>{children}</div> : children}
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (contacts === null) {
        return wrap(<p className={styles.hint}>Loading contacts…</p>);
    }

    if (mode === 'scan') {
        return (
            <ScanRoute
                onBack={() => { setScanFromEdit(false); setMode(scanFromEdit ? 'edit' : 'list'); }}
                onClassified={handleScanned}
                chainRegistry={chainRegistry}
            />
        );
    }

    if (mode === 'edit' && !active) {
        // Simple create form: name, address, notes. The coin network is
        // auto-detected from the address as the user types (Bitcoin /
        // Litecoin / Dogecoin / Unknown) and stored on the entry's chain.
        const entry0 = formEntries[0];
        const detected = entry0.address.trim() ? entry0.chain : null;
        const detectedOpt = detected ? NETWORK_OPTIONS.find((n) => n.value === detected) : null;
        return wrap(
            <form onSubmit={handleSave} noValidate>
                <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} />
                <Input
                    label="Address"
                    value={entry0.address}
                    onChange={(e) => {
                        const address = e.target.value;
                        setFormEntries([{ ...entry0, address, chain: detectAddressCoin(address) }]);
                    }}
                    placeholder=""
                />
                {detected ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', margin: '0.25rem 0 0.75rem', fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)' }}>
                        {detectedOpt ? <img src={detectedOpt.iconUrl} alt="" className={picker.chainIcon} /> : null}
                        <span>Network: {detectedOpt ? detectedOpt.label : 'Unknown'}</span>
                    </div>
                ) : null}
                <div className={picker.notesField}>
                    <label className={picker.notesLabel}>Notes</label>
                    <textarea
                        className={picker.notesTextarea}
                        aria-label="Notes"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                    />
                </div>
                {submitError ? (
                    <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>{submitError}</p>
                ) : null}
                <div className={picker.formActions}>
                    <Button type="submit" variant="primary" block loading={submitting}>
                        Save
                    </Button>
                </div>
            </form>,
        );
    }

    if (mode === 'edit' && active) {
        // Name + notes only; existing addresses are preserved on save via
        // formEntries (populated from the contact by startEdit). Addresses are
        // managed from the detail view, not this form.
        return wrap(
            <form onSubmit={handleSave} noValidate>
                <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} />
                <div className={picker.notesField}>
                    <label className={picker.notesLabel}>Notes</label>
                    <textarea
                        className={picker.notesTextarea}
                        aria-label="Notes"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                    />
                </div>
                {submitError ? (
                    <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>{submitError}</p>
                ) : null}
                <div className={picker.formActions}>
                    <Button type="submit" variant="primary" block loading={submitting}>
                        Save
                    </Button>
                </div>
            </form>,
        );
    }

    if (mode === 'detail' && active) {
        const primary = active.entries[0];
        const multiAddress = active.entries.length > 1;
        // Fire a Send/Message for a specific entry, then close the picker.
        const runAction = (action, entry) => {
            if (action === 'send') onSend?.({ chainId: chainIdFor(entry.chain), address: entry.address });
            else onSendMessage?.({ chainId: chainIdFor(entry.chain), toAddress: entry.address });
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
        return wrap(
            <>
                <div className={picker.infoCard}>
                    <div style={{ fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>Name</div>
                    <div style={{ fontSize: 'var(--xc-text-lg)', fontWeight: 600 }}>{active.name}</div>
                    {active.notes ? (
                        <>
                            <div style={{ fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)', fontWeight: 700, margin: '0.75rem 0 0.25rem' }}>Notes</div>
                            <p style={{ margin: 0, color: 'var(--xc-text-muted)' }}>{active.notes}</p>
                        </>
                    ) : null}
                </div>

                <div className={picker.actionsWrap} ref={actionsRef}>
                    <div className={picker.quickActions} role="group" aria-label="Contact actions">
                        <button
                            type="button"
                            className={picker.quickAction}
                            onClick={() => startAction('send')}
                            disabled={!onSend || !primary}
                            aria-haspopup={multiAddress ? 'menu' : undefined}
                            aria-expanded={multiAddress ? (addrPicker === 'send') : undefined}
                        >
                            <span className={picker.quickActionIcon} aria-hidden="true"><Icon.SendIcon /></span>
                            <span>Send</span>
                        </button>
                        <button
                            type="button"
                            className={picker.quickAction}
                            onClick={() => startAction('message')}
                            disabled={!onSendMessage || !primary}
                            aria-haspopup={multiAddress ? 'menu' : undefined}
                            aria-expanded={multiAddress ? (addrPicker === 'message') : undefined}
                        >
                            <span className={picker.quickActionIcon} aria-hidden="true"><Icon.MessageIcon /></span>
                            <span>Message</span>
                        </button>
                        <button
                            type="button"
                            className={picker.quickAction}
                            onClick={() => startEdit(active)}
                        >
                            <span className={picker.quickActionIcon} aria-hidden="true"><Icon.PencilIcon /></span>
                            <span>Edit</span>
                        </button>
                        <button
                            type="button"
                            className={picker.quickAction}
                            onClick={() => handleDelete(active.id)}
                        >
                            <span className={picker.quickActionIcon} aria-hidden="true"><Icon.TrashIcon /></span>
                            <span>Delete</span>
                        </button>
                    </div>
                    {addrPicker ? (
                        <ul className={picker.addrMenu} role="menu" aria-label="Choose an address">
                            <li className={picker.addrMenuHead}>
                                {addrPicker === 'send' ? 'Send to' : 'Message to'}
                            </li>
                            {active.entries.map((e, i) => (
                                <li key={i}>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className={picker.addrMenuItem}
                                        onClick={() => runAction(addrPicker, e)}
                                    >
                                        <ChainCoinIcon chain={e.chain} />
                                        <span className={picker.addressText} title={e.address}>{e.address}</span>
                                        {e.label ? <span style={{ color: 'var(--xc-fg-muted)', marginLeft: '0.25rem' }}>({e.label})</span> : null}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>

                <div className={picker.tabsRow} role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected="true"
                        className={`${picker.tab} ${picker.tabActive}`}
                    >
                        <span className={picker.tabLabel}>Addresses</span>
                    </button>
                    <button
                        type="button"
                        className={picker.addAddressBtn}
                        onClick={() => { setAddAddrValue(''); setAddAddrError(null); setAddAddrOpen(true); }}
                        aria-label="Add address"
                        title="Add address"
                    >
                        <Icon.PlusIcon />
                    </button>
                </div>

                <ul className={picker.tabPanel} style={{ listStyle: 'none', padding: 0, margin: 'var(--xc-space-2) 0 0' }}>
                    {active.entries.map((e, i) => {
                        return (
                            <li key={i} className={picker.addressCard}>
                                <ChainCoinIcon chain={e.chain} />
                                <span className={picker.addressText} title={e.address}>{e.address}</span>
                                {e.label ? <span style={{ color: 'var(--xc-fg-muted)', marginLeft: '0.25rem' }}>({e.label})</span> : null}
                                <button
                                    type="button"
                                    className={picker.addressDeleteBtn}
                                    onClick={() => handleDeleteAddress(i)}
                                    aria-label="Delete address"
                                    title="Delete address"
                                >
                                    <Icon.XIcon />
                                </button>
                            </li>
                        );
                    })}
                </ul>

                {addAddrOpen ? (
                    <div
                        className={picker.modalOverlay}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Add address"
                        onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setAddAddrOpen(false); }}
                    >
                        <div className={picker.modalCard}>
                            <div className={picker.modalTitle}>Add address</div>
                            <Input
                                label="Address"
                                value={addAddrValue}
                                onChange={(ev) => { setAddAddrValue(ev.target.value); setAddAddrError(null); }}
                                placeholder=""
                                autoFocus
                            />
                            {addAddrValue.trim() ? (
                                (() => {
                                    const det = detectAddressCoin(addAddrValue);
                                    const detOpt = NETWORK_OPTIONS.find((n) => n.value === det);
                                    return (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', marginBottom: 'var(--xc-space-2)', fontSize: 'var(--xc-text-sm)', color: 'var(--xc-text-muted)' }}>
                                            {detOpt ? <img src={detOpt.iconUrl} alt="" className={picker.chainIcon} /> : null}
                                            <span>Network: {detOpt ? detOpt.label : 'Unknown'}</span>
                                        </div>
                                    );
                                })()
                            ) : null}
                            {addAddrError ? (
                                <p role="alert" className={styles.error} style={{ marginTop: '0.25rem' }}>{addAddrError}</p>
                            ) : null}
                            <div className={picker.modalActions}>
                                <Button type="button" variant="ghost" onClick={() => setAddAddrOpen(false)}>Cancel</Button>
                                <Button type="button" variant="primary" loading={addAddrSaving} onClick={handleAddAddress}>Add</Button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </>,
        );
    }

    // mode === 'list'
    return wrap(
        <>
            <div className={picker.toolbar}>
                <input
                    type="text"
                    className={picker.search}
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Search contacts"
                />
                <NetworkFilterDropdown value={networkFilter} onChange={setNetworkFilter} />
            </div>
            {contacts.length === 0 ? (
                <div className={picker.emptyCard}>No contacts yet. Tap + to add one and label addresses across the inbox and history.</div>
            ) : filteredContacts.length === 0 ? (
                <div className={picker.emptyCard}>No contacts match your filters.</div>
            ) : (
                <div className={picker.list} role="list" aria-label="Contacts">
                    {filteredContacts.map((c) => {
                        const uniqueChains = [...new Set((c.entries || []).map((e) => e.chain))];
                        return (
                            <button
                                key={c.id}
                                type="button"
                                role="listitem"
                                className={picker.row}
                                onClick={() => { setActiveId(c.id); setMode('detail'); }}
                            >
                                <span className={picker.rowName}>{c.name}</span>
                                <span className={picker.rowChains}>
                                    {uniqueChains.map((chain) => (
                                        <ChainCoinIcon key={chain} chain={chain} />
                                    ))}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </>,
        { card: false },
    );
}

// Find an existing contact that already holds `address`, comparing on the
// trimmed value case-insensitively. Bech32 addresses are case-insensitive by
// spec, and base58 addresses differing only by case don't occur in practice,
// so a lowercased compare is safe and avoids a false miss on a bech32 scan
// whose stored copy differs in case. Returns the first match, or null.
export function findContactByAddress(contacts, address) {
    const needle = (address || '').trim().toLowerCase();
    if (!needle || !Array.isArray(contacts)) return null;
    return contacts.find((c) =>
        Array.isArray(c.entries)
        && c.entries.some((e) => (e.address || '').trim().toLowerCase() === needle),
    ) || null;
}

function chainIdFor(chain) {
    // Default to mainnet. Contacts don't currently distinguish network
    // kinds; if a user has a testnet-only contact, entries.chain can
    // still be 'bitcoin' and the wallet's own testnet addresses will
    // match when the entry address happens to be a testnet address.
    if (chain === 'bitcoin') return 'bitcoin-mainnet';
    if (chain === 'litecoin') return 'litecoin-mainnet';
    if (chain === 'dogecoin') return 'dogecoin-mainnet';
    return null;
}

function coinFamilyFromChainId(chainId) {
    if (typeof chainId !== 'string') return null;
    if (chainId.startsWith('bitcoin')) return 'bitcoin';
    if (chainId.startsWith('litecoin')) return 'litecoin';
    if (chainId.startsWith('dogecoin')) return 'dogecoin';
    return null;
}

// Best-effort guess of which coin an address belongs to, from well-known
// address prefixes. Bech32 HRPs (bc1/ltc1/...) are unambiguous; mainnet
// base58 leading letters (1, L/M, D/A/9) are reliable. Shared testnet/regtest
// base58 prefixes (m/n/2) and bare '3' overlap across coins, so anything not
// clearly one chain returns 'unknown'. This is a heuristic for labeling, not
// real validation (the SDK validates addresses at send time).
function detectAddressCoin(address) {
    const a = (address || '').trim();
    if (!a) return 'unknown';
    const lower = a.toLowerCase();

    if (lower.startsWith('bc1') || lower.startsWith('tb1') || lower.startsWith('bcrt1')) return 'bitcoin';
    if (lower.startsWith('ltc1') || lower.startsWith('tltc1') || lower.startsWith('rltc1')) return 'litecoin';
    // Dogecoin has no bech32 address format, so it only matches base58 below.

    if (a.startsWith('1')) return 'bitcoin';                                    // BTC p2pkh
    if (a.startsWith('L') || a.startsWith('M')) return 'litecoin';              // LTC p2pkh / p2sh
    if (a.startsWith('D') || a.startsWith('A') || a.startsWith('9')) return 'dogecoin'; // DOGE p2pkh / p2sh
    if (a.startsWith('3')) return 'bitcoin';                                    // BTC p2sh (dominant case)

    return 'unknown';
}
