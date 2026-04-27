import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    ChainBadge,
    AddressText,
    CopyButton,
    MultisigBadge,
    Skeleton,
    Input,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { EmptyStateNudge } from '../components/EmptyStateNudge.jsx';
import styles from './History.module.css';
import wifStyles from './AddressList.wif.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §22 + §56.3 Pre-launch Step 2 — Standalone address list. Aggregates
 * every address the wallet has generated across every chain, rendered
 * as a single flat list. Each row shows chain badge + label +
 * shortened address + copy button; rows whose address equals the
 * wallet's `getMultisigReceiveAddress` output on the BTC chain carry
 * the `<MultisigBadge>` indicator inline.
 *
 * Filters:
 *   - Chain chips (toggle each chainId on/off; re-uses the History
 *     route's chip CSS for consistency)
 *   - "Multisig only" — keep only the multisig receive address row
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, only that account's addresses are shown
 * @param {() => void} props.onBack
 * @param {() => void} [props.onReceive]
 * @param {(address: { id: string, address: string, source: string, chain: string, network: string, derivationPath: string | null, label: string }) => void} [props.onShowPrivateKey]   §17.7 — when supplied, each non-multisig row gets a "Show key" affordance that hands the row's address back to the caller (shell wires it to <ViewPrivateKey>)
 */
export function AddressList({ walletId, accountId, onBack, onReceive, onShowPrivateKey }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [enabledChains, setEnabledChains] = useState(/** @type {Set<string>} */ (new Set()));
    const [multisigOnly, setMultisigOnly] = useState(false);
    const [multisigs, setMultisigs] = useState(
        /** @type {Array<{ multisigConfigId: string, address: string, threshold: number, cosignerCount: number, scheme: string }>} */ ([]),
    );
    // §15.5 / G020 + G021 — Import WIF inline form. Hidden until the user
    // expands it; gates submit on the §15.5.3 backup-implications warning
    // checkbox.
    const [showWifForm, setShowWifForm] = useState(false);
    const [wifChainId, setWifChainId] = useState('');
    const [wifInput, setWifInput] = useState('');
    const [wifLabel, setWifLabel] = useState('');
    const [wifPassword, setWifPassword] = useState('');
    const [wifWarningAck, setWifWarningAck] = useState(false);
    const [wifBusy, setWifBusy] = useState(false);
    const [wifError, setWifError] = useState(/** @type {string | null} */ (null));
    const [wifNotice, setWifNotice] = useState(/** @type {string | null} */ (null));

    function resetWifForm() {
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
        if (wifPassword.length === 0) {
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
            // Reload the address list so the new row appears.
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
                const initial = new Set(
                    Object.entries(byChain || {})
                        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                        .map(([cid]) => cid),
                );
                setEnabledChains(initial);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

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
            .catch(() => { /* no multisig configured — silent */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const rows = useMemo(() => {
        if (!addressesByChain) return [];
        // Map of lower-case address → matching multisig config so each
        // row knows which (if any) config it belongs to.
        const multisigByAddress = new Map(
            multisigs
                .filter((m) => typeof m.address === 'string')
                .map((m) => [m.address.toLowerCase(), m]),
        );
        /** @type {Array<{ key: string, chainId: string, address: string, label: string, multisig: any, record: any }>} */
        const out = [];
        for (const [chainId, addrs] of Object.entries(addressesByChain)) {
            if (!enabledChains.has(chainId)) continue;
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
        // Synthesize one row per multisig config when its derived
        // address isn't already in the wallet's address table —
        // Receive derives them on-demand and doesn't necessarily
        // persist them.
        const btc = chainRegistry.byCoin('bitcoin')[0]?.id;
        if (btc && enabledChains.has(btc)) {
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
        if (multisigOnly) return out.filter((r) => r.multisig);
        return out;
    }, [addressesByChain, enabledChains, multisigs, multisigOnly]);

    const toggleChain = (cid) => {
        setEnabledChains((prev) => {
            const next = new Set(prev);
            if (next.has(cid)) next.delete(cid);
            else next.add(cid);
            return next;
        });
    };

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>Addresses</span>
            <span className={styles.spacer} />
        </div>
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

    const activeChainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    if (activeChainIds.length === 0 && !multisig) {
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
            <div className={styles.filterBar} role="group" aria-label="Address filters">
                <span className={styles.filterLabel}>Chains</span>
                {activeChainIds.map((cid) => {
                    const d = chainRegistry.get(cid);
                    const active = enabledChains.has(cid);
                    return (
                        <button
                            key={cid}
                            type="button"
                            onClick={() => toggleChain(cid)}
                            className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                            aria-pressed={active}
                        >
                            {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                            <span>{d?.displayName || cid}</span>
                        </button>
                    );
                })}
                <span className={styles.divider} aria-hidden="true" />
                <button
                    type="button"
                    onClick={() => setMultisigOnly((v) => !v)}
                    disabled={multisigs.length === 0}
                    className={`${styles.chip} ${styles.chipCrossChain} ${multisigOnly ? styles.chipActive : ''}`}
                    aria-pressed={multisigOnly}
                    title={multisigs.length > 0
                        ? 'Show only this wallet\'s multisig receive addresses (§22).'
                        : 'No multisig address configured for this wallet.'}
                >
                    🔐 Multisig only
                </button>
            </div>

            <div className={wifStyles.wifBar}>
                {wifNotice && !showWifForm ? (
                    <p className={wifStyles.wifNotice} role="status">{wifNotice}</p>
                ) : null}
                <button
                    type="button"
                    onClick={() => {
                        setShowWifForm((v) => !v);
                        if (showWifForm) resetWifForm();
                        setWifNotice(null);
                    }}
                    className={wifStyles.wifToggle}
                    aria-expanded={showWifForm}
                >
                    {showWifForm ? 'Cancel' : 'Import private key (WIF)'}
                </button>
                {showWifForm ? (
                    <form className={wifStyles.wifForm} onSubmit={handleImportWif} noValidate>
                        <p className={wifStyles.wifWarning}>
                            <strong>Heads up — imported keys are not covered by your recovery phrase.</strong>{' '}
                            If you wipe this device or restore from your seed words, this address will not come back. You must keep a separate copy of the WIF, or move the funds back to a derived address before that happens.
                        </p>
                        <label className={wifStyles.wifField}>
                            <span className={wifStyles.wifLabel}>Chain</span>
                            <select
                                value={wifChainId}
                                onChange={(e) => {
                                    setWifChainId(e.target.value);
                                    if (wifError) setWifError(null);
                                }}
                                disabled={wifBusy}
                                className={wifStyles.wifSelect}
                            >
                                <option value="">Pick a chain…</option>
                                {Object.keys(addressesByChain || {}).map((cid) => {
                                    const d = chainRegistry.get(cid);
                                    return (
                                        <option key={cid} value={cid}>
                                            {d?.displayName || cid}
                                        </option>
                                    );
                                })}
                            </select>
                        </label>
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
                        <Input
                            type="password"
                            label="Wallet password"
                            hint="Encrypts the imported key with the same key as your seed."
                            value={wifPassword}
                            onChange={(e) => {
                                setWifPassword(e.target.value);
                                if (wifError) setWifError(null);
                            }}
                            autoComplete="current-password"
                            disabled={wifBusy}
                        />
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
                                size="sm"
                                loading={wifBusy}
                                disabled={!wifWarningAck || wifInput.trim().length === 0 || wifPassword.length === 0 || !wifChainId}
                            >
                                Import
                            </Button>
                        </div>
                    </form>
                ) : null}
            </div>

            {rows.length === 0 ? (
                <p className={styles.empty}>
                    {multisigOnly
                        ? 'No multisig address available.'
                        : 'No addresses for the selected chains.'}
                </p>
            ) : null}

            <ul className={styles.timeline} aria-label="Wallet addresses">
                {rows.map((row) => {
                    const d = chainRegistry.get(row.chainId);
                    return (
                        <li key={row.key} className={styles.row}>
                            <div className={styles.rowHead}>
                                {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                                {row.label ? (
                                    <span className={styles.rowTitle}>{row.label}</span>
                                ) : null}
                                {row.multisig ? (
                                    <MultisigBadge
                                        threshold={row.multisig.threshold}
                                        cosignerCount={row.multisig.cosignerCount}
                                        scheme={row.multisig.scheme}
                                        size="sm"
                                    />
                                ) : null}
                            </div>
                            <div className={styles.rowMeta}>
                                <AddressText address={row.address} />
                                <CopyButton value={row.address} />
                                {onShowPrivateKey && row.record && !row.multisig ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => onShowPrivateKey(row.record)}
                                        aria-label={`Show private key for ${row.address}`}
                                    >
                                        Show key
                                    </Button>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </>,
    );
}
