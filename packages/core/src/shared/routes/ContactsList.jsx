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
    ScreenHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useToast } from '../components/ToastHost.jsx';
import { ScanRoute } from './ScanRoute.jsx';
import styles from './IssueTokenForm.module.css';
import picker from './ContactsList.module.css';

// Each entry carries the icon URL at module load time so the dropdown
// renders without any async work. Uses mainnet icons because contacts
// store coin families, not per-network chainIds.
const NETWORK_OPTIONS = [
    { value: 'bitcoin',  label: 'Bitcoin',  iconUrl: branding.chainIconSmallUrl('bitcoin-mainnet') },
    { value: 'litecoin', label: 'Litecoin', iconUrl: branding.chainIconSmallUrl('litecoin-mainnet') },
    { value: 'dogecoin', label: 'Dogecoin', iconUrl: branding.chainIconSmallUrl('dogecoin-mainnet') },
];

const chainRegistry = registryLib.defaultRegistry();

/**
 * Lightweight custom dropdown for the network filter. A native <select>
 * cannot render images inside options, so we build a small trigger +
 * popover pattern (the same shape as ChainPicker, but much simpler at
 * only 4 fixed options).
 */
function NetworkDropdown({ value, onChange }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (popoverRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const selected = NETWORK_OPTIONS.find((n) => n.value === value) || null;

    return (
        <div className={picker.networkWrap}>
            <button
                ref={triggerRef}
                type="button"
                className={picker.networkTrigger}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                aria-label="Filter by network"
            >
                <span className={picker.networkTriggerIcon} aria-hidden="true">
                    {selected?.iconUrl ? <img src={selected.iconUrl} alt="" /> : <Icon.FilterIcon />}
                </span>
                <span className={picker.networkTriggerLabel}>
                    {selected ? selected.label : 'All Networks'}
                </span>
                <span className={picker.networkCaret} aria-hidden="true">&#9660;</span>
            </button>
            {open ? (
                <ul ref={popoverRef} className={picker.networkPopover} role="listbox">
                    {[{ value: 'all', label: 'All Networks', iconUrl: null, icon: <Icon.FilterIcon /> }, ...NETWORK_OPTIONS].map((n) => (
                        <li key={n.value}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={value === n.value ? 'true' : 'false'}
                                className={`${picker.networkOption} ${value === n.value ? picker.networkOptionActive : ''}`}
                                onClick={() => { onChange(n.value); setOpen(false); }}
                            >
                                <span className={picker.networkOptionIcon} aria-hidden="true">
                                    {n.iconUrl ? <img src={n.iconUrl} alt="" /> : n.icon || null}
                                </span>
                                {n.label}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
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
 * @param {(prefill: { chainId?: string, toAddress?: string }) => void} [props.onSendMessage]
 * @param {() => void} props.onBack
 * @param {{ address: string, chainId?: string } | null} [props.scanPrefill] Address
 *   scanned via the global AppHeader QR button while this route is mounted.
 *   When set, the component opens the new-contact edit form with the address
 *   pre-filled, then calls onScanPrefillConsumed to clear it in the parent.
 * @param {() => void} [props.onScanPrefillConsumed]
 */
export function ContactsList({ walletId, onSendMessage, onBack, scanPrefill, onScanPrefillConsumed }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { showToast } = useToast();

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
    // route is active, App.jsx sets scanPrefill and we open the new-contact
    // form with that address already filled in.
    useEffect(() => {
        if (!scanPrefill) return;
        const chain = coinFamilyFromChainId(scanPrefill.chainId) || 'bitcoin';
        setActiveId(null);
        setFormName('');
        setFormNotes('');
        setFormEntries([{ chain, address: scanPrefill.address, label: '' }]);
        setSubmitError(null);
        setMode('edit');
        onScanPrefillConsumed?.();
    }, [scanPrefill, onScanPrefillConsumed]);

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
                setActiveId(null);
                setFormName('');
                setFormNotes('');
                setFormEntries([{ chain, address: outcome.address, label: '' }]);
                setSubmitError(null);
                setMode('edit');
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
        if (!confirm('Delete this contact?')) return;
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

    const header = (
        <ScreenHeader
            onBack={() => {
                if (mode !== 'list') {
                    setMode(mode === 'edit' && active ? 'detail' : 'list');
                    if (mode === 'edit' && !active) setActiveId(null);
                } else {
                    onBack();
                }
            }}
            title={mode === 'edit'
                ? (active ? 'Edit contact' : 'New contact')
                : mode === 'detail' ? 'Contact' : 'Contacts'}
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

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
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

    if (mode === 'edit') {
        return wrap(
            <form onSubmit={handleSave} noValidate>
                <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} />
                <Input label="Notes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
                <p style={{ margin: '0.5rem 0 0.25rem', fontWeight: 600 }}>Addresses</p>
                {formEntries.map((entry, i) => (
                    <div
                        key={i}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: isFull ? '1fr 2fr 1fr auto' : '1fr',
                            gap: '0.25rem',
                            marginBottom: '0.5rem',
                        }}
                    >
                        <select
                            className={styles.select}
                            value={entry.chain}
                            onChange={(e) => {
                                const next = [...formEntries];
                                next[i] = { ...next[i], chain: e.target.value };
                                setFormEntries(next);
                            }}
                        >
                            <option value="bitcoin">Bitcoin</option>
                            <option value="litecoin">Litecoin</option>
                            <option value="dogecoin">Dogecoin</option>
                        </select>
                        <Input
                            label=""
                            aria-label={`Address ${i + 1}`}
                            value={entry.address}
                            onChange={(e) => {
                                const next = [...formEntries];
                                next[i] = { ...next[i], address: e.target.value };
                                setFormEntries(next);
                            }}
                            placeholder="Address"
                        />
                        <Input
                            label=""
                            aria-label={`Label ${i + 1}`}
                            value={entry.label}
                            onChange={(e) => {
                                const next = [...formEntries];
                                next[i] = { ...next[i], label: e.target.value };
                                setFormEntries(next);
                            }}
                            placeholder="Label (optional)"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove address ${i + 1}`}
                            onClick={() => {
                                if (formEntries.length === 1) return;
                                setFormEntries(formEntries.filter((_, idx) => idx !== i));
                            }}
                            disabled={formEntries.length === 1}
                        >
                            ×
                        </Button>
                    </div>
                ))}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFormEntries([...formEntries, { chain: 'bitcoin', address: '', label: '' }])}
                >
                    + Add address
                </Button>
                {submitError ? (
                    <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>{submitError}</p>
                ) : null}
                <div className={styles.actions}>
                    <Button type="submit" variant="primary" loading={submitting}>
                        Save
                    </Button>
                </div>
            </form>,
        );
    }

    if (mode === 'detail' && active) {
        const primary = active.entries[0];
        return wrap(
            <>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Name</dt>
                    <dd className={styles.detailsValue}>{active.name}</dd>
                    {active.notes ? (
                        <>
                            <dt className={styles.detailsLabel}>Notes</dt>
                            <dd className={styles.detailsValue}>{active.notes}</dd>
                        </>
                    ) : null}
                </dl>

                <p style={{ margin: '0.5rem 0 0.25rem', fontWeight: 600 }}>Addresses</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {active.entries.map((e, i) => {
                        const chainId = chainIdFor(e.chain);
                        const d = chainId ? chainRegistry.get(chainId) : null;
                        return (
                            <li key={i} style={{ padding: '0.25rem 0' }}>
                                {d ? <ChainBadge descriptor={d} size="sm" /> : <span>{e.chain}</span>}
                                {' '}<AddressText address={e.address} />
                                {e.label ? <span style={{ color: 'var(--xc-fg-muted)', marginLeft: '0.5rem' }}>({e.label})</span> : null}
                            </li>
                        );
                    })}
                </ul>

                <div className={styles.actions}>
                    {onSendMessage && primary ? (
                        <Button
                            variant="primary"
                            onClick={() => onSendMessage({
                                chainId: chainIdFor(primary.chain),
                                toAddress: primary.address,
                            })}
                        >
                            Send message
                        </Button>
                    ) : null}
                    <Button variant="ghost" onClick={() => startEdit(active)}>Edit</Button>
                    <Button variant="danger" onClick={() => handleDelete(active.id)}>Delete</Button>
                    <Button variant="ghost" onClick={() => { setActiveId(null); setMode('list'); }}>Back to list</Button>
                </div>
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
                <NetworkDropdown value={networkFilter} onChange={setNetworkFilter} />
            </div>
            {contacts.length === 0 ? (
                <div className={picker.emptyCard}>No contacts yet. Tap + to add one and label addresses across the inbox and history.</div>
            ) : filteredContacts.length === 0 ? (
                <div className={picker.emptyCard}>No contacts match your filters.</div>
            ) : (
                <ul className={picker.list}>
                    {filteredContacts.map((c) => {
                        // Prefer the entry on the filtered network so the row
                        // subtitle shows the address the user is filtering for;
                        // otherwise fall back to the contact's primary entry.
                        const display = (networkFilter !== 'all'
                            && c.entries.find((e) => e.chain === networkFilter))
                            || c.entries[0];
                        const chainId = display ? chainIdFor(display.chain) : null;
                        const d = chainId ? chainRegistry.get(chainId) : null;
                        return (
                            <li key={c.id}>
                                <button
                                    type="button"
                                    className={picker.row}
                                    onClick={() => { setActiveId(c.id); setMode('detail'); }}
                                >
                                    {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                                    <span className={picker.rowMain}>
                                        <span className={picker.rowName}>{c.name}</span>
                                        <span className={picker.rowSub}>
                                            {display ? <AddressText address={display.address} /> : null}
                                        </span>
                                    </span>
                                    <span className={picker.rowCount}>
                                        {c.entries.length} address{c.entries.length === 1 ? '' : 'es'}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>,
    );
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
