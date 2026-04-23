import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * "My dispensers" — §40.7.1 / §40.7.2 owner-facing list view.
 *
 * Loads every dispenser this wallet's addresses have opened, grouped by
 * chain. Each entry links to DispenserDetail for management (cancel /
 * edit). Explorer-side data is still thin (no live escrow balance / fill
 * count) — the row surfaces what's available and defers live state to
 * the detail page.
 *
 * Indexer TODO at `xchain-explorer/src/db.js` `getDispensers()` — once
 * escrow balance + dispense count land, this component can surface
 * "remaining fills" inline; for now that detail waits for the detail
 * page.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, actionIndex: string) => void} props.onOpenDispenser
 * @param {() => void} props.onBack
 */
export function DispensersList({ walletId, onOpenDispenser, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );
    const [dispensersByChain, setDispensersByChain] = useState(
        /** @type {Record<string, { loading: boolean, rows: any[], error: string | null }>} */ ({}),
    );

    // Phase 1 — load the wallet's addresses so we know which chains to
    // query and which source addresses to union over.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
            })
            .catch((err) => {
                if (!cancelled) setAddressesError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Phase 2 — for each chain with addresses, fan out one explorer
    // query per address and merge the results. A per-chain error
    // surfaces inline; other chains keep loading.
    useEffect(() => {
        if (!addressesByChain) return;
        const chains = Object.keys(addressesByChain);
        if (chains.length === 0) return;

        const initial = {};
        for (const cid of chains) initial[cid] = { loading: true, rows: [], error: null };
        setDispensersByChain(initial);

        let cancelled = false;
        for (const cid of chains) {
            const addrs = (addressesByChain[cid] || []).map((a) => a.address);
            if (addrs.length === 0) {
                if (!cancelled) {
                    setDispensersByChain((prev) => ({
                        ...prev,
                        [cid]: { loading: false, rows: [], error: null },
                    }));
                }
                continue;
            }

            Promise.all(addrs.map((addr) =>
                messaging.getDispensersForSource({ chainId: cid, address: addr })
                    .then((resp) => ({ addr, rows: extractRows(resp) }))
                    .catch((err) => ({ addr, error: err?.message || String(err) }))
            )).then((results) => {
                if (cancelled) return;
                /** @type {any[]} */
                const merged = [];
                const errs = [];
                for (const r of results) {
                    if (r.error) errs.push(`${short(r.addr)}: ${r.error}`);
                    else merged.push(...r.rows);
                }
                // De-dupe by action_index in case an address appears twice.
                const seen = new Set();
                const uniq = merged.filter((row) => {
                    const key = String(row.action_index ?? row.tx_hash ?? JSON.stringify(row));
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                uniq.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                setDispensersByChain((prev) => ({
                    ...prev,
                    [cid]: {
                        loading: false,
                        rows: uniq,
                        error: errs.length > 0 ? errs.join('; ') : null,
                    },
                }));
            });
        }
        return () => { cancelled = true; };
    }, [addressesByChain, messaging]);

    const chainsOrdered = useMemo(() => {
        if (!addressesByChain) return [];
        return Object.keys(addressesByChain).sort((a, b) => a.localeCompare(b));
    }, [addressesByChain]);

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to home"
            >
                ← Back
            </button>
            <span className={styles.title}>My dispensers</span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {children}
            </div>
            <div className={styles.actions}>
                <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>
        </Screen>
    );

    if (addressesError) {
        return wrap(<div role="alert" className={styles.entryDescription}>{addressesError}</div>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading addresses…</p>);
    }
    if (chainsOrdered.length === 0) {
        return wrap(
            <p className={styles.entryDescription}>
                No addresses on any chain yet. Use Receive to generate one first, or Create dispenser to open your first.
            </p>,
        );
    }

    return wrap(
        chainsOrdered.map((cid) => {
            const d = chainRegistry.get(cid);
            const state = dispensersByChain[cid] || { loading: true, rows: [], error: null };
            return (
                <ChainGroup
                    key={cid}
                    descriptor={d}
                    chainId={cid}
                    state={state}
                    onOpenDispenser={onOpenDispenser}
                />
            );
        }),
    );
}

function ChainGroup({ descriptor, chainId, state, onOpenDispenser }) {
    return (
        <section>
            <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {descriptor
                    ? <ChainBadge descriptor={descriptor} size="sm" />
                    : <span>{chainId}</span>}
            </header>
            {state.loading ? (
                <p className={styles.entryDescription}>Loading…</p>
            ) : state.error && state.rows.length === 0 ? (
                <p role="alert" className={styles.entryDescription}>
                    Couldn't load dispensers: {state.error}
                </p>
            ) : state.rows.length === 0 ? (
                <p className={styles.entryDescription}>
                    No dispensers opened on {descriptor?.displayName || chainId} yet.
                </p>
            ) : (
                state.rows.map((row) => (
                    <DispenserRow
                        key={String(row.action_index)}
                        row={row}
                        onSelect={() => onOpenDispenser(chainId, String(row.action_index))}
                    />
                ))
            )}
        </section>
    );
}

function DispenserRow({ row, onSelect }) {
    const rate = rateLabel(row);
    const status = String(row.status || '—');
    return (
        <button
            type="button"
            className={styles.entry}
            onClick={onSelect}
        >
            <span className={styles.entryLabel}>
                {row.give_tick || '?'} dispenser — {rate}
            </span>
            <span className={styles.entryDescription}>
                #{row.action_index ?? '?'} · status {status}
                {row.address ? ' · ' : ''}
                {row.address ? <AddressText address={row.address} /> : null}
            </span>
        </button>
    );
}

function rateLabel(row) {
    const give = `${row.give_amount ?? '?'} ${row.give_tick || '?'}`;
    const coin = row.get_coin || '';
    const tick = row.get_tick || '';
    const amt = row.get_amount ?? '?';
    const payAsset = tick || coin || '?';
    return `${give} per ${amt} ${payAsset}`;
}

function extractRows(resp) {
    // Explorer returns { data: [...] } for list queries; be defensive
    // because some wrapper layers unwrap to a bare array.
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function short(addr) {
    if (!addr || typeof addr !== 'string') return '?';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
