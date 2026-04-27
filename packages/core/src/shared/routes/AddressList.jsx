import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    ChainBadge,
    AddressText,
    CopyButton,
    MultisigBadge,
    Skeleton,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { EmptyStateNudge } from '../components/EmptyStateNudge.jsx';
import styles from './History.module.css';

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
 */
export function AddressList({ walletId, accountId, onBack, onReceive }) {
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
        /** @type {Array<{ key: string, chainId: string, address: string, label: string, multisig: any }>} */
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
                            </div>
                        </li>
                    );
                })}
            </ul>
        </>,
    );
}
