import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §41.7.4 Contacts. List + detail + create/edit in one route — the
 * UX is read-heavy enough that a separate detail route isn't worth
 * the navigation overhead. Modes:
 *   - 'list'   — table of contacts + Add button
 *   - 'detail' — read view of one contact + Send message / Edit / Delete
 *   - 'edit'   — form for new or existing contact
 *
 * On send-message the parent App.jsx navigates to ComposeMessage with
 * the contact's primary entry pre-filled.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(prefill: { chainId?: string, toAddress?: string }) => void} [props.onSendMessage]
 * @param {() => void} props.onBack
 */
export function ContactsList({ walletId, onSendMessage, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [contacts, setContacts] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [mode, setMode] = useState(/** @type {'list' | 'detail' | 'edit'} */ ('list'));
    const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));

    // Edit-mode form state.
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
        try {
            await messaging.deleteContact({ id });
            setActiveId(null);
            setMode('list');
            await loadContacts();
        } catch (err) {
            setLoadError(err?.message || 'Delete failed.');
        }
    }

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={() => {
                    if (mode !== 'list') {
                        setMode(mode === 'edit' && active ? 'detail' : 'list');
                        if (mode === 'edit' && !active) setActiveId(null);
                    } else {
                        onBack();
                    }
                }}
                className={styles.back}
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>
                {mode === 'edit' ? (active ? 'Edit contact' : 'New contact')
                    : mode === 'detail' ? 'Contact'
                    : 'Contacts'}
            </span>
            <span className={styles.spacer} />
        </div>
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
                    <Button variant="ghost" onClick={onBack}>Back</Button>
                </div>
            </>,
        );
    }

    if (contacts === null) {
        return wrap(<p className={styles.hint}>Loading contacts…</p>);
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
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setMode(active ? 'detail' : 'list')}
                        disabled={submitting}
                    >
                        Cancel
                    </Button>
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
                                {e.label ? <span style={{ color: 'var(--xc-fg-muted)', marginLeft: '0.5rem' }}>— {e.label}</span> : null}
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
            {contacts.length === 0 ? (
                <p className={styles.hint}>No contacts yet. Add one to label addresses in the inbox and history.</p>
            ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {contacts.map((c) => (
                        <li key={c.id}>
                            <button
                                type="button"
                                onClick={() => { setActiveId(c.id); setMode('detail'); }}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    textAlign: 'left',
                                    padding: '0.5rem',
                                    marginBottom: '0.25rem',
                                    border: '1px solid var(--xc-border)',
                                    borderRadius: '4px',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    color: 'inherit',
                                }}
                            >
                                <div style={{ fontWeight: 600 }}>{c.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--xc-fg-muted)' }}>
                                    {c.entries.length} address{c.entries.length === 1 ? '' : 'es'}
                                    {c.entries[0] ? <> · <AddressText address={c.entries[0].address} /></> : null}
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div className={styles.actions}>
                <Button variant="primary" onClick={() => { setActiveId(null); startEdit(null); }}>
                    + Add contact
                </Button>
                <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>
        </>,
    );
}

function chainIdFor(chain) {
    // Default to mainnet. Contacts don't currently distinguish network
    // kinds — if a user has a testnet-only contact, entries.chain can
    // still be 'bitcoin' and the wallet's own testnet addresses will
    // match when the entry address happens to be a testnet address.
    if (chain === 'bitcoin') return 'bitcoin-mainnet';
    if (chain === 'litecoin') return 'litecoin-mainnet';
    if (chain === 'dogecoin') return 'dogecoin-mainnet';
    return null;
}
