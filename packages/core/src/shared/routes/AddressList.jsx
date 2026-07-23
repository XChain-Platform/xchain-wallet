// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    AddressText,
    MultisigBadge,
    Skeleton,
    Input,
    Icon,
    ChainPicker,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { EmptyStateNudge } from '../components/EmptyStateNudge.jsx';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { AddAddressModal, addressTypeHint } from './AddAddressModal.jsx';
import { coinFromChainId, formatAmount, fiatValue } from '../components/BalanceList.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import styles from './History.module.css';
import local from './AddressList.module.css';
import wifStyles from './AddressList.wif.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Format a fiat value in the user's selected currency (symbol + amount),
// e.g. "$32.10" / "¥3,200". The 3-letter code is appended by the caller.
function formatFiatAmount(value, currency) {
    if (value === null || value === undefined) return '';
    const code = String(currency || 'USD').toUpperCase();
    try {
        const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'symbol' });
        const minorUnit = fmt.resolvedOptions().maximumFractionDigits === 0 ? 1 : 0.01;
        if (value > 0 && value < minorUnit) return `<${fmt.format(minorUnit)}`;
        return fmt.format(value);
    } catch {
        return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
}

/**
 * §22 + §56.3 Pre-launch Step 2: Standalone address list. Aggregates
 * every address the wallet has generated across every chain, rendered
 * as a single flat list. Each row shows chain badge + label +
 * shortened address + copy button; rows whose address equals the
 * wallet's `getMultisigReceiveAddress` output on the BTC chain carry
 * the `<MultisigBadge>` indicator inline.
 *
 * Filtering is in-page: a toolbar with a search box + network dropdown
 * (50/50, matching the contacts list and Send address book) narrows the
 * list by address/label text and by network. The `networkFilter` /
 * `tokenQuery` props seed the initial values so deep-links still apply.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, only that account's addresses are shown
 * @param {() => void} props.onBack
 * @param {() => void} [props.onReceive]
 * @param {(address: { id: string, address: string, source: string, chain: string, network: string, derivationPath: string | null, label: string }) => void} [props.onShowPrivateKey]   §17.7: when supplied, the detail view exposes a "Secret" affordance for non-multisig rows with a record, handing that address back to the caller (shell wires it to <ViewPrivateKey>)
 * @param {Array<{ key: string, label: string, sublabel?: string, onSelect: () => void }>} [props.pickerActions]   picker mode only: caller-supplied rows rendered above the address list (e.g. Dispenser's "New dispenser address"); unaffected by search/filters
 */
export function AddressList({
    walletId,
    accountId,
    onBack,
    onReceive,
    onShowPrivateKey,
    networkFilter = 'all',
    tokenQuery = '',
    pickerMode = false,
    onPick,
    pickerActions = [],
    title,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { settings } = useSettings();
    const fiatCurrency = (settings?.fiatCurrency || 'USD').toUpperCase();
    // App-wide Privacy Mode (the Home eye toggle): when on, mask every
    // per-address balance here too, matching BalanceList's dot convention.
    const [balancesHidden] = useBalancesHidden();
    // Unlocked session: WIF import runs off the pooled signer's master
    // key, so the password field only renders when the wallet is locked.
    const signerReady = useSignerReady(walletId);

    // In-page search + network filter (toolbar below), seeded from any
    // shell-provided defaults so deep-links still apply on first render.
    const [query, setQuery] = useState(tokenQuery || '');
    const [network, setNetwork] = useState(networkFilter || 'all');
    // Address-type toggle: all | normal (hd) | imported (wif). Hardware/multisig
    // addresses have no dedicated tab; they surface under "All".
    const [sourceFilter, setSourceFilter] = useState('all');

    // Selected address row -> shows the address detail view in place of the list.
    const [selected, setSelected] = useState(/** @type {any | null} */ (null));
    // Bump to refetch addresses + balances after a label edit or delete.
    const [reloadKey, setReloadKey] = useState(0);
    // Inline label editor state for the detail view.
    const [labelDraft, setLabelDraft] = useState('');
    const [labelSaving, setLabelSaving] = useState(false);
    // Brief "copied" feedback on the inline address copy icon.
    const [addrCopied, setAddrCopied] = useState(false);

    // "+" menu in the header: Add address / Import address.
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const addMenuRef = useRef(null);
    useEffect(() => {
        if (!addMenuOpen) return undefined;
        const onDown = (e) => { if (!addMenuRef.current?.contains(e.target)) setAddMenuOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setAddMenuOpen(false); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [addMenuOpen]);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // Per-address native balances, so each row can show e.g. "0.0005 BTC".
    const [balancesByChain, setBalancesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    useEffect(() => {
        if (!walletId || typeof messaging.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        messaging.getWalletBalances(walletId, accountId)
            .then((b) => { if (!cancelled) setBalancesByChain(b || {}); })
            .catch(() => { if (!cancelled) setBalancesByChain({}); });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    // Resolved active (operating) address per chain: the row matching it gets
    // the green "Active" bubble and the detail view hides "Set active" for it.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    useEffect(() => {
        if (!walletId || typeof messaging.getActiveAddresses !== 'function') return undefined;
        let cancelled = false;
        messaging.getActiveAddresses(walletId, accountId)
            .then((m) => { if (!cancelled) setActiveByChain(m || {}); })
            .catch(() => { if (!cancelled) setActiveByChain({}); });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, reloadKey]);

    const isActiveRow = (row) => (
        !!row?.address && activeByChain[row.chainId]?.address === row.address
    );

    // address (chainId:address) -> native balance { quantity, tick, divisibility }.
    const nativeByKey = useMemo(() => {
        const m = new Map();
        if (!balancesByChain) return m;
        for (const [chainId, entries] of Object.entries(balancesByChain)) {
            if (!Array.isArray(entries)) continue;
            for (const e of entries) {
                const nb = e?.balances?.native;
                if (!e?.address || !nb || nb.quantity == null) continue;
                m.set(`${chainId}:${String(e.address).toLowerCase()}`, {
                    quantity: nb.quantity,
                    tick: nb.tick || null,
                    divisibility: Number(nb.divisibility ?? 8),
                    fiatRate: typeof nb.fiatRate === 'number' ? nb.fiatRate : null,
                });
            }
        }
        return m;
    }, [balancesByChain]);

    // Formatted native balance for a row, e.g. "0.0005 BTC". Privacy Mode
    // masks it everywhere this is rendered (list rows + detail Balance).
    const amountTextFor = (row) => {
        if (balancesHidden) return '•••••';
        const d = chainRegistry.get(row.chainId);
        const nativeTick = tickerForCoin(d?.coin);
        const nb = nativeByKey.get(`${row.chainId}:${String(row.address || '').toLowerCase()}`);
        return nb
            ? `${formatAmount(nb.quantity, nb.divisibility)} ${nb.tick || nativeTick}`
            : `0 ${nativeTick}`;
    };
    // Formatted fiat value for a row, with the currency code (e.g. "$32.10 USD"),
    // or '' when there's no price/balance.
    const fiatTextFor = (row) => {
        const nb = nativeByKey.get(`${row.chainId}:${String(row.address || '').toLowerCase()}`);
        if (!nb) return '';
        const v = fiatValue(nb.quantity, nb.divisibility, nb.fiatRate);
        return v === null ? '' : `${formatFiatAmount(v, fiatCurrency)} ${fiatCurrency}`;
    };

    // Human label for the address type, mirroring the toggle categories.
    const typeLabelFor = (row) => (
        row.multisig
            ? 'Multisig'
            : row.record?.source === 'imported-wif'
                ? 'Imported'
                : row.record?.source === 'hd'
                    ? 'Normal'
                    : 'Other'
    );

    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [multisigs, setMultisigs] = useState(
        /** @type {Array<{ multisigConfigId: string, address: string, threshold: number, cosignerCount: number, scheme: string }>} */ ([]),
    );
    // §15.5 / G020 + G021: Import WIF inline form. Hidden until the user
    // expands it; gates submit on the §15.5.3 backup-implications warning
    // checkbox.
    const [showWifForm, setShowWifForm] = useState(false);
    const [wifChainId, setWifChainId] = useState('');
    const [wifInput, setWifInput] = useState('');
    const [wifLabel, setWifLabel] = useState('');
    const [wifPassword, setWifPassword] = useState('');
    const [wifAddressType, setWifAddressType] = useState('');
    const [wifWarningAck, setWifWarningAck] = useState(false);
    const [wifBusy, setWifBusy] = useState(false);
    const [wifError, setWifError] = useState(/** @type {string | null} */ (null));
    const [wifNotice, setWifNotice] = useState(/** @type {string | null} */ (null));

    function resetWifForm() {
        setWifAddressType('');
        setWifChainId('');
        setWifInput('');
        setWifLabel('');
        setWifPassword('');
        setWifWarningAck(false);
        setWifError(null);
    }

    async function handleImportWif(event) {
        event.preventDefault();
        if (wifBusy) return;
        if (!wifWarningAck) {
            setWifError('Please acknowledge the backup warning before importing.');
            return;
        }
        if (!wifChainId) {
            setWifError('Pick a chain.');
            return;
        }
        if (wifInput.trim().length === 0) {
            setWifError('Paste a WIF private key.');
            return;
        }
        if (!signerReady && wifPassword.length === 0) {
            setWifError('Wallet password is required to encrypt the imported key.');
            return;
        }
        if (typeof messaging.importWifRequest !== 'function') {
            setWifError('Import WIF is not available in this shell.');
            return;
        }
        setWifBusy(true);
        setWifError(null);
        try {
            const r = await messaging.importWifRequest({
                addressType: wifAddressType || undefined,
                ...(signerReady ? {} : { password: wifPassword }),
                walletId,
                password: wifPassword,
                chainId: wifChainId,
                wif: wifInput.trim(),
                label: wifLabel.trim() || undefined,
            });
            const importedAddress = r?.address?.address || '(unknown)';
            setWifNotice(`Imported ${importedAddress}.`);
            resetWifForm();
            setShowWifForm(false);
            const byChain = await messaging.getAddressesByChain(walletId, accountId);
            setAddressesByChain(byChain || {});
        } catch (err) {
            setWifError(err?.message || 'Failed to import WIF.');
        } finally {
            setWifBusy(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, reloadKey]);

    useEffect(() => {
        let cancelled = false;
        const btc = chainRegistry.byCoin('bitcoin')[0]?.id;
        if (!btc) return undefined;
        const fetcher = typeof messaging.listMultisigReceiveAddresses === 'function'
            ? messaging.listMultisigReceiveAddresses({ walletId, chainId: btc })
                .then((list) => Array.isArray(list) ? list : [])
            : (typeof messaging.getMultisigReceiveAddress === 'function'
                ? messaging.getMultisigReceiveAddress({ walletId, chainId: btc })
                    .then((r) => (r && typeof r.address === 'string' ? [r] : []))
                : Promise.resolve([]));
        fetcher
            .then((list) => {
                if (cancelled) return;
                setMultisigs(list);
            })
            .catch(() => { /* no multisig configured; silent */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const rows = useMemo(() => {
        if (!addressesByChain) return [];
        const multisigByAddress = new Map(
            multisigs
                .filter((m) => typeof m.address === 'string')
                .map((m) => [m.address.toLowerCase(), m]),
        );
        const networkMatch = (chainId) => (
            network === 'all' || coinFromChainId(chainId) === network
        );
        /** @type {Array<{ key: string, chainId: string, address: string, label: string, multisig: any, record: any }>} */
        const out = [];
        for (const [chainId, addrs] of Object.entries(addressesByChain)) {
            if (!networkMatch(chainId)) continue;
            if (!Array.isArray(addrs)) continue;
            for (const a of addrs) {
                const matched = multisigByAddress.get((a.address || '').toLowerCase()) || null;
                out.push({
                    key: `${chainId}:${a.address}`,
                    chainId,
                    address: a.address,
                    label: a.label || '',
                    multisig: matched,
                    record: a,
                });
            }
        }
        // Synthesize one row per multisig config when its derived address
        // isn't already in the wallet's address table; Receive derives
        // them on-demand and doesn't necessarily persist them.
        const btc = chainRegistry.byCoin('bitcoin')[0]?.id;
        if (btc && networkMatch(btc)) {
            for (const m of multisigs) {
                if (!out.some((r) => r.address?.toLowerCase() === m.address.toLowerCase())) {
                    out.push({
                        key: `${btc}:${m.address}:synthetic`,
                        chainId: btc,
                        address: m.address,
                        label: 'Multisig receive',
                        multisig: m,
                        record: null,
                    });
                }
            }
        }
        let next = out;
        // Address-type filter. Multisig is always "other"; otherwise classify
        // by the record's source ('hd' = normal, 'imported-wif' = imported).
        if (sourceFilter !== 'all') {
            next = next.filter((r) => {
                // Misc catches everything that is neither a plain HD receive
                // address nor a WIF import: dispenser-role addresses,
                // multisig, hardware, watch-only.
                const cat = r.multisig
                    ? 'misc'
                    : r.record?.role === 'dispenser'
                        ? 'misc'
                        : r.record?.source === 'imported-wif'
                            ? 'imported'
                            : r.record?.source === 'hd'
                                ? 'normal'
                                : 'misc';
                return cat === sourceFilter;
            });
        }
        const q = String(query || '').trim().toLowerCase();
        if (q) {
            next = next.filter((r) => (
                String(r.address || '').toLowerCase().includes(q)
                || String(r.label || '').toLowerCase().includes(q)
            ));
        }
        return next;
    }, [addressesByChain, network, query, sourceFilter, multisigs]);

    // Add addresses is its own page, same pattern as Import address.
    if (showAddModal) {
        return (
            <AddAddressModal
                walletId={walletId}
                accountId={accountId}
                chainIds={Object.keys(addressesByChain || {})}
                onClose={() => setShowAddModal(false)}
                onGenerated={() => setReloadKey((k) => k + 1)}
            />
        );
    }

    // Import address is its own page (not an inline bar): the + menu
    // navigates here, and back returns to the list. The success notice
    // renders back on the list after the import completes.
    if (showWifForm) {
        return (
            <Screen
                variant={variant}
                header={(
                    <PageHeader
                        onBack={() => { setShowWifForm(false); resetWifForm(); }}
                        title="Import address"
                        titleIcon={<Icon.DownloadIcon />}
                    />
                )}
            >
                <form className={wifStyles.wifForm} onSubmit={handleImportWif} noValidate>
                        <ChainPicker
                            label="Chain"
                            value={wifChainId}
                            onChange={(cid) => {
                                setWifChainId(cid);
                                setWifAddressType(chainRegistry.get(cid)?.defaultAddressType || '');
                                if (wifError) setWifError(null);
                            }}
                            chainIds={Object.keys(addressesByChain || {})}
                            chainRegistry={chainRegistry}
                            disabled={wifBusy}
                        />
                        {wifChainId ? (
                            <label className={wifStyles.wifField}>
                                <span className={wifStyles.wifLabel}>Address type</span>
                                <select
                                    value={wifAddressType}
                                    onChange={(e) => setWifAddressType(e.target.value)}
                                    disabled={wifBusy}
                                    className={wifStyles.wifSelect}
                                >
                                    {(chainRegistry.get(wifChainId)?.addressTypes || []).map((t) => {
                                        const hint = addressTypeHint(chainRegistry.get(wifChainId), t);
                                        return (
                                            <option key={t} value={t}>
                                                {t.toUpperCase()}{hint ? ` (starts with ${hint})` : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                        ) : null}
                        <Input
                            label="WIF private key"
                            value={wifInput}
                            onChange={(e) => {
                                setWifInput(e.target.value);
                                if (wifError) setWifError(null);
                            }}
                            placeholder="L1aW…"
                            autoComplete="off"
                            spellCheck={false}
                            disabled={wifBusy}
                        />
                        <Input
                            label="Label (optional)"
                            value={wifLabel}
                            onChange={(e) => setWifLabel(e.target.value)}
                            placeholder="e.g. Cold storage 2024"
                            autoComplete="off"
                            disabled={wifBusy}
                        />
                        {signerReady ? null : (
                        <Input
                            type="password"
                            label="Wallet password"
                            hint="Required even while unlocked: your password derives the vault's encryption key, which is never kept in memory, and the imported key must be encrypted with it."
                            value={wifPassword}
                            onChange={(e) => {
                                setWifPassword(e.target.value);
                                if (wifError) setWifError(null);
                            }}
                            autoComplete="current-password"
                            disabled={wifBusy}
                        />
                        )}
                        <p className={wifStyles.wifWarning}>
                            <strong>Not covered by your recovery phrase.</strong>{' '}
                            Keep a copy of the WIF, or a current backup file (Settings &gt; Backup).
                        </p>
                        <label className={wifStyles.wifAck}>
                            <input
                                type="checkbox"
                                checked={wifWarningAck}
                                onChange={(e) => {
                                    setWifWarningAck(e.target.checked);
                                    if (wifError) setWifError(null);
                                }}
                                disabled={wifBusy}
                            />
                            <span>I understand this key is not backed up by my recovery phrase.</span>
                        </label>
                        {wifError ? (
                            <div role="alert" className={wifStyles.wifErrorBox}>{wifError}</div>
                        ) : null}
                        <div className={wifStyles.wifActions}>
                            <Button
                                type="submit"
                                variant="primary"
                                size="md"
                                loading={wifBusy}
                                disabled={!wifWarningAck || wifInput.trim().length === 0 || (!signerReady && wifPassword.length === 0) || !wifChainId}
                            >
                                Import
                            </Button>
                        </div>
                </form>
            </Screen>
        );
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={title || (pickerMode ? 'Choose address' : 'Addresses')}
            titleIcon={<Icon.ScanIcon />}
            trailing={(
                <div className={local.addMenuWrap} ref={addMenuRef}>
                    <button
                        type="button"
                        className={local.addBtn}
                        onClick={() => setAddMenuOpen((o) => !o)}
                        aria-haspopup="menu"
                        aria-expanded={addMenuOpen}
                        aria-label="Add or import address"
                        title="Add address"
                    >
                        <Icon.PlusIcon />
                    </button>
                    {addMenuOpen ? (
                        <ul className={local.addMenu} role="menu">
                            <li>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={local.addMenuItem}
                                    onClick={() => { setAddMenuOpen(false); setShowAddModal(true); }}
                                >
                                    <span className={local.addMenuIcon} aria-hidden="true"><Icon.PlusIcon /></span>
                                    Add address
                                </button>
                            </li>
                            <li>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={local.addMenuItem}
                                    onClick={() => {
                                        setAddMenuOpen(false);
                                        setWifNotice(null);
                                        const first = Object.keys(addressesByChain || {})[0] || '';
                                        if (!wifChainId && first) {
                                            setWifChainId(first);
                                            setWifAddressType(chainRegistry.get(first)?.defaultAddressType || '');
                                        }
                                        setShowWifForm(true);
                                    }}
                                >
                                    <span className={local.addMenuIcon} aria-hidden="true"><Icon.DownloadIcon /></span>
                                    Import address
                                </button>
                            </li>
                        </ul>
                    ) : null}
                </div>
            )}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
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

    if (!addressesByChain) {
        return wrap(
            <div role="status" aria-label="Loading addresses">
                <Skeleton.List rows={5} />
            </div>,
        );
    }

    // Address detail view: shown in place of the list when a row is tapped.
    if (selected) {
        const d = chainRegistry.get(selected.chainId);
        const canSecret = !!(onShowPrivateKey && selected.record && !selected.multisig);
        const canDelete = !!selected.record?.id;
        const fields = [
            { label: 'Network', value: d?.displayName || selected.chainId },
            { label: 'Balance', value: amountTextFor(selected) },
            { label: 'Type', value: typeLabelFor(selected) },
        ];
        if (selected.record?.addressType) {
            fields.push({ label: 'Address format', value: String(selected.record.addressType).toUpperCase() });
        }
        if (selected.multisig) {
            fields.push({
                label: 'Multisig',
                value: `${selected.multisig.threshold}-of-${selected.multisig.cosignerCount} (${selected.multisig.scheme})`,
            });
        }
        if (selected.record?.derivationPath) {
            fields.push({ label: 'Derivation path', value: selected.record.derivationPath });
        }
        const openXchain = () => {
            const base = d?.explorer?.defaultUrl || branding.DEFAULT_EXPLORER_BASE;
            if (!base) return;
            try { window.open(`${base}/address/${selected.address}`, '_blank', 'noopener'); } catch { /* no-op */ }
        };
        const saveLabel = async () => {
            if (!selected.record?.id || labelSaving) return;
            setLabelSaving(true);
            try {
                const next = labelDraft.trim();
                await messaging.setAddressLabel(selected.record.id, next);
                setSelected({ ...selected, label: next, record: { ...selected.record, label: next } });
                setReloadKey((k) => k + 1);
            } catch (err) {
                setLoadError(err?.message || 'Failed to save label.');
            } finally {
                setLabelSaving(false);
            }
        };
        const copyAddress = () => {
            try {
                navigator.clipboard?.writeText?.(selected.address);
                setAddrCopied(true);
                setTimeout(() => setAddrCopied(false), 1200);
            } catch { /* no-op */ }
        };
        const removeAddress = async () => {
            if (!selected.record?.id) return;
            if (!confirm('Delete this address? An imported key is gone unless you have a separate backup.')) return;
            try {
                await messaging.deleteAddress(selected.record.id);
                setSelected(null);
                setReloadKey((k) => k + 1);
            } catch (err) {
                setLoadError(err?.message || 'Failed to delete address.');
            }
        };
        const setAsActive = async () => {
            if (!selected.record?.id || typeof messaging.setActiveAddress !== 'function') return;
            try {
                await messaging.setActiveAddress(accountId, selected.chainId, selected.record.id);
                // Leave the addresses section entirely and return to Home. The
                // active address is persisted before we navigate, so Home's
                // fresh mount refetches balances against the new active address.
                onBack?.();
            } catch (err) {
                setLoadError(err?.message || 'Failed to set active address.');
            }
        };
        return (
            <Screen variant={variant} header={<PageHeader onBack={() => setSelected(null)} title="View Address" titleIcon={<Icon.ScanIcon />} />}>
                <div className={local.detailTop}>
                    <div className={local.detailLabelRow}>
                        <span className={local.detailLabel}>Address</span>
                        {isActiveRow(selected) ? (
                            <span className={local.addrActive}>Active</span>
                        ) : null}
                    </div>
                    <div className={local.detailAddr}>
                        <AddressText address={selected.address} truncate={false} />
                        <button
                            type="button"
                            className={local.copyIcon}
                            onClick={copyAddress}
                            aria-label="Copy address"
                            title="Copy address"
                        >
                            {addrCopied ? <Icon.CheckIcon /> : <Icon.CopyIcon />}
                        </button>
                    </div>
                    <div className={local.detailLabel} style={{ marginTop: 'var(--xc-space-3)' }}>Label</div>
                    {selected.record?.id ? (
                        <div className={local.labelRow}>
                            <Input
                                label=""
                                value={labelDraft}
                                onChange={(e) => setLabelDraft(e.target.value)}
                                placeholder="Add a label"
                                aria-label="Address label"
                            />
                            <Button
                                size="md"
                                variant="primary"
                                loading={labelSaving}
                                disabled={labelDraft.trim() === (selected.label || '')}
                                onClick={saveLabel}
                            >
                                Save
                            </Button>
                        </div>
                    ) : (
                        <div className={`${local.detailName} ${selected.label ? '' : local.detailNameEmpty}`}>
                            {selected.label || 'No label'}
                        </div>
                    )}
                </div>

                <div className={local.quickActions} role="group" aria-label="Address actions">
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={setAsActive}
                        disabled={!selected.record?.id}
                        title={isActiveRow(selected) ? 'This is the active address' : 'Make this the active address'}
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.ReceiveIcon /></span>
                        <span>Use</span>
                    </button>
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={() => onShowPrivateKey?.(selected.record)}
                        disabled={!canSecret}
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.KeyIcon /></span>
                        <span>Secret</span>
                    </button>
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={openXchain}
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.ExternalLinkIcon /></span>
                        <span>XChain</span>
                    </button>
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={removeAddress}
                        disabled={!canDelete}
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.TrashIcon /></span>
                        <span>Delete</span>
                    </button>
                </div>

                <div className={local.tabsRow} role="tablist" aria-label="Address sections">
                    <button type="button" role="tab" aria-selected="true" className={`${local.tab} ${local.tabActive}`}>
                        About
                    </button>
                </div>

                <div className={local.tabPanel}>
                    <div className={local.detailCard}>
                        {fields.map((f) => (
                            <div key={f.label} className={local.detailField}>
                                <div className={local.detailLabel}>{f.label}</div>
                                <div className={local.detailValue}>{f.value}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </Screen>
        );
    }

    const activeChainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    if (activeChainIds.length === 0 && multisigs.length === 0) {
        return wrap(
            <EmptyStateNudge
                title="No addresses yet"
                body="Generate a receive address to populate this list."
                actionLabel={onReceive ? 'Receive' : undefined}
                onAction={onReceive}
                icon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />,
        );
    }

    return wrap(
        <>
            <div className={local.toolbar}>
                <input
                    type="text"
                    className={local.search}
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Search addresses"
                />
                <NetworkFilterDropdown value={network} onChange={setNetwork} />
            </div>
            <div className={local.segmented} role="tablist" aria-label="Filter by address type">
                {[
                    { id: 'all', label: 'All' },
                    { id: 'normal', label: 'Normal' },
                    { id: 'imported', label: 'Imported' },
                    { id: 'misc', label: 'Misc' },
                ].map((opt) => (
                    <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={sourceFilter === opt.id}
                        className={`${local.segment} ${sourceFilter === opt.id ? local.segmentActive : ''}`}
                        onClick={() => setSourceFilter(opt.id)}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
            {wifNotice ? (
                <div className={wifStyles.wifBar}>
                    <p className={wifStyles.wifNotice} role="status">{wifNotice}</p>
                </div>
            ) : null}


            {pickerMode && pickerActions.length > 0 ? (
                <ul className={`${local.addrList} ${local.pickerActionsList}`} aria-label="Picker options">
                    {pickerActions.map((act) => (
                        <li key={act.key}>
                            <button type="button" className={local.addrRow} onClick={act.onSelect}>
                                <div className={local.addrTopRow}>
                                    <span className={local.addrLabel}>{act.label}</span>
                                </div>
                                {act.sublabel ? (
                                    <div className={local.addrLine2}>
                                        <span className={local.addrFiat}>{act.sublabel}</span>
                                    </div>
                                ) : null}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
            {rows.length === 0 ? (
                <div className={local.emptyCard}>
                    No addresses match the current filter.
                </div>
            ) : (
            <ul className={local.addrList} aria-label="Wallet addresses">
                {rows.map((row) => {
                    const d = chainRegistry.get(row.chainId);
                    const iconUrl = d ? branding.chainIconSmallUrl(d.id) : null;
                    return (
                        <li key={row.key}>
                            <button
                                type="button"
                                className={local.addrRow}
                                onClick={() => {
                                    if (pickerMode && onPick && row.record) { onPick(row.record); return; }
                                    setSelected(row);
                                    setLabelDraft(row.label || '');
                                }}
                                aria-label={`View address ${row.address}`}
                            >
                                {(row.label || isActiveRow(row)) ? (
                                    <div className={local.addrTopRow}>
                                        <span className={local.addrLabel}>{row.label || ''}</span>
                                        {isActiveRow(row) ? (
                                            <span className={local.addrActive}>Active</span>
                                        ) : null}
                                    </div>
                                ) : null}
                                <div className={local.addrLine1}>
                                    {iconUrl ? (
                                        <img src={iconUrl} alt="" className={local.chainIcon} width={16} height={16} />
                                    ) : null}
                                    <AddressText address={row.address} truncate={false} />
                                    {row.multisig ? (
                                        <MultisigBadge
                                            threshold={row.multisig.threshold}
                                            cosignerCount={row.multisig.cosignerCount}
                                            scheme={row.multisig.scheme}
                                            size="sm"
                                        />
                                    ) : null}
                                </div>
                                <div className={local.addrLine2}>
                                    <span className={local.addrAmount}>{amountTextFor(row)}</span>
                                    {fiatTextFor(row) ? (
                                        <span className={local.addrFiat}>{balancesHidden ? '•••' : fiatTextFor(row)}</span>
                                    ) : null}
                                </div>
                            </button>
                        </li>
                    );
                })}
            </ul>
            )}
        </>,
    );
}
